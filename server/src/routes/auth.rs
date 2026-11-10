use axum::Json;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode, header};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::auth::{AuthUser, password, token, totp};
use crate::error::{ApiError, ApiJson, ApiResult, FieldErrors, is_unique_violation};
use crate::models::UserRow;
use crate::snowflake::Id;
use crate::state::AppState;
use crate::validation;

#[derive(Deserialize)]
pub struct RegisterBody {
    pub email: String,
    pub username: String,
    pub password: String,
    pub display_name: Option<String>,
}

#[derive(Deserialize)]
pub struct LoginBody {
    pub login: String,
    pub password: String,
}

#[derive(Deserialize)]
pub struct MfaBody {
    pub ticket: String,
    pub code: String,
}

pub async fn create_session(
    state: &AppState,
    user_id: Id,
    headers: &HeaderMap,
) -> ApiResult<String> {
    let session_id = state.ids.next();
    let t = token::new_session_token(session_id.0);
    let ua = headers
        .get(header::USER_AGENT)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.chars().take(256).collect::<String>());
    sqlx::query(
        "INSERT INTO sessions (id, user_id, token_hash, user_agent) VALUES ($1, $2, $3, $4)",
    )
    .bind(session_id)
    .bind(user_id)
    .bind(&t.hash)
    .bind(ua)
    .execute(&state.db)
    .await?;
    Ok(t.token)
}

pub async fn register(
    State(state): State<AppState>,
    headers: HeaderMap,
    ApiJson(body): ApiJson<RegisterBody>,
) -> ApiResult<(StatusCode, Json<Value>)> {
    let email = body.email.trim().to_owned();
    let username = body.username.trim().to_lowercase();
    let mut errors = FieldErrors::new();
    validation::email(&mut errors, &email);
    validation::username(&mut errors, &username);
    validation::password(&mut errors, &body.password);
    let display_name = body
        .display_name
        .as_deref()
        .and_then(|d| validation::text(&mut errors, "display_name", d, 32));
    if !errors.is_empty() {
        return Err(ApiError::Validation(errors));
    }
    let hash = password::hash(body.password).await?;
    let id = state.ids.next();
    let user: UserRow = sqlx::query_as(
        "INSERT INTO users (id, username, email, display_name, password_hash) VALUES ($1, $2, $3, $4, $5) RETURNING *",
    )
    .bind(id)
    .bind(&username)
    .bind(&email)
    .bind(display_name)
    .bind(hash)
    .fetch_one(&state.db)
    .await
    .map_err(|e| {
        if is_unique_violation(&e, "users_email_key") {
            ApiError::field("email", "EMAIL_ALREADY_REGISTERED")
        } else if is_unique_violation(&e, "users_username_key") {
            ApiError::field("username", "USERNAME_TAKEN")
        } else {
            e.into()
        }
    })?;
    let token = create_session(&state, user.id, &headers).await?;
    Ok((
        StatusCode::CREATED,
        Json(json!({ "token": token, "user": user.private() })),
    ))
}

pub async fn login(
    State(state): State<AppState>,
    headers: HeaderMap,
    ApiJson(body): ApiJson<LoginBody>,
) -> ApiResult<Json<Value>> {
    let user: Option<UserRow> = sqlx::query_as(
        "SELECT * FROM users WHERE lower(email) = lower($1) OR lower(username) = lower($1) LIMIT 1",
    )
    .bind(body.login.trim())
    .fetch_optional(&state.db)
    .await?;
    let Some(user) = user else {
        // Spend comparable time so response timing does not reveal registered logins.
        let _ = password::hash(body.password).await;
        return Err(ApiError::field("login", "INVALID_LOGIN"));
    };
    if !password::verify(body.password, user.password_hash.clone()).await {
        return Err(ApiError::field("login", "INVALID_LOGIN"));
    }
    if user.totp_secret.is_some() {
        let ticket = token::mfa_ticket(
            &state.cfg.secret_key,
            user.id.0,
            chrono::Utc::now().timestamp(),
        );
        return Ok(Json(json!({ "mfa": true, "ticket": ticket })));
    }
    let token = create_session(&state, user.id, &headers).await?;
    Ok(Json(json!({ "token": token, "user": user.private() })))
}

/// Verifies a TOTP code for the user and records the step to prevent replays.
pub async fn check_totp(state: &AppState, user: &UserRow, code: &str) -> ApiResult<()> {
    let secret = user
        .totp_secret
        .as_deref()
        .ok_or(ApiError::BadRequest("MFA_NOT_ENABLED"))?;
    let step = totp::verify(secret, code, totp::current_step())
        .ok_or(ApiError::field("code", "INVALID_TOTP_CODE"))?;
    let updated = sqlx::query("UPDATE users SET totp_last_step = $2 WHERE id = $1 AND (totp_last_step IS NULL OR totp_last_step < $2)")
        .bind(user.id)
        .bind(step as i64)
        .execute(&state.db)
        .await?;
    if updated.rows_affected() == 0 {
        return Err(ApiError::field("code", "INVALID_TOTP_CODE"));
    }
    Ok(())
}

pub async fn login_mfa(
    State(state): State<AppState>,
    headers: HeaderMap,
    ApiJson(body): ApiJson<MfaBody>,
) -> ApiResult<Json<Value>> {
    let user_id = token::verify_mfa_ticket(
        &state.cfg.secret_key,
        &body.ticket,
        chrono::Utc::now().timestamp(),
    )
    .ok_or(ApiError::BadRequest("INVALID_MFA_TICKET"))?;
    let user: UserRow = sqlx::query_as("SELECT * FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_optional(&state.db)
        .await?
        .ok_or(ApiError::BadRequest("INVALID_MFA_TICKET"))?;
    check_totp(&state, &user, &body.code).await?;
    let token = create_session(&state, user.id, &headers).await?;
    Ok(Json(json!({ "token": token, "user": user.private() })))
}

pub async fn logout(State(state): State<AppState>, auth: AuthUser) -> ApiResult<StatusCode> {
    sqlx::query("DELETE FROM sessions WHERE id = $1")
        .bind(auth.session_id)
        .execute(&state.db)
        .await?;
    state.sessions.invalidate(auth.session_id);
    state.hub.kill_auth_session(auth.user_id.0, auth.session_id);
    Ok(StatusCode::NO_CONTENT)
}
