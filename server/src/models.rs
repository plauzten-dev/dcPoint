//! Database rows and API payloads.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use sqlx::FromRow;

use crate::snowflake::Id;

/// Serializes permission bitmasks as strings (they exceed JS safe integers eventually).
pub mod perm_str {
    use super::*;

    pub fn serialize<S: Serializer>(v: &i64, s: S) -> Result<S::Ok, S::Error> {
        s.collect_str(&(*v as u64))
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<i64, D::Error> {
        #[derive(Deserialize)]
        #[serde(untagged)]
        enum Raw {
            S(String),
            N(u64),
        }
        let v = match Raw::deserialize(d)? {
            Raw::S(s) => s.parse::<u64>().map_err(serde::de::Error::custom)?,
            Raw::N(n) => n,
        };
        Ok((v & crate::permissions::ALL) as i64)
    }
}

/// Distinguishes "field absent" (`None`) from "field set to null" (`Some(None)`).
pub fn double_option<'de, T: Deserialize<'de>, D: Deserializer<'de>>(
    d: D,
) -> Result<Option<Option<T>>, D::Error> {
    Option::<T>::deserialize(d).map(Some)
}

#[derive(Clone, Debug, FromRow)]
pub struct UserRow {
    pub id: Id,
    pub username: String,
    pub email: String,
    pub display_name: Option<String>,
    pub password_hash: String,
    pub avatar: Option<String>,
    pub banner: Option<String>,
    pub bio: String,
    pub pronouns: String,
    pub accent_color: Option<i32>,
    pub status: String,
    pub custom_status_text: Option<String>,
    pub custom_status_emoji: Option<String>,
    pub custom_status_expires_at: Option<DateTime<Utc>>,
    pub totp_secret: Option<String>,
    pub totp_last_step: Option<i64>,
    pub created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Serialize)]
pub struct PublicUser {
    pub id: Id,
    pub username: String,
    pub display_name: Option<String>,
    pub avatar: Option<String>,
    pub banner: Option<String>,
    pub bio: String,
    pub pronouns: String,
    pub accent_color: Option<i32>,
    pub created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct CustomStatus {
    pub text: Option<String>,
    pub emoji: Option<String>,
    pub expires_at: Option<DateTime<Utc>>,
}

#[derive(Clone, Debug, Serialize)]
pub struct PrivateUser {
    #[serde(flatten)]
    pub user: PublicUser,
    pub email: String,
    pub mfa_enabled: bool,
    pub status: String,
    pub custom_status: Option<CustomStatus>,
}

impl UserRow {
    pub fn public(&self) -> PublicUser {
        PublicUser {
            id: self.id,
            username: self.username.clone(),
            display_name: self.display_name.clone(),
            avatar: self.avatar.clone(),
            banner: self.banner.clone(),
            bio: self.bio.clone(),
            pronouns: self.pronouns.clone(),
            accent_color: self.accent_color,
            created_at: self.created_at,
        }
    }

    pub fn private(&self) -> PrivateUser {
        PrivateUser {
            user: self.public(),
            email: self.email.clone(),
            mfa_enabled: self.totp_secret.is_some(),
            status: self.status.clone(),
            custom_status: self.custom_status(),
        }
    }

    pub fn custom_status(&self) -> Option<CustomStatus> {
        if self.custom_status_text.is_none() && self.custom_status_emoji.is_none() {
            return None;
        }
        if self
            .custom_status_expires_at
            .is_some_and(|e| e <= Utc::now())
        {
            return None;
        }
        Some(CustomStatus {
            text: self.custom_status_text.clone(),
            emoji: self.custom_status_emoji.clone(),
            expires_at: self.custom_status_expires_at,
        })
    }

    /// Status as seen by other users: invisible users appear offline.
    pub fn visible_status(&self) -> &str {
        if self.status == "invisible" {
            "offline"
        } else {
            &self.status
        }
    }
}

#[derive(Clone, Debug, FromRow, Serialize)]
pub struct GuildRow {
    pub id: Id,
    pub name: String,
    pub icon: Option<String>,
    pub description: Option<String>,
    pub owner_id: Id,
    pub created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, FromRow, Serialize)]
pub struct Role {
    pub id: Id,
    pub guild_id: Id,
    pub name: String,
    pub color: i32,
    pub hoist: bool,
    pub mentionable: bool,
    pub position: i32,
    #[serde(with = "perm_str")]
    pub permissions: i64,
}

