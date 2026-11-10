//! Loading permission contexts from the database.

use std::collections::HashMap;

use chrono::{DateTime, Utc};
use sqlx::PgPool;

use crate::error::{ApiError, ApiResult};
use crate::models::{Channel, GuildRow, Overwrite};
use crate::permissions::{self, MemberContext, RoleInfo};
use crate::snowflake::Id;

/// A user's resolved standing in one guild.
pub struct GuildAccess {
    pub guild: GuildRow,
    pub user_id: Id,
    pub roles: Vec<RoleInfo>,
    pub member_roles: Vec<i64>,
    pub timed_out: bool,
}

impl GuildAccess {
    pub fn ctx(&self) -> MemberContext<'_> {
        MemberContext {
            guild_id: self.guild.id.0,
            owner_id: self.guild.owner_id.0,
            user_id: self.user_id.0,
            roles: &self.roles,
            member_roles: &self.member_roles,
            timed_out: self.timed_out,
        }
    }

    pub fn is_owner(&self) -> bool {
        self.guild.owner_id == self.user_id
    }

    pub fn require(&self, perm: u64) -> ApiResult<()> {
        if permissions::has(self.ctx().base(), perm) {
            Ok(())
        } else {
            Err(ApiError::MissingPermissions)
        }
    }

    pub fn channel_permissions(&self, channel: &Channel) -> u64 {
        self.ctx().channel(&channel.overwrite_infos(), channel.kind)
    }

    pub fn require_channel(&self, channel: &Channel, perm: u64) -> ApiResult<()> {
        if permissions::has(self.channel_permissions(channel), perm) {
            Ok(())
        } else {
            Err(ApiError::MissingPermissions)
        }
    }
}

fn is_timed_out(until: Option<DateTime<Utc>>) -> bool {
    until.is_some_and(|u| u > Utc::now())
}

pub async fn guild_access(db: &PgPool, guild_id: Id, user_id: Id) -> ApiResult<GuildAccess> {
    let member: Option<(Option<DateTime<Utc>>,)> = sqlx::query_as(
        "SELECT communication_disabled_until FROM members WHERE guild_id = $1 AND user_id = $2",
    )
    .bind(guild_id)
    .bind(user_id)
    .fetch_optional(db)
    .await?;
    let (until,) = member.ok_or(ApiError::NotFound("UNKNOWN_GUILD"))?;
    let guild: GuildRow = sqlx::query_as("SELECT * FROM guilds WHERE id = $1")
        .bind(guild_id)
        .fetch_one(db)
        .await?;
    let rows: Vec<(i64, i64, i32, bool)> = sqlx::query_as(
        "SELECT r.id, r.permissions, r.position,
                EXISTS (SELECT 1 FROM member_roles mr WHERE mr.role_id = r.id AND mr.user_id = $2)
         FROM roles r WHERE r.guild_id = $1",
    )
    .bind(guild_id)
    .bind(user_id)
    .fetch_all(db)
    .await?;
    let member_roles = rows.iter().filter(|r| r.3).map(|r| r.0).collect();
    let roles = rows
        .into_iter()
        .map(|(id, p, position, _)| RoleInfo {
            id,
            permissions: p as u64,
            position,
        })
        .collect();
    Ok(GuildAccess {
        guild,
        user_id,
        roles,
        member_roles,
        timed_out: is_timed_out(until),
    })
}

pub async fn load_overwrites(
    db: &PgPool,
    channel_ids: &[i64],
) -> ApiResult<HashMap<Id, Vec<Overwrite>>> {
    let rows: Vec<Overwrite> =
        sqlx::query_as("SELECT * FROM permission_overwrites WHERE channel_id = ANY($1)")
            .bind(channel_ids)
            .fetch_all(db)
            .await?;
    let mut map: HashMap<Id, Vec<Overwrite>> = HashMap::new();
    for ow in rows {
        map.entry(ow.channel_id).or_default().push(ow);
    }
    Ok(map)
}

pub async fn fetch_channel(db: &PgPool, channel_id: Id) -> ApiResult<Channel> {
    let mut channel: Channel = sqlx::query_as("SELECT * FROM channels WHERE id = $1")
        .bind(channel_id)
        .fetch_optional(db)
        .await?
        .ok_or(ApiError::NotFound("UNKNOWN_CHANNEL"))?;
    channel.permission_overwrites = load_overwrites(db, &[channel_id.0])
        .await?
        .remove(&channel_id)
        .unwrap_or_default();
    Ok(channel)
}

/// Loads a guild channel and the caller's access; hidden channels are reported as unknown.
pub async fn channel_access(
    db: &PgPool,
    channel_id: Id,
    user_id: Id,
) -> ApiResult<(Channel, GuildAccess)> {
    let channel = fetch_channel(db, channel_id).await?;
    let guild_id = channel
        .guild_id
        .ok_or(ApiError::NotFound("UNKNOWN_CHANNEL"))?;
    let access = guild_access(db, guild_id, user_id)
        .await
        .map_err(|_| ApiError::NotFound("UNKNOWN_CHANNEL"))?;
    if !permissions::has(
        access.channel_permissions(&channel),
        permissions::VIEW_CHANNEL,
    ) {
        return Err(ApiError::NotFound("UNKNOWN_CHANNEL"));
    }
    Ok((channel, access))
}

/// Permission contexts for many members of one guild at once (used for event fan-out).
pub struct GuildMembersAccess {
    pub guild_id: i64,
    pub owner_id: i64,
    pub roles: Vec<RoleInfo>,
    pub members: HashMap<i64, (Vec<i64>, bool)>,
}

impl GuildMembersAccess {
    pub async fn load(db: &PgPool, guild_id: Id, user_ids: &[i64]) -> ApiResult<Self> {
        let (owner_id,): (i64,) = sqlx::query_as("SELECT owner_id FROM guilds WHERE id = $1")
            .bind(guild_id)
            .fetch_one(db)
            .await?;
        let roles: Vec<(i64, i64, i32)> =
            sqlx::query_as("SELECT id, permissions, position FROM roles WHERE guild_id = $1")
                .bind(guild_id)
                .fetch_all(db)
                .await?;
        type Row = (i64, Option<DateTime<Utc>>, Option<Vec<i64>>);
        let rows: Vec<Row> = sqlx::query_as(
            "SELECT m.user_id, m.communication_disabled_until,
                    (SELECT array_agg(mr.role_id) FROM member_roles mr WHERE mr.guild_id = m.guild_id AND mr.user_id = m.user_id)
             FROM members m WHERE m.guild_id = $1 AND m.user_id = ANY($2)",
        )
        .bind(guild_id)
        .bind(user_ids)
        .fetch_all(db)
        .await?;
        Ok(Self {
            guild_id: guild_id.0,
            owner_id,
            roles: roles
                .into_iter()
                .map(|(id, p, position)| RoleInfo {
                    id,
                    permissions: p as u64,
                    position,
                })
                .collect(),
            members: rows
                .into_iter()
                .map(|(u, until, r)| (u, (r.unwrap_or_default(), is_timed_out(until))))
                .collect(),
        })
    }

    pub fn can_view(&self, user_id: i64, channel: &Channel) -> bool {
        let Some((member_roles, timed_out)) = self.members.get(&user_id) else {
            return false;
        };
        let ctx = MemberContext {
            guild_id: self.guild_id,
            owner_id: self.owner_id,
            user_id,
            roles: &self.roles,
            member_roles,
            timed_out: *timed_out,
        };
        permissions::has(
            ctx.channel(&channel.overwrite_infos(), channel.kind),
            permissions::VIEW_CHANNEL,
        )
    }
}
