//! Fixed-window rate limiting per client IP.

use std::net::{IpAddr, SocketAddr};
use std::time::{Duration, Instant};

use axum::extract::{ConnectInfo, Request, State};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use dashmap::DashMap;

use crate::error::ApiError;
use crate::state::AppState;

pub struct RateLimiter {
    limit: u32,
    window: Duration,
    hits: DashMap<IpAddr, (Instant, u32)>,
}

impl RateLimiter {
    pub fn new(limit: u32, window: Duration) -> Self {
        Self {
            limit,
            window,
            hits: DashMap::new(),
        }
    }

    /// `Err(retry_after_secs)` when the limit is exceeded. A limit of 0 disables limiting.
    pub fn check(&self, ip: IpAddr) -> Result<(), u64> {
        if self.limit == 0 {
            return Ok(());
        }
        let now = Instant::now();
        let mut entry = self.hits.entry(ip).or_insert((now, 0));
        if now.duration_since(entry.0) >= self.window {
            *entry = (now, 0);
        }
        entry.1 += 1;
        if entry.1 > self.limit {
            return Err(self
                .window
                .saturating_sub(now.duration_since(entry.0))
                .as_secs()
                .max(1));
        }
        Ok(())
    }

    pub fn prune(&self) {
        let window = self.window;
        self.hits.retain(|_, (start, _)| start.elapsed() < window);
    }
}

pub fn client_ip(req: &Request, trust_proxy: bool) -> Option<IpAddr> {
    if trust_proxy {
        let forwarded = req
            .headers()
            .get("x-real-ip")
            .or_else(|| req.headers().get("x-forwarded-for"))
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.split(',').next())
            .and_then(|v| v.trim().parse().ok());
        if forwarded.is_some() {
            return forwarded;
        }
    }
    req.extensions()
        .get::<ConnectInfo<SocketAddr>>()
        .map(|c| c.0.ip())
}

pub async fn auth_limit(State(state): State<AppState>, req: Request, next: Next) -> Response {
    if let Some(ip) = client_ip(&req, state.cfg.trust_proxy)
        && let Err(retry_after_secs) = state.auth_limiter.check(ip)
    {
        return ApiError::RateLimited { retry_after_secs }.into_response();
    }
    next.run(req).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn limits_per_ip() {
        let rl = RateLimiter::new(2, Duration::from_secs(60));
        let a: IpAddr = "10.0.0.1".parse().unwrap();
        let b: IpAddr = "10.0.0.2".parse().unwrap();
        assert!(rl.check(a).is_ok());
        assert!(rl.check(a).is_ok());
        assert!(rl.check(a).is_err());
        assert!(rl.check(b).is_ok());
        assert!(RateLimiter::new(0, Duration::from_secs(1)).check(a).is_ok());
    }
}
