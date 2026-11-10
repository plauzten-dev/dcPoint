use std::collections::HashMap;

use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use serde::Deserialize;
use serde_json::json;

use crate::access::guild_access;
use crate::auth::AuthUser;
use crate::error::{ApiError, ApiJson, ApiPath, ApiQuery, ApiResult, FieldErrors};
use crate::gateway::events;
use crate::images::{ImageKind, store_image};
use crate::models::{GuildPayload, GuildRow, Member, MemberRow, UserRow, double_option};
use crate::permissions::{self, channel_type};
use crate::snowflake::Id;
use crate::state::AppState;
use crate::validation;

#[derive(Deserialize)]
pub struct CreateGuild {
    name: String,
    icon: Option<String>,
}

pub async fn guild_payload(state: &AppState, user_id: Id, guild_id: Id) -> ApiResult<GuildPayload> {
    state
        .guild_payloads(user_id, Some(guild_id))
        .await?
        .pop()
        .ok_or(ApiError::NotFound("UNKNOWN_GUILD"))
}

pub async fn create(
    State(state): State<AppState>,
    auth: AuthUser,
    ApiJson(body): ApiJson<CreateGuild>,
) -> ApiResult<(StatusCode, Json<GuildPayload>)> {
    let mut errors = FieldErrors::new();
    let name = validation::guild_name(&mut errors, &body.name);
    if !errors.is_empty() {
        return Err(ApiError::Validation(errors));
    }
    let guild_id = state.ids.next();
    let icon = match body.icon {
        Some(uri) => Some(store_image(&state, ImageKind::Icon, guild_id, &uri, "icon").await?),
        None => None,
    };

    let mut tx = state.db.begin().await?;
    sqlx::query("INSERT INTO guilds (id, name, icon, owner_id) VALUES ($1, $2, $3, $4)")
        .bind(guild_id)
        .bind(&name)
        .bind(&icon)
        .bind(auth.user_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("INSERT INTO roles (id, guild_id, name, position, permissions) VALUES ($1, $1, '@everyone', 0, $2)")
        .bind(guild_id)
        .bind(permissions::DEFAULT_EVERYONE as i64)
        .execute(&mut *tx)
        .await?;
    sqlx::query("INSERT INTO members (guild_id, user_id) VALUES ($1, $2)")
        .bind(guild_id)
        .bind(auth.user_id)
        .execute(&mut *tx)
        .await?;

    let text_cat = state.ids.next();
    let voice_cat = state.ids.next();
    let defaults: [(Id, i16, &str, i32, Option<Id>); 4] = [
        (
            text_cat,
            channel_type::GUILD_CATEGORY,
            "Textkanäle",
            0,
            None,
        ),
        (
            voice_cat,
            channel_type::GUILD_CATEGORY,
            "Sprachkanäle",
            1,
            None,
        ),
        (
            state.ids.next(),
            channel_type::GUILD_TEXT,
            "allgemein",
            0,
            Some(text_cat),
        ),
        (
            state.ids.next(),
            channel_type::GUILD_VOICE,
            "Allgemein",
            0,
            Some(voice_cat),
        ),
    ];
    for (id, kind, name, position, parent) in defaults {
        sqlx::query(
            "INSERT INTO channels (id, guild_id, type, name, position, parent_id, bitrate, user_limit)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
        )
        .bind(id)
        .bind(guild_id)
        .bind(kind)
        .bind(name)
        .bind(position)
        .bind(parent)
        .bind((kind == channel_type::GUILD_VOICE).then_some(64_000))
        .bind((kind == channel_type::GUILD_VOICE).then_some(0))
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;

    state.hub.subscribe(auth.user_id.0, guild_id.0);
    let payload = guild_payload(&state, auth.user_id, guild_id).await?;
    state.dispatch([auth.user_id.0], events::GUILD_CREATE, &payload);
    Ok((StatusCode::CREATED, Json(payload)))
}

pub async fn get(
    State(state): State<AppState>,
    auth: AuthUser,
    ApiPath(guild_id): ApiPath<Id>,
) -> ApiResult<Json<GuildPayload>> {
    Ok(Json(guild_payload(&state, auth.user_id, guild_id).await?))
}

#[derive(Deserialize)]
pub struct UpdateGuild {
    name: Option<String>,
    #[serde(default, deserialize_with = "double_option")]
    icon: Option<Option<String>>,
    #[serde(default, deserialize_with = "double_option")]
    description: Option<Option<String>>,
}

pub async fn update(
    State(state): State<AppState>,
    auth: AuthUser,
    ApiPath(guild_id): ApiPath<Id>,
    ApiJson(body): ApiJson<UpdateGuild>,
) -> ApiResult<Json<GuildRow>> {
    let access = guild_access(&state.db, guild_id, auth.user_id).await?;
    access.require(permissions::MANAGE_GUILD)?;
    let mut guild = access.guild;
    let mut errors = FieldErrors::new();
    if let Some(name) = body.name {
        guild.name = validation::guild_name(&mut errors, &name);
    }
    if let Some(d) = body.description {
        guild.description = d.and_then(|d| validation::text(&mut errors, "description", &d, 300));
    }
    if !errors.is_empty() {
        return Err(ApiError::Validation(errors));
    }
    if let Some(icon) = body.icon {
        guild.icon = match icon {
            Some(uri) => Some(store_image(&state, ImageKind::Icon, guild.id, &uri, "icon").await?),
            None => None,
        };
    }
    let guild: GuildRow = sqlx::query_as(
        "UPDATE guilds SET name = $2, icon = $3, description = $4 WHERE id = $1 RETURNING *",
    )
    .bind(guild.id)
    .bind(&guild.name)
    .bind(&guild.icon)
    .bind(&guild.description)
    .fetch_one(&state.db)
    .await?;
    state.dispatch_guild(guild.id, events::GUILD_UPDATE, &guild);
    Ok(Json(guild))
}

pub async fn delete(
    State(state): State<AppState>,
    auth: AuthUser,
    ApiPath(guild_id): ApiPath<Id>,
) -> ApiResult<StatusCode> {
    let access = guild_access(&state.db, guild_id, auth.user_id).await?;
    if !access.is_owner() {
        return Err(ApiError::MissingPermissions);
    }
    sqlx::query("DELETE FROM guilds WHERE id = $1")
        .bind(guild_id)
        .execute(&state.db)
        .await?;
    state.dispatch_guild(guild_id, events::GUILD_DELETE, &json!({ "id": guild_id }));
    state.hub.remove_guild(guild_id.0);
    Ok(StatusCode::NO_CONTENT)
}

pub async fn leave(
    State(state): State<AppState>,
    auth: AuthUser,
    ApiPath(guild_id): ApiPath<Id>,
) -> ApiResult<StatusCode> {
    let access = guild_access(&state.db, guild_id, auth.user_id).await?;
    if access.is_owner() {
        return Err(ApiError::BadRequest("OWNER_CANNOT_LEAVE"));
    }
    remove_member(&state, guild_id, auth.user_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Removes a member and notifies everyone involved (also used by kick in phase 5).
pub async fn remove_member(state: &AppState, guild_id: Id, user_id: Id) -> ApiResult<()> {
    sqlx::query("DELETE FROM members WHERE guild_id = $1 AND user_id = $2")
        .bind(guild_id)
        .bind(user_id)
        .execute(&state.db)
        .await?;
    state.dispatch(
        [user_id.0],
        events::GUILD_DELETE,
        &json!({ "id": guild_id }),
    );
    state.hub.unsubscribe(user_id.0, guild_id.0);
    state.dispatch_guild(
        guild_id,
        events::GUILD_MEMBER_REMOVE,
        &json!({ "guild_id": guild_id, "user_id": user_id }),
    );
    Ok(())
}

#[derive(Deserialize)]
pub struct MembersQuery {
    limit: Option<i64>,
    after: Option<Id>,
}

pub async fn load_members(
    state: &AppState,
    guild_id: Id,
    user_ids: Option<&[i64]>,
    after: Id,
    limit: i64,
) -> ApiResult<Vec<Member>> {
    let rows: Vec<MemberRow> = sqlx::query_as(
        "SELECT * FROM members WHERE guild_id = $1 AND user_id > $2 AND ($3::BIGINT[] IS NULL OR user_id = ANY($3))
         ORDER BY user_id LIMIT $4",
    )
    .bind(guild_id)
    .bind(after)
    .bind(user_ids)
    .bind(limit)
    .fetch_all(&state.db)
    .await?;
    if rows.is_empty() {
        return Ok(vec![]);
    }
    let ids: Vec<i64> = rows.iter().map(|m| m.user_id.0).collect();
    let roles: HashMap<i64, Vec<Id>> = sqlx::query_as::<_, (i64, Vec<i64>)>(
        "SELECT user_id, array_agg(role_id ORDER BY role_id) FROM member_roles WHERE guild_id = $1 AND user_id = ANY($2) GROUP BY user_id",
    )
    .bind(guild_id)
    .bind(&ids)
    .fetch_all(&state.db)
    .await?
    .into_iter()
    .map(|(u, r)| (u, r.into_iter().map(Id).collect()))
    .collect();
    let users: HashMap<Id, UserRow> =
        sqlx::query_as::<_, UserRow>("SELECT * FROM users WHERE id = ANY($1)")
            .bind(&ids)
            .fetch_all(&state.db)
            .await?
            .into_iter()
            .map(|u| (u.id, u))
            .collect();
    Ok(rows
        .into_iter()
        .filter_map(|m| {
            let user = users.get(&m.user_id)?.public();
            Some(Member {
                guild_id: m.guild_id,
                roles: roles.get(&m.user_id.0).cloned().unwrap_or_default(),
                user,
                nick: m.nick,
                joined_at: m.joined_at,
                communication_disabled_until: m.communication_disabled_until,
            })
        })
        .collect())
}

pub async fn members(
    State(state): State<AppState>,
    auth: AuthUser,
    ApiPath(guild_id): ApiPath<Id>,
    ApiQuery(q): ApiQuery<MembersQuery>,
) -> ApiResult<Json<Vec<Member>>> {
    guild_access(&state.db, guild_id, auth.user_id).await?;
    let limit = q.limit.unwrap_or(1000).clamp(1, 1000);
    Ok(Json(
        load_members(&state, guild_id, None, q.after.unwrap_or(Id(0)), limit).await?,
    ))
}
