//! WebSocket gateway: connection handling, READY payloads and event fan-out helpers.

pub mod conn;
pub mod hub;

use std::collections::HashMap;

use chrono::{DateTime, Utc};
use serde::Serialize;

use crate::access::{GuildMembersAccess, load_overwrites};
use crate::error::ApiResult;
use crate::models::{Channel, Emoji, GuildPayload, GuildRow, Presence, Role, UserRow};
use crate::permissions::{self, MemberContext, RoleInfo};
use crate::snowflake::Id;
use crate::state::AppState;

pub mod events {
    pub const READY: &str = "READY";
    pub const GUILD_CREATE: &str = "GUILD_CREATE";
    pub const GUILD_UPDATE: &str = "GUILD_UPDATE";
    pub const GUILD_DELETE: &str = "GUILD_DELETE";
    pub const CHANNEL_CREATE: &str = "CHANNEL_CREATE";
    pub const CHANNEL_UPDATE: &str = "CHANNEL_UPDATE";
    pub const CHANNEL_DELETE: &str = "CHANNEL_DELETE";
    pub const GUILD_MEMBER_ADD: &str = "GUILD_MEMBER_ADD";
    pub const GUILD_MEMBER_REMOVE: &str = "GUILD_MEMBER_REMOVE";
    pub const PRESENCE_UPDATE: &str = "PRESENCE_UPDATE";
    pub const USER_UPDATE: &str = "USER_UPDATE";
    pub const MESSAGE_CREATE: &str = "MESSAGE_CREATE";
    pub const MESSAGE_UPDATE: &str = "MESSAGE_UPDATE";
    pub const MESSAGE_DELETE: &str = "MESSAGE_DELETE";
    pub const MESSAGE_REACTION_ADD: &str = "MESSAGE_REACTION_ADD";
    pub const MESSAGE_REACTION_REMOVE: &str = "MESSAGE_REACTION_REMOVE";
    pub const MESSAGE_ACK: &str = "MESSAGE_ACK";
    pub const CHANNEL_PINS_UPDATE: &str = "CHANNEL_PINS_UPDATE";
    pub const TYPING_START: &str = "TYPING_START";
    pub const GUILD_EMOJIS_UPDATE: &str = "GUILD_EMOJIS_UPDATE";
}

impl AppState {
    pub fn dispatch<I: IntoIterator<Item = i64>, T: Serialize>(
        &self,
        users: I,
        event: &str,
        data: &T,
    ) {
        match serde_json::to_string(data) {
            Ok(json) => self.hub.dispatch(users, event, &json),
            Err(e) => tracing::error!(error = %e, event, "failed to serialize event"),
        }
    }

    pub fn dispatch_guild<T: Serialize>(&self, guild_id: Id, event: &str, data: &T) {
        self.dispatch(self.hub.guild_users(guild_id.0), event, data);
    }

    /// Connected users split into (can view `channel`, cannot view).
    async fn split_viewers(&self, channel: &Channel) -> ApiResult<(Vec<i64>, Vec<i64>)> {
        let Some(guild_id) = channel.guild_id else {
            return Ok((vec![], vec![]));
        };
        let users = self.hub.guild_users(guild_id.0);
        if users.is_empty() {
            return Ok((vec![], vec![]));
        }
        let access = GuildMembersAccess::load(&self.db, guild_id, &users).await?;
        Ok(users
            .into_iter()
            .partition(|u| access.can_view(*u, channel)))
    }

    /// Sends a channel event only to members who can see the channel. For updates,
    /// members who lost access receive CHANNEL_DELETE instead.
    pub async fn dispatch_channel(&self, channel: &Channel, event: &str) -> ApiResult<()> {
        let (visible, hidden) = self.split_viewers(channel).await?;
        self.dispatch(visible, event, channel);
        if event == events::CHANNEL_UPDATE && !hidden.is_empty() {
            self.dispatch(hidden, events::CHANNEL_DELETE, channel);
        }
        Ok(())
    }