#[derive(Clone, Debug, FromRow, Serialize)]
pub struct Overwrite {
    #[serde(skip)]
    pub channel_id: Id,
    #[serde(rename = "id")]
    pub target_id: Id,
    #[serde(rename = "type")]
    pub kind: i16,
    #[serde(with = "perm_str")]
    pub allow: i64,
    #[serde(with = "perm_str")]
    pub deny: i64,
}

impl Overwrite {
    pub fn info(&self) -> crate::permissions::Overwrite {
        crate::permissions::Overwrite {
            target_id: self.target_id.0,
            kind: self.kind,
            allow: self.allow as u64,
            deny: self.deny as u64,
        }
    }
}

#[derive(Clone, Debug, FromRow, Serialize)]
pub struct Channel {
    pub id: Id,
    pub guild_id: Option<Id>,
    #[serde(rename = "type")]
    #[sqlx(rename = "type")]
    pub kind: i16,
    pub name: String,
    pub topic: Option<String>,
    pub position: i32,
    pub parent_id: Option<Id>,
    pub nsfw: bool,
    pub bitrate: Option<i32>,
    pub user_limit: Option<i32>,
    pub rate_limit_per_user: i32,
    pub last_message_id: Option<Id>,
    #[sqlx(skip)]
    pub permission_overwrites: Vec<Overwrite>,
}

impl Channel {
    pub fn overwrite_infos(&self) -> Vec<crate::permissions::Overwrite> {
        self.permission_overwrites
            .iter()
            .map(Overwrite::info)
            .collect()
    }
}

#[derive(Clone, Debug, FromRow)]
pub struct MemberRow {
    pub guild_id: Id,
    pub user_id: Id,
    pub nick: Option<String>,
    pub joined_at: DateTime<Utc>,
    pub communication_disabled_until: Option<DateTime<Utc>>,
}

#[derive(Clone, Debug, Serialize)]
pub struct Member {
    pub guild_id: Id,
    pub user: PublicUser,
    pub nick: Option<String>,
    pub roles: Vec<Id>,
    pub joined_at: DateTime<Utc>,
    pub communication_disabled_until: Option<DateTime<Utc>>,
}

#[derive(Clone, Debug, Serialize)]
pub struct Presence {
    pub user_id: Id,
    pub status: String,
    pub custom_status: Option<CustomStatus>,
}

/// Full guild object as sent in READY / GUILD_CREATE.
#[derive(Clone, Debug, Serialize)]
pub struct GuildPayload {
    #[serde(flatten)]
    pub guild: GuildRow,
    pub roles: Vec<Role>,
    pub channels: Vec<Channel>,
    pub member_count: i64,
    pub joined_at: DateTime<Utc>,
    /// The receiving user's own member roles.
    pub my_roles: Vec<Id>,
    pub my_communication_disabled_until: Option<DateTime<Utc>>,
}

#[derive(Clone, Debug, FromRow)]
pub struct InviteRow {
    pub code: String,
    pub guild_id: Id,
    pub channel_id: Id,
    pub inviter_id: Option<Id>,
    pub max_uses: i32,
    pub uses: i32,
    pub max_age: i32,
    pub created_at: DateTime<Utc>,
    pub expires_at: Option<DateTime<Utc>>,
}

impl InviteRow {
    pub fn is_valid(&self) -> bool {
        self.expires_at.is_none_or(|e| e > Utc::now())
            && (self.max_uses == 0 || self.uses < self.max_uses)
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct InviteGuild {
    pub id: Id,
    pub name: String,
    pub icon: Option<String>,
    pub description: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct InviteChannel {
    pub id: Id,
    pub name: String,
    #[serde(rename = "type")]
    pub kind: i16,
}

#[derive(Clone, Debug, Serialize)]
pub struct Invite {
    pub code: String,
    pub guild: InviteGuild,
    pub channel: InviteChannel,
    pub inviter: Option<PublicUser>,
    pub uses: i32,
    pub max_uses: i32,
    pub max_age: i32,
    pub created_at: DateTime<Utc>,
    pub expires_at: Option<DateTime<Utc>>,
    pub approximate_member_count: i64,
    pub approximate_presence_count: i64,
}
