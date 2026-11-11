//! Messages, attachments, reactions, pins, typing and read states.

use std::collections::{HashMap, HashSet};

use axum::Json;
use axum::extract::{FromRequest, Multipart, Request, State};
use axum::http::{StatusCode, header};
use bytes::Bytes;
use chrono::{DateTime, Utc};
use rand::RngCore;
use serde::Deserialize;
use serde_json::json;

use crate::access::{GuildAccess, GuildMembersAccess, channel_access};
use crate::auth::AuthUser;
use crate::error::{ApiError, ApiJson, ApiPath, ApiQuery, ApiResult};
use crate::gateway::events;
use crate::models::{
    AttachmentRow, Channel, Message, MessageRow, PublicUser, ReactionCount, ReferencedMessage,
    UserRow, message_type,
};
use crate::permissions::{self, has};
use crate::snowflake::{EPOCH, Id};
use crate::state::AppState;

pub const MAX_CONTENT_CHARS: usize = 4000;
const MAX_FILES: usize = 10;
const MAX_PINS: i64 = 50;
const MAX_REACTION_KINDS: i64 = 20;

fn snowflake_time(id: Id) -> DateTime<Utc> {
    DateTime::from_timestamp_millis(id.timestamp_ms() as i64).unwrap_or_default()
}

/// Smallest snowflake for a given point in time.
fn snowflake_at(t: DateTime<Utc>) -> Id {
    Id(((t.timestamp_millis() as u64).saturating_sub(EPOCH) << 22) as i64)
}

// ---------------------------------------------------------------------------
// Hydration
// ---------------------------------------------------------------------------

/// Turns rows into API messages (authors, attachments, reactions, replies).
pub async fn hydrate(
    state: &AppState,
    rows: Vec<MessageRow>,
    guild_id: Option<Id>,
    viewer: Id,
    with_reactions: bool,
) -> ApiResult<Vec<Message>> {
    if rows.is_empty() {
        return Ok(vec![]);
    }
    let db = &state.db;
    let ids: Vec<i64> = rows.iter().map(|m| m.id.0).collect();
    let reply_ids: Vec<i64> = rows
        .iter()
        .filter_map(|m| m.reply_to_id.map(|r| r.0))
        .collect();

    let replied: HashMap<Id, MessageRow> = if reply_ids.is_empty() {
        HashMap::new()
    } else {
        sqlx::query_as::<_, MessageRow>("SELECT * FROM messages WHERE id = ANY($1)")
            .bind(&reply_ids)
            .fetch_all(db)
            .await?
            .into_iter()
            .map(|m| (m.id, m))
            .collect()
    };

    let mut user_ids: HashSet<i64> = rows
        .iter()
        .filter_map(|m| m.author_id.map(|a| a.0))
        .collect();
    user_ids.extend(replied.values().filter_map(|m| m.author_id.map(|a| a.0)));
    let user_ids: Vec<i64> = user_ids.into_iter().collect();
    let users: HashMap<Id, PublicUser> =
        sqlx::query_as::<_, UserRow>("SELECT * FROM users WHERE id = ANY($1)")
            .bind(&user_ids)
            .fetch_all(db)
            .await?
            .into_iter()
            .map(|u| (u.id, u.public()))
            .collect();

    let mut attachments: HashMap<Id, Vec<AttachmentRow>> = HashMap::new();
    let mut attachment_ids = ids.clone();
    attachment_ids.extend(&reply_ids);
    for a in sqlx::query_as::<_, AttachmentRow>(
        "SELECT * FROM attachments WHERE message_id = ANY($1) ORDER BY id",
    )
    .bind(&attachment_ids)
    .fetch_all(db)
    .await?
    {
        if let Some(mid) = a.message_id {
            attachments.entry(mid).or_default().push(a);
        }
    }

    let mut reactions: HashMap<Id, Vec<ReactionCount>> = HashMap::new();
    if with_reactions {
        let rows: Vec<(Id, String, i64, bool)> = sqlx::query_as(
            "SELECT message_id, emoji, count(*), bool_or(user_id = $2)
             FROM reactions WHERE message_id = ANY($1)
             GROUP BY message_id, emoji ORDER BY min(created_at)",
        )
        .bind(&ids)
        .bind(viewer)
        .fetch_all(db)
        .await?;
        for (mid, emoji, count, me) in rows {
            reactions
                .entry(mid)
                .or_default()
                .push(ReactionCount { emoji, count, me });
        }
    }

    Ok(rows
        .into_iter()
        .map(|m| {
            let referenced_message =
                m.reply_to_id
                    .and_then(|r| replied.get(&r))
                    .map(|r| ReferencedMessage {
                        id: r.id,
                        author: r.author_id.and_then(|a| users.get(&a).cloned()),
                        content: r.content.chars().take(300).collect(),
                        has_attachments: attachments.contains_key(&r.id),
                    });
            Message {
                id: m.id,
                channel_id: m.channel_id,
                guild_id,
                author: m.author_id.and_then(|a| users.get(&a).cloned()),
                timestamp: snowflake_time(m.id),
                content: m.content,
                kind: m.kind,
                edited_at: m.edited_at,
                pinned: m.pinned,
                mention_everyone: m.mention_everyone,
                mentions: m.mention_ids.into_iter().map(Id).collect(),
                mention_roles: m.mention_role_ids.into_iter().map(Id).collect(),
                attachments: attachments
                    .remove(&m.id)
                    .unwrap_or_default()
                    .into_iter()
                    .map(AttachmentRow::into_public)
                    .collect(),
                embeds: m.embeds.0,
                reactions: with_reactions.then(|| reactions.remove(&m.id).unwrap_or_default()),
                reply_to_id: m.reply_to_id,
                referenced_message,
                flags: m.flags,
                nonce: None,
            }
        })
        .collect())
}

