mod auth;
mod cdn;
mod channels;
mod guilds;
mod invites;
mod users;

use axum::Router;
use axum::extract::DefaultBodyLimit;
use axum::http::{HeaderName, HeaderValue, Method, header};
use axum::middleware;
use axum::routing::{delete, get, patch, post};
use tower_http::compression::CompressionLayer;
use tower_http::cors::{AllowOrigin, CorsLayer};
use tower_http::trace::TraceLayer;

use crate::gateway::conn::ws_handler;
use crate::ratelimit::auth_limit;
use crate::state::AppState;

/// Data URIs for avatars/banners (8 MiB binary ≈ 11 MiB base64).
const BODY_LIMIT: usize = 12 * 1024 * 1024;

pub fn router(state: AppState) -> Router {
    let auth_routes = Router::new()
        .route("/register", post(auth::register))
        .route("/login", post(auth::login))
        .route("/mfa/totp", post(auth::login_mfa))
        .route_layer(middleware::from_fn_with_state(state.clone(), auth_limit))
        .route("/logout", post(auth::logout));

    let api = Router::new()
        .nest("/auth", auth_routes)
        .route("/health", get(|| async { "ok" }))
        .route("/users/@me", get(users::me).patch(users::update_me))
        .route("/users/@me/settings", patch(users::update_settings))
        .route("/users/@me/password", post(users::change_password))
        .route("/users/@me/mfa/totp/enable", post(users::mfa_enable))
        .route("/users/@me/mfa/totp/confirm", post(users::mfa_confirm))
        .route("/users/@me/mfa/totp/disable", post(users::mfa_disable))
        .route("/users/@me/guilds/{guild_id}", delete(guilds::leave))
        .route("/users/{user_id}", get(users::get_user))
        .route("/guilds", post(guilds::create))
        .route(
            "/guilds/{guild_id}",
            get(guilds::get)
                .patch(guilds::update)
                .delete(guilds::delete),
        )
        .route("/guilds/{guild_id}/members", get(guilds::members))
        .route(
            "/guilds/{guild_id}/channels",
            post(channels::create).patch(channels::reorder),
        )
        .route("/guilds/{guild_id}/invites", get(invites::list_for_guild))
        .route(
            "/channels/{channel_id}",
            get(channels::get)
                .patch(channels::update)
                .delete(channels::delete),
        )
        .route("/channels/{channel_id}/invites", post(invites::create))
        .route(
            "/invites/{code}",
            get(invites::get)
                .post(invites::accept)
                .delete(invites::delete),
        );

    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::list(
            state
                .cfg
                .cors_origins
                .iter()
                .filter_map(|o| HeaderValue::from_str(o).ok()),
        ))
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PATCH,
            Method::PUT,
            Method::DELETE,
        ])
        .allow_headers([
            header::AUTHORIZATION,
            header::CONTENT_TYPE,
            HeaderName::from_static("x-audit-log-reason"),
        ])
        .max_age(std::time::Duration::from_secs(86_400));

    Router::new()
        .nest("/api/v1", api)
        .route("/gateway", get(ws_handler))
        .route("/cdn/{kind}/{owner}/{hash}", get(cdn::get))
        .layer(DefaultBodyLimit::max(BODY_LIMIT))
        .layer(CompressionLayer::new())
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}
