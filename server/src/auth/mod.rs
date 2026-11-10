pub mod password;
pub mod token;
pub mod totp;

use std::time::{Duration, Instant};

use axum::extract::FromRequestParts;
use axum::http::header::AUTHORIZATION;
use axum::http::request::Parts;
use dashmap::DashMap;

use crate::error::ApiError;
use crate::snowflake::Id;
use crate::state::AppState;

const CACHE_TTL: Duration = Duration::from_secs(300);

/// The authenticated caller of a request.
#[derive(Clone, Copy, Debug)]
pub struct AuthUser {
    pub user_id: Id,
    pub session_id: i64,
}

struct CachedSession {
    user_id: Id,
    hash: Vec<u8>,
    cached_at: Instant,
}

/// Short-lived cache of validated sessions so hot paths skip the database.
#[derive(Default)]
pub struct SessionCache(DashMap<i64, CachedSession>);

impl SessionCache {
    pub fn invalidate(&self, session_id: i64) {
        self.0.remove(&session_id);
    }

    pub fn invalidate_user(&self, user_id: Id) {
        self.0.retain(|_, s| s.user_id != user_id);
    }
}

impl AppState {
    pub async fn authenticate(&self, raw_token: &str) -> Result<AuthUser, ApiError> {
        let (session_id, hash) =
            token::parse_session_token(raw_token).ok_or(ApiError::Unauthorized)?;
        if let Some(c) = self.sessions.0.get(&session_id)
            && c.cached_at.elapsed() < CACHE_TTL
        {
            return if token::constant_time_eq(&c.hash, &hash) {
                Ok(AuthUser {
                    user_id: c.user_id,
                    session_id,
                })
            } else {
                Err(ApiError::Unauthorized)
            };
        }
        let row: Option<(Id, Vec<u8>)> = sqlx::query_as(
            "UPDATE sessions SET last_used_at = now() WHERE id = $1 RETURNING user_id, token_hash",
        )
        .bind(session_id)
        .fetch_optional(&self.db)
        .await?;
        let (user_id, stored) = row.ok_or(ApiError::Unauthorized)?;
        if !token::constant_time_eq(&stored, &hash) {
            return Err(ApiError::Unauthorized);
        }
        self.sessions.0.insert(
            session_id,
            CachedSession {
                user_id,
                hash: stored,
                cached_at: Instant::now(),
            },
        );
        Ok(AuthUser {
            user_id,
            session_id,
        })
    }
}

impl FromRequestParts<AppState> for AuthUser {
    type Rejection = ApiError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let header = parts
            .headers
            .get(AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .ok_or(ApiError::Unauthorized)?;
        state.authenticate(header).await
    }
}