async fn load_message(state: &AppState, channel_id: Id, message_id: Id) -> ApiResult<MessageRow> {
    sqlx::query_as("SELECT * FROM messages WHERE id = $1 AND channel_id = $2")
        .bind(message_id)
        .bind(channel_id)
        .fetch_optional(&state.db)
        .await?
        .ok_or(ApiError::NotFound("UNKNOWN_MESSAGE"))
}

async fn hydrate_one(
    state: &AppState,
    row: MessageRow,
    guild_id: Option<Id>,
    viewer: Id,
    with_reactions: bool,
) -> ApiResult<Message> {
    hydrate(state, vec![row], guild_id, viewer, with_reactions)
        .await?
        .pop()
        .ok_or(ApiError::NotFound("UNKNOWN_MESSAGE"))
}

fn require(perms: u64, perm: u64) -> ApiResult<()> {
    if has(perms, perm) {
        Ok(())
    } else {
        Err(ApiError::MissingPermissions)
    }
}

// ---------------------------------------------------------------------------
// Mentions
// ---------------------------------------------------------------------------

#[derive(Debug, Default, PartialEq)]
pub struct ParsedMentions {
    pub users: Vec<i64>,
    pub roles: Vec<i64>,
    pub everyone: bool,
}

/// Extracts `<@id>`, `<@&id>` and `@everyone`/`@here` (outside of code spans).
pub fn parse_mentions(content: &str) -> ParsedMentions {
    let mut out = ParsedMentions::default();
    let mut in_code = false;
    let bytes = content.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'`' => {
                in_code = !in_code;
                i += 1;
            }
            b'<' if !in_code && bytes.get(i + 1) == Some(&b'@') => {
                let role = bytes.get(i + 2) == Some(&b'&');
                let start = i + if role { 3 } else { 2 };
                let end = bytes[start..]
                    .iter()
                    .position(|b| !b.is_ascii_digit())
                    .map(|p| start + p)
                    .unwrap_or(bytes.len());
                if end > start && bytes.get(end) == Some(&b'>') {
                    if let Ok(id) = content[start..end].parse::<i64>() {
                        let list = if role { &mut out.roles } else { &mut out.users };
                        if !list.contains(&id) && list.len() < 100 {
                            list.push(id);
                        }
                    }
                    i = end + 1;
                } else {
                    i += 1;
                }
            }
            b'@' if !in_code
                && (content[i..].starts_with("@everyone") || content[i..].starts_with("@here")) =>
            {
                out.everyone = true;
                i += 5;
            }
            _ => i += 1,
        }
    }
    out
}

/// Applies permission rules to parsed mentions.
async fn resolve_mentions(
    state: &AppState,
    access: &GuildAccess,
    perms: u64,
    content: &str,
) -> ApiResult<ParsedMentions> {
    let mut m = parse_mentions(content);
    let can_everyone = has(perms, permissions::MENTION_EVERYONE);
    m.everyone &= can_everyone;
    if !m.roles.is_empty() {
        let mentionable: Vec<i64> = sqlx::query_scalar("SELECT id FROM roles WHERE guild_id = $1 AND id = ANY($2) AND id <> guild_id AND (mentionable OR $3)")
            .bind(access.guild.id)
            .bind(&m.roles)
            .bind(can_everyone)
            .fetch_all(&state.db)
            .await?;
        m.roles.retain(|r| mentionable.contains(r));
    }
    Ok(m)
}

