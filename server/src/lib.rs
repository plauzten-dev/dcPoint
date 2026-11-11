//! dcPoint server library: everything except process bootstrap, so integration
//! tests can build the exact production router.

pub mod access;
pub mod auth;
pub mod config;
pub mod embeds;
pub mod error;
pub mod gateway;
pub mod images;
pub mod models;
pub mod permissions;
pub mod ratelimit;
pub mod routes;
pub mod snowflake;
pub mod state;
pub mod storage;
pub mod validation;

pub use routes::router;
pub use state::AppState;
