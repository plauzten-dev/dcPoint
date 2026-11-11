use std::collections::HashMap;

use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use serde::Deserialize;

use crate::access::{channel_access, fetch_channel, guild_access, load_overwrites};
use crate::auth::AuthUser;
use crate::error::{ApiError, ApiJson, ApiPath, ApiResult, FieldErrors};
use crate::gateway::events;
use crate::models::{Channel, Overwrite, double_option};
use crate::permissions::{self, OVERWRITE_MEMBER, OVERWRITE_ROLE, channel_type};
use crate::snowflake::Id;
use crate::state::AppState;
use crate::validation;

#[derive(Deserialize)]
pub struct CreateChannel {
    name: String,
    #[serde(rename = "type", default)]
    kind: i16,
    parent_id: Option<Id>,
    topic: Option<String>,
    #[serde(default)]
    private: bool,
}

fn is_guild_type(kind: i16) -> bool {
    matches!(
        kind,
        channel_type::GUILD_TEXT | channel_type::GUILD_VOICE | channel_type::GUILD_CATEGORY
    )
}

async fn category_of(state: &AppState, guild_id: Id, parent_id: Id) -> ApiResult<Channel> {
    let parent = fetch_channel(&state.db, parent_id)
        .await
        .map_err(|_| ApiError::field("parent_id", "INVALID_PARENT"))?;
    if parent.guild_id != Some(guild_id) || parent.kind != channel_type::GUILD_CATEGORY {
        return Err(ApiError::field("parent_id", "INVALID_PARENT"));
    }
    Ok(parent)
}

async fn replace_overwrites(
    tx: &mut sqlx::PgConnection,
    channel_id: Id,
    overwrites: &[Overwrite],
) -> ApiResult<()> {
    sqlx::query("DELETE FROM permission_overwrites WHERE channel_id = $1")
        .bind(channel_id)
        .execute(&mut *tx)
        .await?;
    for ow in overwrites {
        sqlx::query("INSERT INTO permission_overwrites (channel_id, target_id, kind, allow, deny) VALUES ($1, $2, $3, $4, $5)")
            .bind(channel_id)
            .bind(ow.target_id)
            .bind(ow.kind)
            .bind(ow.allow)
            .bind(ow.deny)
            .execute(&mut *tx)
            .await?;
    }
    Ok(())
}

pub async fn create(
    State(state): State<AppState>,
    auth: AuthUser,
    ApiPath(guild_id): ApiPath<Id>,
    ApiJson(body): ApiJson<CreateChannel>,
) -> ApiResult<(StatusCode, Json<Channel>)> {
    let access = guild_access(&state.db, guild_id, auth.user_id).await?;
    access.require(permissions::MANAGE_CHANNELS)?;
    let mut errors = FieldErrors::new();
    if !is_guild_type(body.kind) {
        errors.insert("type", "INVALID_CHANNEL_TYPE");
    }
    let name = validation::channel_name(
        &mut errors,
        &body.name,
        body.kind == channel_type::GUILD_TEXT,
    );
    let topic = body
        .topic
        .as_deref()
        .and_then(|t| validation::text(&mut errors, "topic", t, 1024));
    if !errors.is_empty() {
        return Err(ApiError::Validation(errors));
    }
    let parent = match body.parent_id {
        Some(_) if body.kind == channel_type::GUILD_CATEGORY => {
            return Err(ApiError::field("parent_id", "INVALID_PARENT"));
        }
        Some(pid) => Some(category_of(&state, guild_id, pid).await?),
        None => None,
    };

    let id = state.ids.next();
    // New channels inherit (sync with) the category permissions.
    let mut overwrites: Vec<Overwrite> = parent
        .as_ref()
        .map(|p| {
            p.permission_overwrites
                .iter()
                .map(|o| Overwrite {
                    channel_id: id,
                    ..o.clone()
                })
                .collect()
        })
        .unwrap_or_default();
    if body.private {
        let deny = if body.kind == channel_type::GUILD_VOICE {
            permissions::VIEW_CHANNEL | permissions::CONNECT
        } else {
            permissions::VIEW_CHANNEL
        };
        overwrites.retain(|o| !(o.kind == OVERWRITE_ROLE && o.target_id == guild_id));
        overwrites.push(Overwrite {
            channel_id: id,
            target_id: guild_id,
            kind: OVERWRITE_ROLE,
            allow: 0,
            deny: deny as i64,
        });
        overwrites.retain(|o| !(o.kind == OVERWRITE_MEMBER && o.target_id == auth.user_id));
        overwrites.push(Overwrite {
            channel_id: id,
            target_id: auth.user_id,
            kind: OVERWRITE_MEMBER,
            allow: deny as i64,
            deny: 0,
        });
    }

    let voice = body.kind == channel_type::GUILD_VOICE;
    let mut tx = state.db.begin().await?;
    let mut channel: Channel = sqlx::query_as(
        "INSERT INTO channels (id, guild_id, type, name, topic, parent_id, bitrate, user_limit, position)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
                 (SELECT COALESCE(MAX(position) + 1, 0) FROM channels
                  WHERE guild_id = $2 AND parent_id IS NOT DISTINCT FROM $6 AND (type = 4) = ($3 = 4)))
         RETURNING *",
    )
    .bind(id)
    .bind(guild_id)
    .bind(body.kind)
    .bind(&name)
    .bind(&topic)
    .bind(parent.as_ref().map(|p| p.id))
    .bind(voice.then_some(64_000))
    .bind(voice.then_some(0))
    .fetch_one(&mut *tx)
    .await?;
    replace_overwrites(&mut tx, id, &overwrites).await?;
    tx.commit().await?;
    channel.permission_overwrites = overwrites;

    state
        .dispatch_channel(&channel, events::CHANNEL_CREATE)
        .await?;
    Ok((StatusCode::CREATED, Json(channel)))
}