/// Users whose mention counter must increase (members who can see the channel).
async fn mentioned_users(
    state: &AppState,
    channel: &Channel,
    author: Id,
    m: &ParsedMentions,
) -> ApiResult<Vec<i64>> {
    let Some(guild_id) = channel.guild_id else {
        return Ok(vec![]);
    };
    let candidates: Vec<i64> = if m.everyone {
        sqlx::query_scalar("SELECT user_id FROM members WHERE guild_id = $1")
            .bind(guild_id)
            .fetch_all(&state.db)
            .await?
    } else {
        let mut ids = m.users.clone();
        if !m.roles.is_empty() {
            let by_role: Vec<i64> = sqlx::query_scalar("SELECT DISTINCT user_id FROM member_roles WHERE guild_id = $1 AND role_id = ANY($2)")
                .bind(guild_id)
                .bind(&m.roles)
                .fetch_all(&state.db)
                .await?;
            ids.extend(by_role);
        }
        ids.sort_unstable();
        ids.dedup();
        ids
    };
    let candidates: Vec<i64> = candidates.into_iter().filter(|u| *u != author.0).collect();
    if candidates.is_empty() {
        return Ok(vec![]);
    }
    let access = GuildMembersAccess::load(&state.db, guild_id, &candidates).await?;
    Ok(candidates
        .into_iter()
        .filter(|u| access.can_view(*u, channel))
        .collect())
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct ListQuery {
    limit: Option<i64>,
    before: Option<Id>,
    after: Option<Id>,
    around: Option<Id>,
}

pub async fn list(
    State(state): State<AppState>,
    auth: AuthUser,
    ApiPath(channel_id): ApiPath<Id>,
    ApiQuery(q): ApiQuery<ListQuery>,
) -> ApiResult<Json<Vec<Message>>> {
    let (channel, access) = channel_access(&state.db, channel_id, auth.user_id).await?;
    require(
        access.channel_permissions(&channel),
        permissions::READ_MESSAGE_HISTORY,
    )?;
    let limit = q.limit.unwrap_or(50).clamp(1, 100);
    let db = &state.db;
    let rows: Vec<MessageRow> = if let Some(around) = q.around {
        let mut older: Vec<MessageRow> = sqlx::query_as(
            "SELECT * FROM messages WHERE channel_id = $1 AND id < $2 ORDER BY id DESC LIMIT $3",
        )
        .bind(channel_id)
        .bind(around)
        .bind(limit / 2)
        .fetch_all(db)
        .await?;
        older.reverse();
        let newer: Vec<MessageRow> = sqlx::query_as(
            "SELECT * FROM messages WHERE channel_id = $1 AND id >= $2 ORDER BY id ASC LIMIT $3",
        )
        .bind(channel_id)
        .bind(around)
        .bind(limit - limit / 2)
        .fetch_all(db)
        .await?;
        older.extend(newer);
        older
    } else if let Some(after) = q.after {
        sqlx::query_as(
            "SELECT * FROM messages WHERE channel_id = $1 AND id > $2 ORDER BY id ASC LIMIT $3",
        )
        .bind(channel_id)
        .bind(after)
        .bind(limit)
        .fetch_all(db)
        .await?
    } else {
        let mut rows: Vec<MessageRow> = sqlx::query_as(
            "SELECT * FROM messages WHERE channel_id = $1 AND ($2::BIGINT IS NULL OR id < $2) ORDER BY id DESC LIMIT $3",
        )
        .bind(channel_id)
        .bind(q.before)
        .bind(limit)
        .fetch_all(db)
        .await?;
        rows.reverse();
        rows
    };
    Ok(Json(
        hydrate(&state, rows, channel.guild_id, auth.user_id, true).await?,
    ))
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

#[derive(Deserialize, Default)]
pub struct CreateMessage {
    #[serde(default)]
    content: String,
    nonce: Option<String>,
    reply_to_id: Option<Id>,
    /// Whether replying pings the author of the referenced message.
    #[serde(default = "yes")]
    reply_mention: bool,
}

fn yes() -> bool {
    true
}

struct UploadedFile {
    filename: String,
    content_type: String,
    data: Bytes,
}

fn sanitize_filename(name: &str) -> String {
    let base = name.rsplit(['/', '\\']).next().unwrap_or("file");
    let cleaned: String = base
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || matches!(c, '.' | '-' | '_') {
                c
            } else {
                '_'
            }
        })
        .take(120)
        .collect();
    let cleaned = cleaned.trim_start_matches('.').to_owned();
    if cleaned.is_empty() {
        "file".into()
    } else {
        cleaned
    }
}

