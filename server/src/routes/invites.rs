use std::collections::HashMap;

use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use chrono::{Duration, Utc};
use rand::Rng;
use serde::Deserialize;

use crate::access::{channel_access, guild_access};
use crate::auth::AuthUser;
use crate::error::{ApiError, ApiJson, ApiPath, ApiResult, is_unique_violation};
use crate::gateway::events;
use crate::models::{
    GuildPayload, GuildRow, Invite, InviteChannel, InviteGuild, InviteRow, PublicUser, UserRow,
};
use crate::permissions;
use crate::snowflake::Id;
use crate::state::AppState;

use super::guilds::{guild_payload, load_members};

const CODE_ALPHABET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
const MAX_AGES: [i32; 7] = [0, 1800, 3600, 21_600, 43_200, 86_400, 604_800];
const MAX_USES: [i32; 7] = [0, 1, 5, 10, 25, 50, 100];

fn new_code() -> String {
    let mut rng = rand::thread_rng();
    (0..8)
        .map(|_| CODE_ALPHABET[rng.gen_range(0..CODE_ALPHABET.len())] as char)
        .collect()
}

#[derive(Deserialize)]
pub struct CreateInvite {
    #[serde(default = "default_max_age")]
    max_age: i32,
    #[serde(default)]
    max_uses: i32,
}

fn default_max_age() -> i32 {
    604_800
}

async fn build_invites(state: &AppState, rows: Vec<InviteRow>) -> ApiResult<Vec<Invite>> {
    if rows.is_empty() {
        return Ok(vec![]);
    }
    let guild_ids: Vec<i64> = rows.iter().map(|r| r.guild_id.0).collect();
    let channel_ids: Vec<i64> = rows.iter().map(|r| r.channel_id.0).collect();
    let inviter_ids: Vec<i64> = rows
        .iter()
        .filter_map(|r| r.inviter_id.map(|i| i.0))
        .collect();
    let guilds: HashMap<Id, GuildRow> =
        sqlx::query_as::<_, GuildRow>("SELECT * FROM guilds WHERE id = ANY($1)")
            .bind(&guild_ids)
            .fetch_all(&state.db)
            .await?
            .into_iter()
            .map(|g| (g.id, g))
            .collect();
    let channels: HashMap<Id, (String, i16)> = sqlx::query_as::<_, (Id, String, i16)>(
        "SELECT id, name, type FROM channels WHERE id = ANY($1)",
    )
    .bind(&channel_ids)
    .fetch_all(&state.db)
    .await?
    .into_iter()
    .map(|(id, n, k)| (id, (n, k)))
    .collect();
    let inviters: HashMap<Id, PublicUser> =
        sqlx::query_as::<_, UserRow>("SELECT * FROM users WHERE id = ANY($1)")
            .bind(&inviter_ids)
            .fetch_all(&state.db)
            .await?
            .into_iter()
            .map(|u| (u.id, u.public()))
            .collect();
    let mut counts: HashMap<Id, (i64, i64)> = HashMap::new();
    for g in guilds.keys() {
        let members: Vec<i64> =
            sqlx::query_scalar("SELECT user_id FROM members WHERE guild_id = $1")
                .bind(g)
                .fetch_all(&state.db)
                .await?;
        let online = members.iter().filter(|u| state.hub.is_online(**u)).count() as i64;
        counts.insert(*g, (members.len() as i64, online));
    }
    Ok(rows
        .into_iter()
        .filter_map(|r| {
            let g = guilds.get(&r.guild_id)?;
            let (cname, ckind) = channels.get(&r.channel_id)?.clone();
            let (members, online) = counts.get(&r.guild_id).copied().unwrap_or_default();
            Some(Invite {
                guild: InviteGuild {
                    id: g.id,
                    name: g.name.clone(),
                    icon: g.icon.clone(),
                    description: g.description.clone(),
                },
                channel: InviteChannel {
                    id: r.channel_id,
                    name: cname,
                    kind: ckind,
                },
                inviter: r.inviter_id.and_then(|i| inviters.get(&i).cloned()),
                code: r.code,
                uses: r.uses,
                max_uses: r.max_uses,
                max_age: r.max_age,
                created_at: r.created_at,
                expires_at: r.expires_at,
                approximate_member_count: members,
                approximate_presence_count: online,
            })
        })
        .collect())
}

async fn load_invite(state: &AppState, code: &str) -> ApiResult<InviteRow> {
    sqlx::query_as("SELECT * FROM invites WHERE code = $1")
        .bind(code)
        .fetch_optional(&state.db)
        .await?
        .filter(InviteRow::is_valid)
        .ok_or(ApiError::NotFound("UNKNOWN_INVITE"))
}