pub async fn get(
    State(state): State<AppState>,
    auth: AuthUser,
    ApiPath(channel_id): ApiPath<Id>,
) -> ApiResult<Json<Channel>> {
    Ok(Json(
        channel_access(&state.db, channel_id, auth.user_id).await?.0,
    ))
}

#[derive(Deserialize)]
pub struct UpdateChannel {
    name: Option<String>,
    #[serde(default, deserialize_with = "double_option")]
    topic: Option<Option<String>>,
    nsfw: Option<bool>,
    user_limit: Option<i32>,
    bitrate: Option<i32>,
    rate_limit_per_user: Option<i32>,
    /// Threads only.
    archived: Option<bool>,
}

pub async fn update(
    State(state): State<AppState>,
    auth: AuthUser,
    ApiPath(channel_id): ApiPath<Id>,
    ApiJson(body): ApiJson<UpdateChannel>,
) -> ApiResult<Json<Channel>> {
    let (mut channel, access) = channel_access(&state.db, channel_id, auth.user_id).await?;
    let thread = channel.kind == channel_type::PUBLIC_THREAD;
    if thread {
        // Thread owners may rename/archive their own threads.
        if channel.owner_id != Some(auth.user_id) {
            access.require_channel(&channel, permissions::MANAGE_THREADS)?;
        }
    } else {
        access.require_channel(&channel, permissions::MANAGE_CHANNELS)?;
    }
    let mut errors = FieldErrors::new();
    if let Some(name) = body.name {
        channel.name = if thread {
            thread_name(&mut errors, &name)
        } else {
            validation::channel_name(&mut errors, &name, channel.kind == channel_type::GUILD_TEXT)
        };
    }
    if let (true, Some(archived)) = (thread, body.archived) {
        channel.archived = archived;
    }
    if let Some(topic) = body.topic {
        channel.topic = topic.and_then(|t| validation::text(&mut errors, "topic", &t, 1024));
    }
    if let Some(nsfw) = body.nsfw {
        channel.nsfw = nsfw;
    }
    if channel.kind == channel_type::GUILD_VOICE {
        if let Some(limit) = body.user_limit {
            if !(0..=99).contains(&limit) {
                errors.insert("user_limit", "OUT_OF_RANGE");
            }
            channel.user_limit = Some(limit);
        }
        if let Some(bitrate) = body.bitrate {
            if !(8_000..=384_000).contains(&bitrate) {
                errors.insert("bitrate", "OUT_OF_RANGE");
            }
            channel.bitrate = Some(bitrate);
        }
    }
    if let Some(rl) = body.rate_limit_per_user {
        if !(0..=21_600).contains(&rl) {
            errors.insert("rate_limit_per_user", "OUT_OF_RANGE");
        }
        channel.rate_limit_per_user = rl;
    }
    if !errors.is_empty() {
        return Err(ApiError::Validation(errors));
    }
    sqlx::query(
        "UPDATE channels SET name = $2, topic = $3, nsfw = $4, user_limit = $5, bitrate = $6, rate_limit_per_user = $7,
                archived = $8 WHERE id = $1",
    )
    .bind(channel.id)
    .bind(&channel.name)
    .bind(&channel.topic)
    .bind(channel.nsfw)
    .bind(channel.user_limit)
    .bind(channel.bitrate)
    .bind(channel.rate_limit_per_user)
    .bind(channel.archived)
    .execute(&state.db)
    .await?;
    state
        .dispatch_channel(&channel, events::CHANNEL_UPDATE)
        .await?;
    Ok(Json(channel))
}

