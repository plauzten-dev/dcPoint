use std::ops::Deref;
use std::sync::Arc;
use std::time::Duration;

use sqlx::PgPool;

use crate::auth::SessionCache;
use crate::config::Config;
use crate::embeds::Embedder;
use crate::gateway::hub::Hub;
use crate::ratelimit::RateLimiter;
use crate::snowflake::SnowflakeGen;
use crate::storage::Storage;

pub struct Inner {
    pub db: PgPool,
    pub cfg: Config,
    pub hub: Hub,
    pub storage: Storage,
    pub ids: SnowflakeGen,
    pub sessions: SessionCache,
    pub auth_limiter: RateLimiter,
    /// Per-user message send limit (5 messages per 5 seconds).
    pub message_limiter: RateLimiter<i64>,
    pub embedder: Embedder,
}

#[derive(Clone)]
pub struct AppState(Arc<Inner>);

impl Deref for AppState {
    type Target = Inner;
    fn deref(&self) -> &Inner {
        &self.0
    }
}

impl AppState {
    pub fn new(cfg: Config, db: PgPool, storage: Storage) -> Self {
        Self(Arc::new(Inner {
            ids: SnowflakeGen::new(cfg.worker_id),
            auth_limiter: RateLimiter::new(cfg.auth_rate_limit_per_min, Duration::from_secs(60)),
            message_limiter: RateLimiter::new(cfg.message_rate_limit, Duration::from_secs(5)),
            embedder: Embedder::new(cfg.secret_key.clone(), cfg.allow_private_embeds),
            hub: Hub::default(),
            sessions: SessionCache::default(),
            db,
            cfg,
            storage,
        }))
    }

    /// Periodic housekeeping: expired gateway sessions and rate-limit buckets.
    pub fn spawn_background_tasks(&self) {
        let state = self.clone();
        tokio::spawn(async move {
            let mut tick = tokio::time::interval(Duration::from_secs(30));
            loop {
                tick.tick().await;
                state.hub.reap();
                state.auth_limiter.prune();
                state.message_limiter.prune();
            }
        });
    }
}
