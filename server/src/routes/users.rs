use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::auth::{AuthUser, password, totp};
use crate::error::{ApiError, ApiJson, ApiPath, ApiResult, FieldErrors, is_unique_violation};
use crate::gateway::events;
use crate::images::{ImageKind, store_image};
use crate::models::{PrivateUser, PublicUser, UserRow, double_option};
use crate::snowflake::Id;
use crate::state::AppState;
use crate::validation;

use super::auth::check_totp;

pub async fn load_user(state: &AppState, id: Id) -> ApiResult<UserRow> {
    sqlx::query_as("SELECT * FROM users WHERE id = $1")
        .bind(id)
        .fetch_optional(&state.db)
        .await?
        .ok_or(ApiError::NotFound("UNKNOWN_USER"))
}

/// Notifies the user (private payload) and everyone sharing a guild (public payload).
fn dispatch_user_update(state: &AppState, user: &UserRow) {
    state.dispatch([user.id.0], events::USER_UPDATE, &user.private());
    state.dispatch(
        state.hub.co_members(user.id.0),
        events::USER_UPDATE,
        &user.public(),
    );
}

pub async fn me(State(state): State<AppState>, auth: AuthUser) -> ApiResult<Json<PrivateUser>> {
    Ok(Json(load_user(&state, auth.user_id).await?.private()))
}

pub async fn get_user(
    State(state): State<AppState>,
    _auth: AuthUser,
    ApiPath(id): ApiPath<Id>,
) -> ApiResult<Json<PublicUser>> {
    Ok(Json(load_user(&state, id).await?.public()))
}

#[derive(Deserialize)]
pub struct UpdateMe {
    username: Option<String>,
    /// Required when changing the username.
    password: Option<String>,
    #[serde(default, deserialize_with = "double_option")]
    display_name: Option<Option<String>>,
    #[serde(default, deserialize_with = "double_option")]
    avatar: Option<Option<String>>,
    #[serde(default, deserialize_with = "double_option")]
    banner: Option<Option<String>>,
    bio: Option<String>,
    pronouns: Option<String>,
    #[serde(default, deserialize_with = "double_option")]
    accent_color: Option<Option<i32>>,
}

pub async fn update_me(
    State(state): State<AppState>,
    auth: AuthUser,
    ApiJson(body): ApiJson<UpdateMe>,
) -> ApiResult<Json<PrivateUser>> {
    let mut user = load_user(&state, auth.user_id).await?;
    let mut errors = FieldErrors::new();

    if let Some(username) = body
        .username
        .map(|u| u.trim().to_lowercase())
        .filter(|u| *u != user.username)
    {
        validation::username(&mut errors, &username);
        let verified = match body.password {
            Some(pw) => password::verify(pw, user.password_hash.clone()).await,
            None => false,
        };
        if verified {
            user.username = username;
        } else {
            errors.insert("password", "PASSWORD_INCORRECT");
        }
    }
    if let Some(d) = body.display_name {
        user.display_name = d.and_then(|d| validation::text(&mut errors, "display_name", &d, 32));
    }
    if let Some(bio) = body.bio {
        user.bio = validation::text(&mut errors, "bio", &bio, 190).unwrap_or_default();
    }
    if let Some(p) = body.pronouns {
        user.pronouns = validation::text(&mut errors, "pronouns", &p, 40).unwrap_or_default();
    }
    if let Some(c) = body.accent_color {
        if c.is_some_and(|c| !(0..=0xFF_FFFF).contains(&c)) {
            errors.insert("accent_color", "INVALID_COLOR");
        }
        user.accent_color = c;
    }
    if !errors.is_empty() {
        return Err(ApiError::Validation(errors));
    }
    if let Some(avatar) = body.avatar {
        user.avatar = match avatar {
            Some(uri) => {
                Some(store_image(&state, ImageKind::Avatar, user.id, &uri, "avatar").await?)
            }
            None => None,
        };
    }
    if let Some(banner) = body.banner {
        user.banner = match banner {
            Some(uri) => {
                Some(store_image(&state, ImageKind::Banner, user.id, &uri, "banner").await?)
            }
            None => None,
        };
    }

    let user: UserRow = sqlx::query_as(
        "UPDATE users SET username = $2, display_name = $3, avatar = $4, banner = $5, bio = $6, pronouns = $7, accent_color = $8
         WHERE id = $1 RETURNING *",
    )
    .bind(user.id)
    .bind(&user.username)
    .bind(&user.display_name)
    .bind(&user.avatar)
    .bind(&user.banner)
    .bind(&user.bio)
    .bind(&user.pronouns)
    .bind(user.accent_color)
    .fetch_one(&state.db)
    .await
    .map_err(|e| if is_unique_violation(&e, "users_username_key") { ApiError::field("username", "USERNAME_TAKEN") } else { e.into() })?;
    dispatch_user_update(&state, &user);
    Ok(Json(user.private()))
}

#[derive(Deserialize)]
pub struct CustomStatusBody {
    text: Option<String>,
    emoji: Option<String>,
    expires_at: Option<DateTime<Utc>>,
}

#[derive(Deserialize)]
pub struct SettingsBody {
    status: Option<String>,
    #[serde(default, deserialize_with = "double_option")]
    custom_status: Option<Option<CustomStatusBody>>,
}