async fn read_multipart(
    state: &AppState,
    mut mp: Multipart,
) -> ApiResult<(CreateMessage, Vec<UploadedFile>)> {
    let mut payload = CreateMessage::default();
    let mut files = Vec::new();
    while let Some(field) = mp
        .next_field()
        .await
        .map_err(|_| ApiError::BadRequest("INVALID_MULTIPART"))?
    {
        let name = field.name().unwrap_or_default().to_owned();
        if name == "payload_json" {
            let text = field
                .text()
                .await
                .map_err(|_| ApiError::BadRequest("INVALID_MULTIPART"))?;
            payload =
                serde_json::from_str(&text).map_err(|_| ApiError::BadRequest("INVALID_JSON"))?;
        } else if name.starts_with("files") {
            if files.len() >= MAX_FILES {
                return Err(ApiError::field("files", "TOO_MANY_FILES"));
            }
            let filename = sanitize_filename(field.file_name().unwrap_or("file"));
            let content_type = field
                .content_type()
                .unwrap_or("application/octet-stream")
                .to_owned();
            let data = field.bytes().await.map_err(|_| ApiError::PayloadTooLarge)?;
            if data.len() > state.cfg.max_upload_bytes {
                return Err(ApiError::PayloadTooLarge);
            }
            files.push(UploadedFile {
                filename,
                content_type,
                data,
            });
        }
    }
    Ok((payload, files))
}

/// Content types that are safe to render inline from our origin.
pub fn inline_safe(content_type: &str) -> bool {
    matches!(
        content_type,
        "image/png"
            | "image/jpeg"
            | "image/gif"
            | "image/webp"
            | "video/mp4"
            | "video/webm"
            | "audio/mpeg"
            | "audio/ogg"
            | "audio/wav"
            | "audio/webm"
            | "text/plain"
    )
}

