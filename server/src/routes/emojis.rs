//! Custom guild emojis.

use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use serde::Deserialize;
use serde_json::json;

use crate::access::guild_access;
use crate::auth::AuthUser;
use crate::error::{ApiError, ApiJson, ApiPath, ApiResult, is_unique_violation};
use crate::gateway::events;
use crate::images::decode_data_uri;
use crate::models::Emoji;
use crate::permissions;
use crate::snowflake::Id;
use crate::state::AppState;

pub const MAX_EMOJIS: i64 = 50;
const MAX_EMOJI_BYTES: usize = 256 * 1024;

pub fn valid_name(name: &str) -> bool {
    (2..=32).contains(&name.len()) && name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
}

pub async fn list_for(state: &AppState, guild_id: Id) -> ApiResult<Vec<Emoji>> {
    Ok(
        sqlx::query_as("SELECT * FROM emojis WHERE guild_id = $1 ORDER BY id")
            .bind(guild_id)
            .fetch_all(&state.db)
            .await?,
    )
}

async fn broadcast(state: &AppState, guild_id: Id) -> ApiResult<()> {
    let emojis = list_for(state, guild_id).await?;
    state.dispatch_guild(
        guild_id,
        events::GUILD_EMOJIS_UPDATE,
        &json!({ "guild_id": guild_id, "emojis": emojis }),
    );
    Ok(())
}

pub async fn list(
    State(state): State<AppState>,
    auth: AuthUser,
    ApiPath(guild_id): ApiPath<Id>,
) -> ApiResult<Json<Vec<Emoji>>> {
    guild_access(&state.db, guild_id, auth.user_id).await?;
    Ok(Json(list_for(&state, guild_id).await?))
}

#[derive(Deserialize)]
pub struct CreateEmoji {
    name: String,
    image: String,
}

pub async fn create(
    State(state): State<AppState>,
    auth: AuthUser,
    ApiPath(guild_id): ApiPath<Id>,
    ApiJson(body): ApiJson<CreateEmoji>,
) -> ApiResult<(StatusCode, Json<Emoji>)> {
    let access = guild_access(&state.db, guild_id, auth.user_id).await?;
    access.require(permissions::MANAGE_EMOJIS)?;
    if !valid_name(&body.name) {
        return Err(ApiError::field("name", "EMOJI_NAME_INVALID"));
    }
    let (data, mime) = decode_data_uri(&body.image, "image")?;
    if data.len() > MAX_EMOJI_BYTES {
        return Err(ApiError::field("image", "IMAGE_TOO_LARGE"));
    }
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM emojis WHERE guild_id = $1")
        .bind(guild_id)
        .fetch_one(&state.db)
        .await?;
    if count >= MAX_EMOJIS {
        return Err(ApiError::BadRequest("TOO_MANY_EMOJIS"));
    }
    let id = state.ids.next();
    state
        .storage
        .put(&format!("emojis/{id}"), data, mime)
        .await?;
    let emoji: Emoji = sqlx::query_as(
        "INSERT INTO emojis (id, guild_id, name, animated, creator_id) VALUES ($1, $2, $3, $4, $5) RETURNING *",
    )
    .bind(id)
    .bind(guild_id)
    .bind(&body.name)
    .bind(mime == "image/gif")
    .bind(auth.user_id)
    .fetch_one(&state.db)
    .await
    .map_err(|e| {
        if is_unique_violation(&e, "emojis_guild_name_key") {
            ApiError::field("name", "EMOJI_NAME_TAKEN")
        } else {
            e.into()
        }
    })?;
    broadcast(&state, guild_id).await?;
    Ok((StatusCode::CREATED, Json(emoji)))
}

#[derive(Deserialize)]
pub struct UpdateEmoji {
    name: String,
}

pub async fn update(
    State(state): State<AppState>,
    auth: AuthUser,
    ApiPath((guild_id, emoji_id)): ApiPath<(Id, Id)>,
    ApiJson(body): ApiJson<UpdateEmoji>,
) -> ApiResult<Json<Emoji>> {
    let access = guild_access(&state.db, guild_id, auth.user_id).await?;
    access.require(permissions::MANAGE_EMOJIS)?;
    if !valid_name(&body.name) {
        return Err(ApiError::field("name", "EMOJI_NAME_INVALID"));
    }
    let emoji: Emoji =
        sqlx::query_as("UPDATE emojis SET name = $3 WHERE id = $1 AND guild_id = $2 RETURNING *")
            .bind(emoji_id)
            .bind(guild_id)
            .bind(&body.name)
            .fetch_optional(&state.db)
            .await
            .map_err(|e| {
                if is_unique_violation(&e, "emojis_guild_name_key") {
                    ApiError::field("name", "EMOJI_NAME_TAKEN")
                } else {
                    e.into()
                }
            })?
            .ok_or(ApiError::NotFound("UNKNOWN_EMOJI"))?;
    broadcast(&state, guild_id).await?;
    Ok(Json(emoji))
}

pub async fn delete(
    State(state): State<AppState>,
    auth: AuthUser,
    ApiPath((guild_id, emoji_id)): ApiPath<(Id, Id)>,
) -> ApiResult<StatusCode> {
    let access = guild_access(&state.db, guild_id, auth.user_id).await?;
    access.require(permissions::MANAGE_EMOJIS)?;
    let deleted = sqlx::query("DELETE FROM emojis WHERE id = $1 AND guild_id = $2")
        .bind(emoji_id)
        .bind(guild_id)
        .execute(&state.db)
        .await?
        .rows_affected();
    if deleted == 0 {
        return Err(ApiError::NotFound("UNKNOWN_EMOJI"));
    }
    if let Err(e) = state.storage.delete(&format!("emojis/{emoji_id}")).await {
        tracing::warn!(error = ?e, "failed to delete emoji image");
    }
    broadcast(&state, guild_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod tests {
    #[test]
    fn names() {
        assert!(super::valid_name("party_blob"));
        assert!(super::valid_name("ok"));
        assert!(!super::valid_name("x"));
        assert!(!super::valid_name("mit leerzeichen"));
        assert!(!super::valid_name("ümlaut"));
    }
}