pub async fn update_settings(
    State(state): State<AppState>,
    auth: AuthUser,
    ApiJson(body): ApiJson<SettingsBody>,
) -> ApiResult<Json<PrivateUser>> {
    let mut user = load_user(&state, auth.user_id).await?;
    let mut errors = FieldErrors::new();
    if let Some(status) = body.status {
        if !matches!(status.as_str(), "online" | "idle" | "dnd" | "invisible") {
            errors.insert("status", "INVALID_STATUS");
        }
        user.status = status;
    }
    if let Some(cs) = body.custom_status {
        match cs {
            Some(cs) => {
                user.custom_status_text = cs
                    .text
                    .as_deref()
                    .and_then(|t| validation::text(&mut errors, "custom_status", t, 128));
                user.custom_status_emoji = cs
                    .emoji
                    .as_deref()
                    .and_then(|t| validation::text(&mut errors, "custom_status", t, 64));
                user.custom_status_expires_at = cs.expires_at;
            }
            None => {
                user.custom_status_text = None;
                user.custom_status_emoji = None;
                user.custom_status_expires_at = None;
            }
        }
    }
    if !errors.is_empty() {
        return Err(ApiError::Validation(errors));
    }
    let user: UserRow = sqlx::query_as(
        "UPDATE users SET status = $2, custom_status_text = $3, custom_status_emoji = $4, custom_status_expires_at = $5
         WHERE id = $1 RETURNING *",
    )
    .bind(user.id)
    .bind(&user.status)
    .bind(&user.custom_status_text)
    .bind(&user.custom_status_emoji)
    .bind(user.custom_status_expires_at)
    .fetch_one(&state.db)
    .await?;
    state.dispatch([user.id.0], events::USER_UPDATE, &user.private());
    state.broadcast_presence(user.id).await?;
    Ok(Json(user.private()))
}

#[derive(Deserialize)]
pub struct PasswordBody {
    password: String,
    new_password: String,
}

pub async fn change_password(
    State(state): State<AppState>,
    auth: AuthUser,
    ApiJson(body): ApiJson<PasswordBody>,
) -> ApiResult<StatusCode> {
    let user = load_user(&state, auth.user_id).await?;
    if !password::verify(body.password, user.password_hash).await {
        return Err(ApiError::field("password", "PASSWORD_INCORRECT"));
    }
    let mut errors = FieldErrors::new();
    validation::password(&mut errors, &body.new_password);
    if !errors.is_empty() {
        return Err(ApiError::field(
            "new_password",
            errors.into_values().next().unwrap_or("INVALID"),
        ));
    }
    let hash = password::hash(body.new_password).await?;
    sqlx::query("UPDATE users SET password_hash = $2 WHERE id = $1")
        .bind(user.id)
        .bind(hash)
        .execute(&state.db)
        .await?;
    // Sign out every other session.
    let revoked: Vec<i64> =
        sqlx::query_scalar("DELETE FROM sessions WHERE user_id = $1 AND id <> $2 RETURNING id")
            .bind(user.id)
            .bind(auth.session_id)
            .fetch_all(&state.db)
            .await?;
    for s in revoked {
        state.sessions.invalidate(s);
        state.hub.kill_auth_session(user.id.0, s);
    }
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
pub struct PasswordOnly {
    password: String,
}

/// Step 1: returns a fresh secret. Nothing is stored until it is confirmed with a valid code.
pub async fn mfa_enable(
    State(state): State<AppState>,
    auth: AuthUser,
    ApiJson(body): ApiJson<PasswordOnly>,
) -> ApiResult<Json<Value>> {
    let user = load_user(&state, auth.user_id).await?;
    if user.totp_secret.is_some() {
        return Err(ApiError::BadRequest("MFA_ALREADY_ENABLED"));
    }
    if !password::verify(body.password, user.password_hash.clone()).await {
        return Err(ApiError::field("password", "PASSWORD_INCORRECT"));
    }
    let secret = totp::generate_secret();
    let uri = totp::otpauth_uri(&secret, &user.username);
    Ok(Json(json!({ "secret": secret, "uri": uri })))
}

#[derive(Deserialize)]
pub struct MfaConfirm {
    secret: String,
    code: String,
}

pub async fn mfa_confirm(
    State(state): State<AppState>,
    auth: AuthUser,
    ApiJson(body): ApiJson<MfaConfirm>,
) -> ApiResult<Json<PrivateUser>> {
    let user = load_user(&state, auth.user_id).await?;
    if user.totp_secret.is_some() {
        return Err(ApiError::BadRequest("MFA_ALREADY_ENABLED"));
    }
    if totp::base32_decode(&body.secret).is_none_or(|k| k.len() < 16) {
        return Err(ApiError::field("secret", "INVALID_SECRET"));
    }
    let step = totp::verify(&body.secret, &body.code, totp::current_step())
        .ok_or(ApiError::field("code", "INVALID_TOTP_CODE"))?;
    let user: UserRow = sqlx::query_as(
        "UPDATE users SET totp_secret = $2, totp_last_step = $3 WHERE id = $1 RETURNING *",
    )
    .bind(user.id)
    .bind(&body.secret)
    .bind(step as i64)
    .fetch_one(&state.db)
    .await?;
    state.dispatch([user.id.0], events::USER_UPDATE, &user.private());
    Ok(Json(user.private()))
}

#[derive(Deserialize)]
pub struct CodeOnly {
    code: String,
}

pub async fn mfa_disable(
    State(state): State<AppState>,
    auth: AuthUser,
    ApiJson(body): ApiJson<CodeOnly>,
) -> ApiResult<Json<PrivateUser>> {
    let user = load_user(&state, auth.user_id).await?;
    check_totp(&state, &user, &body.code).await?;
    let user: UserRow = sqlx::query_as(
        "UPDATE users SET totp_secret = NULL, totp_last_step = NULL WHERE id = $1 RETURNING *",
    )
    .bind(user.id)
    .fetch_one(&state.db)
    .await?;
    state.dispatch([user.id.0], events::USER_UPDATE, &user.private());
    Ok(Json(user.private()))
}