pub async fn create(
    State(state): State<AppState>,
    auth: AuthUser,
    ApiPath(channel_id): ApiPath<Id>,
    req: Request,
) -> ApiResult<(StatusCode, Json<Message>)> {
    let is_multipart = req
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.starts_with("multipart/form-data"));
    let (body, files) = if is_multipart {
        let mp = Multipart::from_request(req, &state)
            .await
            .map_err(|_| ApiError::BadRequest("INVALID_MULTIPART"))?;
        read_multipart(&state, mp).await?
    } else {
        let ApiJson(body) = ApiJson::<CreateMessage>::from_request(req, &state).await?;
        (body, vec![])
    };

    let (channel, access) = channel_access(&state.db, channel_id, auth.user_id).await?;
    if channel.kind == permissions::channel_type::GUILD_CATEGORY {
        return Err(ApiError::BadRequest("CANNOT_SEND_IN_CATEGORY"));
    }
    let perms = access.channel_permissions(&channel);
    require(perms, permissions::SEND_MESSAGES)?;
    if !files.is_empty() {
        require(perms, permissions::ATTACH_FILES)?;
    }
    if let Err(retry_after_secs) = state.message_limiter.check(auth.user_id.0) {
        return Err(ApiError::RateLimited { retry_after_secs });
    }
    if channel.rate_limit_per_user > 0
        && !has(
            perms,
            permissions::MANAGE_MESSAGES | permissions::MANAGE_CHANNELS,
        )
    {
        let since = snowflake_at(
            Utc::now() - chrono::Duration::seconds(i64::from(channel.rate_limit_per_user)),
        );
        let recent: bool = sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM messages WHERE channel_id = $1 AND author_id = $2 AND id >= $3)")
            .bind(channel_id)
            .bind(auth.user_id)
            .bind(since)
            .fetch_one(&state.db)
            .await?;
        if recent {
            return Err(ApiError::RateLimited {
                retry_after_secs: channel.rate_limit_per_user as u64,
            });
        }
    }

    let content = body.content.trim_end().to_owned();
    if content.trim().is_empty() && files.is_empty() {
        return Err(ApiError::field("content", "EMPTY_MESSAGE"));
    }
    if content.chars().count() > MAX_CONTENT_CHARS {
        return Err(ApiError::field("content", "TOO_LONG"));
    }
    let nonce = body.nonce.filter(|n| n.len() <= 64);

    let mut mentions = resolve_mentions(&state, &access, perms, &content).await?;
    let (kind, reply_to) = match body.reply_to_id {
        Some(rid) => {
            require(perms, permissions::READ_MESSAGE_HISTORY)?;
            let parent = load_message(&state, channel_id, rid)
                .await
                .map_err(|_| ApiError::field("reply_to_id", "UNKNOWN_MESSAGE"))?;
            if body.reply_mention
                && let Some(a) = parent.author_id.filter(|a| *a != auth.user_id)
                && !mentions.users.contains(&a.0)
            {
                mentions.users.push(a.0);
            }
            (message_type::REPLY, Some(rid))
        }
        None => (message_type::DEFAULT, None),
    };

    // Store files first; rows are inserted in the same transaction as the message.
    let message_id = state.ids.next();
    let mut attachment_rows = Vec::with_capacity(files.len());
    for f in files {
        let mut token = [0u8; 12];
        rand::thread_rng().fill_bytes(&mut token);
        let dims = imagesize::blob_size(&f.data).ok();
        let row = AttachmentRow {
            id: state.ids.next(),
            message_id: Some(message_id),
            channel_id,
            spoiler: f.filename.starts_with("SPOILER_"),
            size: f.data.len() as i64,
            width: dims.as_ref().map(|d| d.width as i32),
            height: dims.as_ref().map(|d| d.height as i32),
            content_type: f.content_type.chars().take(100).collect(),
            filename: f.filename,
            url_token: token.iter().map(|b| format!("{b:02x}")).collect(),
        };
        state
            .storage
            .put(&row.storage_key(), f.data, &row.content_type)
            .await?;
        attachment_rows.push(row);
    }

    let mut tx = state.db.begin().await?;
    let row: MessageRow = sqlx::query_as(
        "INSERT INTO messages (id, channel_id, author_id, content, type, reply_to_id, mention_everyone, mention_ids, mention_role_ids)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *",
    )
    .bind(message_id)
    .bind(channel_id)
    .bind(auth.user_id)
    .bind(&content)
    .bind(kind)
    .bind(reply_to)
    .bind(mentions.everyone)
    .bind(&mentions.users)
    .bind(&mentions.roles)
    .fetch_one(&mut *tx)
    .await?;
    for a in &attachment_rows {
        sqlx::query(
            "INSERT INTO attachments (id, message_id, channel_id, filename, content_type, size, width, height, spoiler, url_token)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
        )
        .bind(a.id)
        .bind(message_id)
        .bind(channel_id)
        .bind(&a.filename)
        .bind(&a.content_type)
        .bind(a.size)
        .bind(a.width)
        .bind(a.height)
        .bind(a.spoiler)
        .bind(&a.url_token)
        .execute(&mut *tx)
        .await?;
    }
    sqlx::query("UPDATE channels SET last_message_id = $2 WHERE id = $1")
        .bind(channel_id)
        .bind(message_id)
        .execute(&mut *tx)
        .await?;
    // The author has read their own message.
    sqlx::query(
        "INSERT INTO read_states (user_id, channel_id, last_message_id) VALUES ($1, $2, $3)
         ON CONFLICT (user_id, channel_id) DO UPDATE SET last_message_id = EXCLUDED.last_message_id, mention_count = 0",
    )
    .bind(auth.user_id)
    .bind(channel_id)
    .bind(message_id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    let pinged = mentioned_users(&state, &channel, auth.user_id, &mentions).await?;
    if !pinged.is_empty() {
        sqlx::query(
            "INSERT INTO read_states (user_id, channel_id, mention_count) SELECT u, $2, 1 FROM unnest($1::BIGINT[]) AS u
             ON CONFLICT (user_id, channel_id) DO UPDATE SET mention_count = read_states.mention_count + 1",
        )
        .bind(&pinged)
        .bind(channel_id)
        .execute(&state.db)
        .await?;
    }

    let mut message = hydrate_one(&state, row, channel.guild_id, auth.user_id, false).await?;
    message.reactions = Some(vec![]);
    message.nonce = nonce;
    state
        .dispatch_to_viewers(&channel, events::MESSAGE_CREATE, &message, None)
        .await?;
    Ok((StatusCode::CREATED, Json(message)))
}

// ---------------------------------------------------------------------------
// Edit / delete
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct EditMessage {
    content: String,
}