fn thread_name(errors: &mut FieldErrors, v: &str) -> String {
    let name = v.trim().to_owned();
    if !(1..=100).contains(&name.chars().count()) {
        errors.insert("name", "CHANNEL_NAME_LENGTH");
    }
    name
}

#[derive(Deserialize)]
pub struct CreateThread {
    name: String,
    /// Starter message (optional).
    message_id: Option<Id>,
}

/// Creates a thread below a text channel, optionally attached to a message.
pub async fn create_thread(
    State(state): State<AppState>,
    auth: AuthUser,
    ApiPath(parent_id): ApiPath<Id>,
    ApiJson(body): ApiJson<CreateThread>,
) -> ApiResult<(StatusCode, Json<Channel>)> {
    let (parent, access) = channel_access(&state.db, parent_id, auth.user_id).await?;
    if parent.kind != channel_type::GUILD_TEXT {
        return Err(ApiError::BadRequest("THREADS_NOT_ALLOWED"));
    }
    access.require_channel(
        &parent,
        permissions::CREATE_PUBLIC_THREADS | permissions::READ_MESSAGE_HISTORY,
    )?;
    let mut errors = FieldErrors::new();
    let name = thread_name(&mut errors, &body.name);
    if !errors.is_empty() {
        return Err(ApiError::Validation(errors));
    }
    if let Some(mid) = body.message_id {
        let exists: bool = sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM messages WHERE id = $1 AND channel_id = $2)",
        )
        .bind(mid)
        .bind(parent_id)
        .fetch_one(&state.db)
        .await?;
        if !exists {
            return Err(ApiError::field("message_id", "UNKNOWN_MESSAGE"));
        }
    }
    let id = state.ids.next();
    let mut thread: Channel = sqlx::query_as(
        "INSERT INTO channels (id, guild_id, type, name, parent_id, owner_id, thread_message_id)
         VALUES ($1, $2, 11, $3, $4, $5, $6) RETURNING *",
    )
    .bind(id)
    .bind(parent.guild_id)
    .bind(&name)
    .bind(parent_id)
    .bind(auth.user_id)
    .bind(body.message_id)
    .fetch_one(&state.db)
    .await
    .map_err(|e| {
        if crate::error::is_unique_violation(&e, "channels_thread_message_id_key") {
            ApiError::BadRequest("THREAD_ALREADY_EXISTS")
        } else {
            e.into()
        }
    })?;
    thread.permission_overwrites = parent.permission_overwrites.clone();
    state
        .dispatch_channel(&thread, events::CHANNEL_CREATE)
        .await?;
    if let Some(mid) = body.message_id {
        let row: crate::models::MessageRow = sqlx::query_as("SELECT * FROM messages WHERE id = $1")
            .bind(mid)
            .fetch_one(&state.db)
            .await?;
        if let Some(m) =
            super::messages::hydrate(&state, vec![row], parent.guild_id, auth.user_id, false)
                .await?
                .pop()
        {
            state
                .dispatch_to_viewers(&parent, events::MESSAGE_UPDATE, &m, None)
                .await?;
        }
    }
    Ok((StatusCode::CREATED, Json(thread)))
}

/// All threads of a text channel (active first, including archived ones).
pub async fn list_threads(
    State(state): State<AppState>,
    auth: AuthUser,
    ApiPath(parent_id): ApiPath<Id>,
) -> ApiResult<Json<Vec<Channel>>> {
    let (parent, _) = channel_access(&state.db, parent_id, auth.user_id).await?;
    let mut threads: Vec<Channel> = sqlx::query_as(
        "SELECT * FROM channels WHERE parent_id = $1 AND type = 11 ORDER BY archived, COALESCE(last_message_id, id) DESC LIMIT 100",
    )
    .bind(parent_id)
    .fetch_all(&state.db)
    .await?;
    for t in &mut threads {
        t.permission_overwrites = parent.permission_overwrites.clone();
    }
    Ok(Json(threads))
}