    /// Sends an event about something inside `channel` to everyone who can see it.
    pub async fn dispatch_to_viewers<T: Serialize>(
        &self,
        channel: &Channel,
        event: &str,
        data: &T,
        exclude: Option<Id>,
    ) -> ApiResult<()> {
        let (mut visible, _) = self.split_viewers(channel).await?;
        if let Some(ex) = exclude {
            visible.retain(|u| *u != ex.0);
        }
        self.dispatch(visible, event, data);
        Ok(())
    }

    /// Broadcasts the user's current presence to everyone sharing a guild.
    pub async fn broadcast_presence(&self, user_id: Id) -> ApiResult<()> {
        let targets = self.hub.co_members(user_id.0);
        if targets.is_empty() {
            return Ok(());
        }
        let user: UserRow = sqlx::query_as("SELECT * FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_one(&self.db)
            .await?;
        let presence = self.presence_of(&user);
        self.dispatch(targets, events::PRESENCE_UPDATE, &presence);
        Ok(())
    }

    pub fn presence_of(&self, user: &UserRow) -> Presence {
        let online = self.hub.is_online(user.id.0);
        let status = if online {
            user.visible_status()
        } else {
            "offline"
        };
        Presence {
            user_id: user.id,
            status: status.to_owned(),
            custom_status: if status == "offline" {
                None
            } else {
                user.custom_status()
            },
        }
    }

    /// Builds full guild payloads for `user_id` (all guilds, or only `only`).
    pub async fn guild_payloads(
        &self,
        user_id: Id,
        only: Option<Id>,
    ) -> ApiResult<Vec<GuildPayload>> {
        let db = &self.db;
        let guilds: Vec<GuildRow> = sqlx::query_as(
            "SELECT g.* FROM guilds g JOIN members m ON m.guild_id = g.id
             WHERE m.user_id = $1 AND ($2::BIGINT IS NULL OR g.id = $2) ORDER BY m.joined_at",
        )
        .bind(user_id)
        .bind(only)
        .fetch_all(db)
        .await?;
        if guilds.is_empty() {
            return Ok(vec![]);
        }
        let ids: Vec<i64> = guilds.iter().map(|g| g.id.0).collect();
        let roles: Vec<Role> =
            sqlx::query_as("SELECT * FROM roles WHERE guild_id = ANY($1) ORDER BY position, id")
                .bind(&ids)
                .fetch_all(db)
                .await?;
        let mut channels: Vec<Channel> =
            sqlx::query_as("SELECT * FROM channels WHERE guild_id = ANY($1) AND NOT (type = 11 AND archived) ORDER BY position, id")
                .bind(&ids)
                .fetch_all(db)
                .await?;
        let channel_ids: Vec<i64> = channels.iter().map(|c| c.id.0).collect();
        let mut overwrites = load_overwrites(db, &channel_ids).await?;
        for c in &mut channels {
            if c.kind != permissions::channel_type::PUBLIC_THREAD {
                c.permission_overwrites = overwrites.remove(&c.id).unwrap_or_default();
            }
        }
        // Threads inherit the overwrites of their parent channel.
        let parents: HashMap<Id, Vec<crate::models::Overwrite>> = channels
            .iter()
            .filter(|c| c.kind != permissions::channel_type::PUBLIC_THREAD)
            .map(|c| (c.id, c.permission_overwrites.clone()))
            .collect();
        for c in channels
            .iter_mut()
            .filter(|c| c.kind == permissions::channel_type::PUBLIC_THREAD)
        {
            c.permission_overwrites = c
                .parent_id
                .and_then(|p| parents.get(&p).cloned())
                .unwrap_or_default();
        }
        type MineRow = (Id, DateTime<Utc>, Option<DateTime<Utc>>, Option<Vec<i64>>);
        let mine: Vec<MineRow> = sqlx::query_as(
            "SELECT m.guild_id, m.joined_at, m.communication_disabled_until,
                    (SELECT array_agg(mr.role_id) FROM member_roles mr WHERE mr.guild_id = m.guild_id AND mr.user_id = m.user_id)
             FROM members m WHERE m.user_id = $1 AND m.guild_id = ANY($2)",
        )
        .bind(user_id)
        .bind(&ids)
        .fetch_all(db)
        .await?;
        let counts: HashMap<Id, i64> = sqlx::query_as::<_, (Id, i64)>(
            "SELECT guild_id, count(*) FROM members WHERE guild_id = ANY($1) GROUP BY guild_id",
        )
        .bind(&ids)
        .fetch_all(db)
        .await?
        .into_iter()
        .collect();
        let mine: HashMap<Id, _> = mine
            .into_iter()
            .map(|(g, j, t, r)| (g, (j, t, r.unwrap_or_default())))
            .collect();

        let mut emojis_by_guild: HashMap<Id, Vec<Emoji>> = HashMap::new();
        for e in
            sqlx::query_as::<_, Emoji>("SELECT * FROM emojis WHERE guild_id = ANY($1) ORDER BY id")
                .bind(&ids)
                .fetch_all(db)
                .await?
        {
            emojis_by_guild.entry(e.guild_id).or_default().push(e);
        }
        let mut roles_by_guild: HashMap<Id, Vec<Role>> = HashMap::new();
        for r in roles {
            roles_by_guild.entry(r.guild_id).or_default().push(r);
        }
        let mut channels_by_guild: HashMap<Id, Vec<Channel>> = HashMap::new();
        for c in channels {
            if let Some(g) = c.guild_id {
                channels_by_guild.entry(g).or_default().push(c);
            }
        }

        let now = Utc::now();
        let mut out = Vec::with_capacity(guilds.len());
        for guild in guilds {
            let Some((joined_at, timeout, my_roles)) = mine.get(&guild.id).cloned() else {
                continue;
            };
            let roles = roles_by_guild.remove(&guild.id).unwrap_or_default();
            let infos: Vec<RoleInfo> = roles
                .iter()
                .map(|r| RoleInfo {
                    id: r.id.0,
                    permissions: r.permissions as u64,
                    position: r.position,
                })
                .collect();
            let ctx = MemberContext {
                guild_id: guild.id.0,
                owner_id: guild.owner_id.0,
                user_id: user_id.0,
                roles: &infos,
                member_roles: &my_roles,
                timed_out: timeout.is_some_and(|t| t > now),
            };
            let channels = channels_by_guild
                .remove(&guild.id)
                .unwrap_or_default()
                .into_iter()
                .filter(|c| {
                    permissions::has(
                        ctx.channel(&c.overwrite_infos(), c.kind),
                        permissions::VIEW_CHANNEL,
                    )
                })
                .collect();
            let emojis = emojis_by_guild.remove(&guild.id).unwrap_or_default();
            out.push(GuildPayload {
                emojis,
                member_count: counts.get(&guild.id).copied().unwrap_or(0),
                guild,
                roles,
                channels,
                joined_at,
                my_roles: my_roles.into_iter().map(Id).collect(),
                my_communication_disabled_until: timeout,
            });
        }
        Ok(out)
    }

    /// Presences of online members across the given guilds.
    pub async fn guild_presences(&self, guild_ids: &[i64]) -> ApiResult<Vec<Presence>> {
        let user_ids: Vec<i64> =
            sqlx::query_scalar("SELECT DISTINCT user_id FROM members WHERE guild_id = ANY($1)")
                .bind(guild_ids)
                .fetch_all(&self.db)
                .await?;
        let online: Vec<i64> = user_ids
            .into_iter()
            .filter(|u| self.hub.is_online(*u))
            .collect();
        if online.is_empty() {
            return Ok(vec![]);
        }
        let users: Vec<UserRow> = sqlx::query_as("SELECT * FROM users WHERE id = ANY($1)")
            .bind(&online)
            .fetch_all(&self.db)
            .await?;
        Ok(users
            .iter()
            .map(|u| self.presence_of(u))
            .filter(|p| p.status != "offline")
            .collect())
    }
}