pub async fn edit(
    State(state): State<AppState>,
    auth: AuthUser,
    ApiPath((channel_id, message_id)): ApiPath<(Id, Id)>,
    ApiJson(body): ApiJson<EditMessage>,
) -> ApiResult<Json<Message>> {
    let (channel, access) = channel_access(&state.db, channel_id, auth.user_id).await?;
    let row = load_message(&state, channel_id, message_id).await?;
    if row.author_id != Some(auth.user_id) {
        return Err(ApiError::Forbidden("CANNOT_EDIT_OTHERS_MESSAGE"));
    }
    let content = body.content.trim_end().to_owned();
    if content.chars().count() > MAX_CONTENT_CHARS {
        return Err(ApiError::field("content", "TOO_LONG"));
    }
    let has_files: bool =
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM attachments WHERE message_id = $1)")
            .bind(message_id)
            .fetch_one(&state.db)
            .await?;
    if content.trim().is_empty() && !has_files {
        return Err(ApiError::field("content", "EMPTY_MESSAGE"));
    }
    let perms = access.channel_permissions(&channel);
    let mut mentions = resolve_mentions(&state, &access, perms, &content).await?;
    // Keep the reply ping of the original message.
    for id in &row.mention_ids {
        if !mentions.users.contains(id) && row.kind == message_type::REPLY {
            mentions.users.push(*id);
        }
    }
    let row: MessageRow = sqlx::query_as(
        "UPDATE messages SET content = $2, edited_at = now(), mention_everyone = $3, mention_ids = $4, mention_role_ids = $5
         WHERE id = $1 RETURNING *",
    )
    .bind(message_id)
    .bind(&content)
    .bind(mentions.everyone)
    .bind(&mentions.users)
    .bind(&mentions.roles)
    .fetch_one(&state.db)
    .await?;
    let message = hydrate_one(&state, row, channel.guild_id, auth.user_id, false).await?;
    state
        .dispatch_to_viewers(&channel, events::MESSAGE_UPDATE, &message, None)
        .await?;
    Ok(Json(message))
}