pub async fn create(
    State(state): State<AppState>,
    auth: AuthUser,
    ApiPath(channel_id): ApiPath<Id>,
    ApiJson(body): ApiJson<CreateInvite>,
) -> ApiResult<(StatusCode, Json<Invite>)> {
    let (channel, access) = channel_access(&state.db, channel_id, auth.user_id).await?;
    access.require_channel(&channel, permissions::CREATE_INSTANT_INVITE)?;
    if !MAX_AGES.contains(&body.max_age) {
        return Err(ApiError::field("max_age", "INVALID_MAX_AGE"));
    }
    if !MAX_USES.contains(&body.max_uses) {
        return Err(ApiError::field("max_uses", "INVALID_MAX_USES"));
    }
    let expires_at =
        (body.max_age > 0).then(|| Utc::now() + Duration::seconds(i64::from(body.max_age)));
    for _ in 0..5 {
        let row = sqlx::query_as::<_, InviteRow>(
            "INSERT INTO invites (code, guild_id, channel_id, inviter_id, max_uses, max_age, expires_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *",
        )
        .bind(new_code())
        .bind(access.guild.id)
        .bind(channel.id)
        .bind(auth.user_id)
        .bind(body.max_uses)
        .bind(body.max_age)
        .bind(expires_at)
        .fetch_one(&state.db)
        .await;
        match row {
            Ok(row) => {
                let invite = build_invites(&state, vec![row])
                    .await?
                    .pop()
                    .ok_or(ApiError::NotFound("UNKNOWN_INVITE"))?;
                return Ok((StatusCode::CREATED, Json(invite)));
            }
            Err(e) if is_unique_violation(&e, "invites_pkey") => continue,
            Err(e) => return Err(e.into()),
        }
    }
    Err(ApiError::Internal(anyhow::anyhow!(
        "could not allocate invite code"
    )))
}

pub async fn get(
    State(state): State<AppState>,
    ApiPath(code): ApiPath<String>,
) -> ApiResult<Json<Invite>> {
    let row = load_invite(&state, &code).await?;
    Ok(Json(
        build_invites(&state, vec![row])
            .await?
            .pop()
            .ok_or(ApiError::NotFound("UNKNOWN_INVITE"))?,
    ))
}

pub async fn list_for_guild(
    State(state): State<AppState>,
    auth: AuthUser,
    ApiPath(guild_id): ApiPath<Id>,
) -> ApiResult<Json<Vec<Invite>>> {
    let access = guild_access(&state.db, guild_id, auth.user_id).await?;
    access.require(permissions::MANAGE_GUILD)?;
    let rows: Vec<InviteRow> =
        sqlx::query_as("SELECT * FROM invites WHERE guild_id = $1 ORDER BY created_at DESC")
            .bind(guild_id)
            .fetch_all(&state.db)
            .await?;
    let rows = rows.into_iter().filter(InviteRow::is_valid).collect();
    Ok(Json(build_invites(&state, rows).await?))
}

/// Joins the guild. Already being a member is not an error.
pub async fn accept(
    State(state): State<AppState>,
    auth: AuthUser,
    ApiPath(code): ApiPath<String>,
) -> ApiResult<Json<GuildPayload>> {
    let invite = load_invite(&state, &code).await?;
    let mut tx = state.db.begin().await?;
    let inserted = sqlx::query(
        "INSERT INTO members (guild_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    )
    .bind(invite.guild_id)
    .bind(auth.user_id)
    .execute(&mut *tx)
    .await?
    .rows_affected()
        == 1;
    if inserted {
        // Count the use atomically and respect max_uses under concurrency.
        let ok = sqlx::query("UPDATE invites SET uses = uses + 1 WHERE code = $1 AND (max_uses = 0 OR uses < max_uses)")
            .bind(&invite.code)
            .execute(&mut *tx)
            .await?
            .rows_affected()
            == 1;
        if !ok {
            return Err(ApiError::NotFound("UNKNOWN_INVITE"));
        }
    }
    tx.commit().await?;

    let payload = guild_payload(&state, auth.user_id, invite.guild_id).await?;
    if inserted {
        if let Some(member) =
            load_members(&state, invite.guild_id, Some(&[auth.user_id.0]), Id(0), 1)
                .await?
                .pop()
        {
            state.dispatch_guild(invite.guild_id, events::GUILD_MEMBER_ADD, &member);
        }
        state.hub.subscribe(auth.user_id.0, invite.guild_id.0);
        state.dispatch([auth.user_id.0], events::GUILD_CREATE, &payload);
        state.broadcast_presence(auth.user_id).await?;
    }
    Ok(Json(payload))
}

pub async fn delete(
    State(state): State<AppState>,
    auth: AuthUser,
    ApiPath(code): ApiPath<String>,
) -> ApiResult<StatusCode> {
    let invite: InviteRow = sqlx::query_as("SELECT * FROM invites WHERE code = $1")
        .bind(&code)
        .fetch_optional(&state.db)
        .await?
        .ok_or(ApiError::NotFound("UNKNOWN_INVITE"))?;
    let access = guild_access(&state.db, invite.guild_id, auth.user_id).await?;
    if invite.inviter_id != Some(auth.user_id) {
        access.require(permissions::MANAGE_GUILD)?;
    }
    sqlx::query("DELETE FROM invites WHERE code = $1")
        .bind(&code)
        .execute(&state.db)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