pub async fn delete(
    State(state): State<AppState>,
    auth: AuthUser,
    ApiPath(channel_id): ApiPath<Id>,
) -> ApiResult<Json<Channel>> {
    let (channel, access) = channel_access(&state.db, channel_id, auth.user_id).await?;
    let perm = if channel.kind == channel_type::PUBLIC_THREAD {
        permissions::MANAGE_THREADS
    } else {
        permissions::MANAGE_CHANNELS
    };
    access.require_channel(&channel, perm)?;
    let guild_id = access.guild.id;
    // Threads die with their channel; channels of a category move to the top level.
    let threads: Vec<Channel> =
        sqlx::query_as("DELETE FROM channels WHERE parent_id = $1 AND type = 11 RETURNING *")
            .bind(channel.id)
            .fetch_all(&state.db)
            .await?;
    for mut t in threads {
        t.permission_overwrites = channel.permission_overwrites.clone();
        state.dispatch_channel(&t, events::CHANNEL_DELETE).await?;
    }
    let children: Vec<Id> = sqlx::query_scalar("SELECT id FROM channels WHERE parent_id = $1")
        .bind(channel.id)
        .fetch_all(&state.db)
        .await?;
    sqlx::query("DELETE FROM channels WHERE id = $1")
        .bind(channel.id)
        .execute(&state.db)
        .await?;
    state
        .dispatch_channel(&channel, events::CHANNEL_DELETE)
        .await?;
    // Children of a deleted category move to the top level (FK: ON DELETE SET NULL).
    for child in children {
        let c = fetch_channel(&state.db, child).await?;
        if c.guild_id == Some(guild_id) {
            state.dispatch_channel(&c, events::CHANNEL_UPDATE).await?;
        }
    }
    Ok(Json(channel))
}

#[derive(Deserialize)]
pub struct PositionUpdate {
    id: Id,
    position: Option<i32>,
    #[serde(default, deserialize_with = "double_option")]
    parent_id: Option<Option<Id>>,
    #[serde(default)]
    lock_permissions: bool,
}

/// Bulk update of positions and categories (drag & drop).
pub async fn reorder(
    State(state): State<AppState>,
    auth: AuthUser,
    ApiPath(guild_id): ApiPath<Id>,
    ApiJson(body): ApiJson<Vec<PositionUpdate>>,
) -> ApiResult<StatusCode> {
    let access = guild_access(&state.db, guild_id, auth.user_id).await?;
    access.require(permissions::MANAGE_CHANNELS)?;
    if body.is_empty() || body.len() > 500 {
        return Err(ApiError::BadRequest("INVALID_POSITIONS"));
    }
    let mut channels: HashMap<Id, Channel> =
        sqlx::query_as::<_, Channel>("SELECT * FROM channels WHERE guild_id = $1")
            .bind(guild_id)
            .fetch_all(&state.db)
            .await?
            .into_iter()
            .map(|c| (c.id, c))
            .collect();
    let ids: Vec<i64> = channels.keys().map(|i| i.0).collect();
    let mut overwrites = load_overwrites(&state.db, &ids).await?;
    for c in channels.values_mut() {
        c.permission_overwrites = overwrites.remove(&c.id).unwrap_or_default();
    }

    let mut changed = Vec::new();
    let mut tx = state.db.begin().await?;
    for upd in &body {
        let current = channels
            .get(&upd.id)
            .ok_or(ApiError::BadRequest("UNKNOWN_CHANNEL"))?;
        if current.kind == channel_type::PUBLIC_THREAD {
            return Err(ApiError::BadRequest("INVALID_POSITIONS"));
        }
        let mut next = current.clone();
        if let Some(position) = upd.position {
            next.position = position.max(0);
        }
        if let Some(parent) = upd.parent_id {
            if let Some(pid) = parent {
                let p = channels
                    .get(&pid)
                    .ok_or(ApiError::field("parent_id", "INVALID_PARENT"))?;
                if p.kind != channel_type::GUILD_CATEGORY
                    || next.kind == channel_type::GUILD_CATEGORY
                {
                    return Err(ApiError::field("parent_id", "INVALID_PARENT"));
                }
                if upd.lock_permissions {
                    next.permission_overwrites = p
                        .permission_overwrites
                        .iter()
                        .map(|o| Overwrite {
                            channel_id: next.id,
                            ..o.clone()
                        })
                        .collect();
                    replace_overwrites(&mut tx, next.id, &next.permission_overwrites).await?;
                }
            }
            next.parent_id = parent;
        }
        // Moving a channel requires permission to manage it.
        access.require_channel(current, permissions::MANAGE_CHANNELS)?;
        sqlx::query("UPDATE channels SET position = $2, parent_id = $3 WHERE id = $1")
            .bind(next.id)
            .bind(next.position)
            .bind(next.parent_id)
            .execute(&mut *tx)
            .await?;
        changed.push(next);
    }
    tx.commit().await?;
    for c in &changed {
        state.dispatch_channel(c, events::CHANNEL_UPDATE).await?;
    }
    Ok(StatusCode::NO_CONTENT)
}