pub async fn delete(
    State(state): State<AppState>,
    auth: AuthUser,
    ApiPath((channel_id, message_id)): ApiPath<(Id, Id)>,
) -> ApiResult<StatusCode> {
    let (channel, access) = channel_access(&state.db, channel_id, auth.user_id).await?;
    let row = load_message(&state, channel_id, message_id).await?;
    if row.author_id != Some(auth.user_id) {
        require(
            access.channel_permissions(&channel),
            permissions::MANAGE_MESSAGES,
        )?;
    }
    let files: Vec<AttachmentRow> =
        sqlx::query_as("SELECT * FROM attachments WHERE message_id = $1")
            .bind(message_id)
            .fetch_all(&state.db)
            .await?;
    sqlx::query("DELETE FROM messages WHERE id = $1")
        .bind(message_id)
        .execute(&state.db)
        .await?;
    for f in files {
        if let Err(e) = state.storage.delete(&f.storage_key()).await {
            tracing::warn!(error = ?e, "failed to delete attachment");
        }
    }
    state
        .dispatch_to_viewers(
            &channel,
            events::MESSAGE_DELETE,
            &json!({ "id": message_id, "channel_id": channel_id, "guild_id": channel.guild_id }),
            None,
        )
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------------------
// Reactions
// ---------------------------------------------------------------------------

/// Unicode emoji (short, no whitespace/markup) or custom emoji `name:id`.
pub fn valid_emoji(e: &str) -> bool {
    if e.is_empty() || e.len() > 64 {
        return false;
    }
    if let Some((name, id)) = e.split_once(':') {
        return !name.is_empty()
            && name.len() <= 32
            && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
            && id.parse::<i64>().is_ok();
    }
    e.chars().count() <= 12
        && !e
            .chars()
            .any(|c| c.is_whitespace() || c.is_ascii_alphanumeric() || "<>@#:`*_~|".contains(c))
}

pub async fn add_reaction(
    State(state): State<AppState>,
    auth: AuthUser,
    ApiPath((channel_id, message_id, emoji)): ApiPath<(Id, Id, String)>,
) -> ApiResult<StatusCode> {
    if !valid_emoji(&emoji) {
        return Err(ApiError::BadRequest("INVALID_EMOJI"));
    }
    let (channel, access) = channel_access(&state.db, channel_id, auth.user_id).await?;
    let perms = access.channel_permissions(&channel);
    require(perms, permissions::READ_MESSAGE_HISTORY)?;
    load_message(&state, channel_id, message_id).await?;
    let existing: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM reactions WHERE message_id = $1 AND emoji = $2)",
    )
    .bind(message_id)
    .bind(&emoji)
    .fetch_one(&state.db)
    .await?;
    if !existing {
        // Adding a new emoji needs ADD_REACTIONS; joining an existing one does not.
        require(perms, permissions::ADD_REACTIONS)?;
        let kinds: i64 =
            sqlx::query_scalar("SELECT count(DISTINCT emoji) FROM reactions WHERE message_id = $1")
                .bind(message_id)
                .fetch_one(&state.db)
                .await?;
        if kinds >= MAX_REACTION_KINDS {
            return Err(ApiError::BadRequest("TOO_MANY_REACTIONS"));
        }
    }
    let inserted = sqlx::query("INSERT INTO reactions (message_id, emoji, user_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING")
        .bind(message_id)
        .bind(&emoji)
        .bind(auth.user_id)
        .execute(&state.db)
        .await?
        .rows_affected()
        == 1;
    if inserted {
        let payload = json!({ "channel_id": channel_id, "message_id": message_id, "guild_id": channel.guild_id, "user_id": auth.user_id, "emoji": emoji });
        state
            .dispatch_to_viewers(&channel, events::MESSAGE_REACTION_ADD, &payload, None)
            .await?;
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn remove_reaction_of(
    state: &AppState,
    channel: &Channel,
    message_id: Id,
    emoji: &str,
    user_id: Id,
) -> ApiResult<()> {
    let removed =
        sqlx::query("DELETE FROM reactions WHERE message_id = $1 AND emoji = $2 AND user_id = $3")
            .bind(message_id)
            .bind(emoji)
            .bind(user_id)
            .execute(&state.db)
            .await?
            .rows_affected()
            == 1;
    if removed {
        let payload = json!({ "channel_id": channel.id, "message_id": message_id, "guild_id": channel.guild_id, "user_id": user_id, "emoji": emoji });
        state
            .dispatch_to_viewers(channel, events::MESSAGE_REACTION_REMOVE, &payload, None)
            .await?;
    }
    Ok(())
}

pub async fn remove_own_reaction(
    State(state): State<AppState>,
    auth: AuthUser,
    ApiPath((channel_id, message_id, emoji)): ApiPath<(Id, Id, String)>,
) -> ApiResult<StatusCode> {
    let (channel, _) = channel_access(&state.db, channel_id, auth.user_id).await?;
    remove_reaction_of(&state, &channel, message_id, &emoji, auth.user_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn remove_user_reaction(
    State(state): State<AppState>,
    auth: AuthUser,
    ApiPath((channel_id, message_id, emoji, user_id)): ApiPath<(Id, Id, String, Id)>,
) -> ApiResult<StatusCode> {
    let (channel, access) = channel_access(&state.db, channel_id, auth.user_id).await?;
    if user_id != auth.user_id {
        require(
            access.channel_permissions(&channel),
            permissions::MANAGE_MESSAGES,
        )?;
    }
    remove_reaction_of(&state, &channel, message_id, &emoji, user_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------------------
// Pins
// ---------------------------------------------------------------------------

pub async fn pins(
    State(state): State<AppState>,
    auth: AuthUser,
    ApiPath(channel_id): ApiPath<Id>,
) -> ApiResult<Json<Vec<Message>>> {
    let (channel, access) = channel_access(&state.db, channel_id, auth.user_id).await?;
    require(
        access.channel_permissions(&channel),
        permissions::READ_MESSAGE_HISTORY,
    )?;
    let rows: Vec<MessageRow> =
        sqlx::query_as("SELECT * FROM messages WHERE channel_id = $1 AND pinned ORDER BY id DESC")
            .bind(channel_id)
            .fetch_all(&state.db)
            .await?;
    Ok(Json(
        hydrate(&state, rows, channel.guild_id, auth.user_id, false).await?,
    ))
}

async fn set_pinned(
    state: &AppState,
    auth: AuthUser,
    channel_id: Id,
    message_id: Id,
    pinned: bool,
) -> ApiResult<StatusCode> {
    let (channel, access) = channel_access(&state.db, channel_id, auth.user_id).await?;
    require(
        access.channel_permissions(&channel),
        permissions::MANAGE_MESSAGES,
    )?;
    let row = load_message(state, channel_id, message_id).await?;
    if row.pinned == pinned {
        return Ok(StatusCode::NO_CONTENT);
    }
    if pinned {
        let count: i64 =
            sqlx::query_scalar("SELECT count(*) FROM messages WHERE channel_id = $1 AND pinned")
                .bind(channel_id)
                .fetch_one(&state.db)
                .await?;
        if count >= MAX_PINS {
            return Err(ApiError::BadRequest("TOO_MANY_PINS"));
        }
    }
    let row: MessageRow =
        sqlx::query_as("UPDATE messages SET pinned = $2 WHERE id = $1 RETURNING *")
            .bind(message_id)
            .bind(pinned)
            .fetch_one(&state.db)
            .await?;
    let message = hydrate_one(state, row, channel.guild_id, auth.user_id, false).await?;
    state
        .dispatch_to_viewers(&channel, events::MESSAGE_UPDATE, &message, None)
        .await?;
    state
        .dispatch_to_viewers(
            &channel,
            events::CHANNEL_PINS_UPDATE,
            &json!({ "channel_id": channel_id, "guild_id": channel.guild_id }),
            None,
        )
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn pin(
    State(state): State<AppState>,
    auth: AuthUser,
    ApiPath((channel_id, message_id)): ApiPath<(Id, Id)>,
) -> ApiResult<StatusCode> {
    set_pinned(&state, auth, channel_id, message_id, true).await
}

pub async fn unpin(
    State(state): State<AppState>,
    auth: AuthUser,
    ApiPath((channel_id, message_id)): ApiPath<(Id, Id)>,
) -> ApiResult<StatusCode> {
    set_pinned(&state, auth, channel_id, message_id, false).await
}

// ---------------------------------------------------------------------------
// Typing & read states
// ---------------------------------------------------------------------------

pub async fn typing(
    State(state): State<AppState>,
    auth: AuthUser,
    ApiPath(channel_id): ApiPath<Id>,
) -> ApiResult<StatusCode> {
    let (channel, access) = channel_access(&state.db, channel_id, auth.user_id).await?;
    require(
        access.channel_permissions(&channel),
        permissions::SEND_MESSAGES,
    )?;
    let payload = json!({ "channel_id": channel_id, "guild_id": channel.guild_id, "user_id": auth.user_id, "timestamp": Utc::now().timestamp() });
    state
        .dispatch_to_viewers(&channel, events::TYPING_START, &payload, Some(auth.user_id))
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn ack(
    State(state): State<AppState>,
    auth: AuthUser,
    ApiPath((channel_id, message_id)): ApiPath<(Id, Id)>,
) -> ApiResult<StatusCode> {
    channel_access(&state.db, channel_id, auth.user_id).await?;
    sqlx::query(
        "INSERT INTO read_states (user_id, channel_id, last_message_id, mention_count) VALUES ($1, $2, $3, 0)
         ON CONFLICT (user_id, channel_id) DO UPDATE
         SET last_message_id = GREATEST(read_states.last_message_id, EXCLUDED.last_message_id), mention_count = 0",
    )
    .bind(auth.user_id)
    .bind(channel_id)
    .bind(message_id)
    .execute(&state.db)
    .await?;
    state.dispatch(
        [auth.user_id.0],
        events::MESSAGE_ACK,
        &json!({ "channel_id": channel_id, "message_id": message_id }),
    );
    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mentions_are_parsed_outside_code() {
        let m = parse_mentions("hi <@123> and <@&456> @everyone `<@789>` <@abc> <@12");
        assert_eq!(m.users, vec![123]);
        assert_eq!(m.roles, vec![456]);
        assert!(m.everyone);
        assert_eq!(parse_mentions("`@here`"), ParsedMentions::default());
        assert!(parse_mentions("@here now").everyone);
        assert_eq!(parse_mentions("<@1> <@1>").users, vec![1]);
    }

    #[test]
    fn emoji_validation() {
        assert!(valid_emoji("👍"));
        assert!(valid_emoji("❤️"));
        assert!(valid_emoji("👨‍👩‍👧"));
        assert!(valid_emoji("party_blob:123456"));
        assert!(!valid_emoji("abc"));
        assert!(!valid_emoji("<script>"));
        assert!(!valid_emoji(""));
        assert!(!valid_emoji("bad name:1"));
    }

    #[test]
    fn filenames_are_sanitized() {
        assert_eq!(sanitize_filename("../../etc/passwd"), "passwd");
        assert_eq!(sanitize_filename("my file (1).png"), "my_file__1_.png");
        assert_eq!(sanitize_filename(".hidden"), "hidden");
        assert_eq!(sanitize_filename(""), "file");
        assert_eq!(sanitize_filename("Größe.txt"), "Größe.txt");
    }

    #[test]
    fn snowflake_time_roundtrip() {
        let now = Utc::now();
        let id = snowflake_at(now);
        assert!((snowflake_time(id) - now).num_milliseconds().abs() <= 1);
    }
}
