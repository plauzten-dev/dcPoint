//! Permission bitmasks and the permission resolution algorithm.
//!
//! Pure functions only - everything here is unit tested and mirrored in
//! `web/src/lib/permissions.ts`.

pub const CREATE_INSTANT_INVITE: u64 = 1 << 0;
pub const KICK_MEMBERS: u64 = 1 << 1;
pub const BAN_MEMBERS: u64 = 1 << 2;
pub const ADMINISTRATOR: u64 = 1 << 3;
pub const MANAGE_CHANNELS: u64 = 1 << 4;
pub const MANAGE_GUILD: u64 = 1 << 5;
pub const ADD_REACTIONS: u64 = 1 << 6;
pub const VIEW_AUDIT_LOG: u64 = 1 << 7;
pub const PRIORITY_SPEAKER: u64 = 1 << 8;
pub const STREAM: u64 = 1 << 9;
pub const VIEW_CHANNEL: u64 = 1 << 10;
pub const SEND_MESSAGES: u64 = 1 << 11;
pub const SEND_TTS_MESSAGES: u64 = 1 << 12;
pub const MANAGE_MESSAGES: u64 = 1 << 13;
pub const EMBED_LINKS: u64 = 1 << 14;
pub const ATTACH_FILES: u64 = 1 << 15;
pub const READ_MESSAGE_HISTORY: u64 = 1 << 16;
pub const MENTION_EVERYONE: u64 = 1 << 17;
pub const USE_EXTERNAL_EMOJIS: u64 = 1 << 18;
pub const CONNECT: u64 = 1 << 20;
pub const SPEAK: u64 = 1 << 21;
pub const MUTE_MEMBERS: u64 = 1 << 22;
pub const DEAFEN_MEMBERS: u64 = 1 << 23;
pub const MOVE_MEMBERS: u64 = 1 << 24;
pub const USE_VAD: u64 = 1 << 25;
pub const CHANGE_NICKNAME: u64 = 1 << 26;
pub const MANAGE_NICKNAMES: u64 = 1 << 27;
pub const MANAGE_ROLES: u64 = 1 << 28;
pub const MANAGE_WEBHOOKS: u64 = 1 << 29;
pub const MANAGE_EMOJIS: u64 = 1 << 30;
pub const MANAGE_THREADS: u64 = 1 << 34;
pub const CREATE_PUBLIC_THREADS: u64 = 1 << 35;
pub const CREATE_PRIVATE_THREADS: u64 = 1 << 36;
pub const SEND_MESSAGES_IN_THREADS: u64 = 1 << 38;
pub const MODERATE_MEMBERS: u64 = 1 << 40;

pub const ALL: u64 = CREATE_INSTANT_INVITE
    | KICK_MEMBERS
    | BAN_MEMBERS
    | ADMINISTRATOR
    | MANAGE_CHANNELS
    | MANAGE_GUILD
    | ADD_REACTIONS
    | VIEW_AUDIT_LOG
    | PRIORITY_SPEAKER
    | STREAM
    | VIEW_CHANNEL
    | SEND_MESSAGES
    | SEND_TTS_MESSAGES
    | MANAGE_MESSAGES
    | EMBED_LINKS
    | ATTACH_FILES
    | READ_MESSAGE_HISTORY
    | MENTION_EVERYONE
    | USE_EXTERNAL_EMOJIS
    | CONNECT
    | SPEAK
    | MUTE_MEMBERS
    | DEAFEN_MEMBERS
    | MOVE_MEMBERS
    | USE_VAD
    | CHANGE_NICKNAME
    | MANAGE_NICKNAMES
    | MANAGE_ROLES
    | MANAGE_WEBHOOKS
    | MANAGE_EMOJIS
    | MANAGE_THREADS
    | CREATE_PUBLIC_THREADS
    | CREATE_PRIVATE_THREADS
    | SEND_MESSAGES_IN_THREADS
    | MODERATE_MEMBERS;

/// Permissions granted to `@everyone` in a new guild.
pub const DEFAULT_EVERYONE: u64 = CREATE_INSTANT_INVITE
    | ADD_REACTIONS
    | STREAM
    | VIEW_CHANNEL
    | SEND_MESSAGES
    | EMBED_LINKS
    | ATTACH_FILES
    | READ_MESSAGE_HISTORY
    | USE_EXTERNAL_EMOJIS
    | CONNECT
    | SPEAK
    | USE_VAD
    | CHANGE_NICKNAME
    | CREATE_PUBLIC_THREADS
    | SEND_MESSAGES_IN_THREADS;

/// Permissions that only make sense in voice channels.
const VOICE_ONLY: u64 = CONNECT
    | SPEAK
    | STREAM
    | MUTE_MEMBERS
    | DEAFEN_MEMBERS
    | MOVE_MEMBERS
    | USE_VAD
    | PRIORITY_SPEAKER;

pub const OVERWRITE_ROLE: i16 = 0;
pub const OVERWRITE_MEMBER: i16 = 1;

pub mod channel_type {
    pub const GUILD_TEXT: i16 = 0;
    pub const DM: i16 = 1;
    pub const GUILD_VOICE: i16 = 2;
    pub const GROUP_DM: i16 = 3;
    pub const GUILD_CATEGORY: i16 = 4;
}

#[derive(Clone, Copy, Debug)]
pub struct RoleInfo {
    pub id: i64,
    pub permissions: u64,
    pub position: i32,
}

#[derive(Clone, Copy, Debug)]
pub struct Overwrite {
    pub target_id: i64,
    pub kind: i16,
    pub allow: u64,
    pub deny: u64,
}

/// Everything needed to resolve the permissions of one guild member.
#[derive(Clone, Debug)]
pub struct MemberContext<'a> {
    pub guild_id: i64,
    pub owner_id: i64,
    pub user_id: i64,
    /// All roles of the guild (including `@everyone`, whose id equals the guild id).
    pub roles: &'a [RoleInfo],
    /// Role ids assigned to the member (without `@everyone`).
    pub member_roles: &'a [i64],
    /// Whether the member is currently timed out.
    pub timed_out: bool,
}

impl MemberContext<'_> {
    pub fn is_owner(&self) -> bool {
        self.user_id == self.owner_id
    }

    fn role(&self, id: i64) -> Option<&RoleInfo> {
        self.roles.iter().find(|r| r.id == id)
    }

    /// Guild-level permissions.
    pub fn base(&self) -> u64 {
        if self.is_owner() {
            return ALL;
        }
        let mut perms = self.role(self.guild_id).map_or(0, |r| r.permissions);
        for id in self.member_roles {
            if let Some(r) = self.role(*id) {
                perms |= r.permissions;
            }
        }
        if perms & ADMINISTRATOR != 0 {
            return ALL;
        }
        if self.timed_out {
            perms &= VIEW_CHANNEL | READ_MESSAGE_HISTORY;
        }
        perms
    }

    /// Effective permissions in a channel with the given overwrites.
    pub fn channel(&self, overwrites: &[Overwrite], channel_type: i16) -> u64 {
        let base = self.base();
        if base & ADMINISTRATOR != 0 {
            return ALL;
        }
        let mut perms = base;
        if let Some(ow) = overwrites
            .iter()
            .find(|o| o.kind == OVERWRITE_ROLE && o.target_id == self.guild_id)
        {
            perms = (perms & !ow.deny) | ow.allow;
        }
        let (mut allow, mut deny) = (0u64, 0u64);
        for ow in overwrites
            .iter()
            .filter(|o| o.kind == OVERWRITE_ROLE && self.member_roles.contains(&o.target_id))
        {
            allow |= ow.allow;
            deny |= ow.deny;
        }
        perms = (perms & !deny) | allow;
        if let Some(ow) = overwrites
            .iter()
            .find(|o| o.kind == OVERWRITE_MEMBER && o.target_id == self.user_id)
        {
            perms = (perms & !ow.deny) | ow.allow;
        }
        if self.timed_out {
            perms &= VIEW_CHANNEL | READ_MESSAGE_HISTORY;
        }
        finalize(perms, channel_type)
    }

    /// Position of the highest role. The owner outranks everybody.
    pub fn top_position(&self) -> i32 {
        if self.is_owner() {
            return i32::MAX;
        }
        self.member_roles
            .iter()
            .filter_map(|id| self.role(*id))
            .map(|r| r.position)
            .max()
            .unwrap_or(0)
    }

    /// Whether this member may moderate (kick/ban/timeout/edit roles of) `target`.
    pub fn outranks(&self, target: &MemberContext<'_>) -> bool {
        if target.is_owner() || self.user_id == target.user_id {
            return false;
        }
        self.is_owner() || self.top_position() > target.top_position()
    }

    /// Whether this member may edit/assign a role at `position`.
    pub fn can_manage_role(&self, position: i32) -> bool {
        self.is_owner() || (self.base() & MANAGE_ROLES != 0 && self.top_position() > position)
    }
}

/// Applies implicit permission rules for a channel type.
fn finalize(mut perms: u64, channel_type: i16) -> u64 {
    if perms & VIEW_CHANNEL == 0 {
        return 0;
    }
    match channel_type {
        channel_type::GUILD_TEXT => {
            perms &= !VOICE_ONLY;
            if perms & SEND_MESSAGES == 0 {
                perms &= !(SEND_TTS_MESSAGES | MENTION_EVERYONE | ATTACH_FILES | EMBED_LINKS);
            }
        }
        channel_type::GUILD_VOICE if perms & CONNECT == 0 => {
            perms &= !(VOICE_ONLY & !CONNECT);
        }
        _ => {}
    }
    perms
}

pub fn has(perms: u64, required: u64) -> bool {
    perms & ADMINISTRATOR != 0 || perms & required == required
}

#[cfg(test)]
mod tests {
    use super::channel_type::*;
    use super::*;

    const G: i64 = 100; // guild id == @everyone role id
    const OWNER: i64 = 1;
    const USER: i64 = 2;
    const MOD_ROLE: i64 = 10;
    const MUTED_ROLE: i64 = 11;
    const ADMIN_ROLE: i64 = 12;

    fn roles() -> Vec<RoleInfo> {
        vec![
            RoleInfo {
                id: G,
                permissions: DEFAULT_EVERYONE,
                position: 0,
            },
            RoleInfo {
                id: MOD_ROLE,
                permissions: KICK_MEMBERS | MANAGE_MESSAGES | MANAGE_ROLES,
                position: 5,
            },
            RoleInfo {
                id: MUTED_ROLE,
                permissions: 0,
                position: 1,
            },
            RoleInfo {
                id: ADMIN_ROLE,
                permissions: ADMINISTRATOR,
                position: 8,
            },
        ]
    }

    fn ctx<'a>(user: i64, roles: &'a [RoleInfo], member_roles: &'a [i64]) -> MemberContext<'a> {
        MemberContext {
            guild_id: G,
            owner_id: OWNER,
            user_id: user,
            roles,
            member_roles,
            timed_out: false,
        }
    }

    #[test]
    fn owner_has_everything() {
        let r = roles();
        let c = ctx(OWNER, &r, &[]);
        assert_eq!(c.base(), ALL);
        let deny_all = [Overwrite {
            target_id: G,
            kind: OVERWRITE_ROLE,
            allow: 0,
            deny: ALL,
        }];
        assert_eq!(c.channel(&deny_all, GUILD_TEXT), ALL);
    }

    #[test]
    fn everyone_defaults_apply() {
        let r = roles();
        let c = ctx(USER, &r, &[]);
        assert_eq!(c.base(), DEFAULT_EVERYONE);
        assert!(has(c.base(), VIEW_CHANNEL | SEND_MESSAGES));
        assert!(!has(c.base(), MANAGE_CHANNELS));
        assert!(!has(c.base(), KICK_MEMBERS));
    }

    #[test]
    fn roles_are_ored() {
        let r = roles();
        let c = ctx(USER, &r, &[MOD_ROLE]);
        assert!(has(
            c.base(),
            KICK_MEMBERS | MANAGE_MESSAGES | SEND_MESSAGES
        ));
        assert!(!has(c.base(), BAN_MEMBERS));
    }

    #[test]
    fn administrator_grants_all_and_bypasses_overwrites() {
        let r = roles();
        let c = ctx(USER, &r, &[ADMIN_ROLE]);
        assert_eq!(c.base(), ALL);
        let ow = [Overwrite {
            target_id: USER,
            kind: OVERWRITE_MEMBER,
            allow: 0,
            deny: VIEW_CHANNEL,
        }];
        assert_eq!(c.channel(&ow, GUILD_TEXT), ALL);
    }

    #[test]
    fn everyone_overwrite_can_hide_channel() {
        let r = roles();
        let c = ctx(USER, &r, &[]);
        let ow = [Overwrite {
            target_id: G,
            kind: OVERWRITE_ROLE,
            allow: 0,
            deny: VIEW_CHANNEL,
        }];
        assert_eq!(c.channel(&ow, GUILD_TEXT), 0);
    }

    #[test]
    fn role_allow_beats_everyone_deny() {
        let r = roles();
        let c = ctx(USER, &r, &[MOD_ROLE]);
        let ow = [
            Overwrite {
                target_id: G,
                kind: OVERWRITE_ROLE,
                allow: 0,
                deny: VIEW_CHANNEL,
            },
            Overwrite {
                target_id: MOD_ROLE,
                kind: OVERWRITE_ROLE,
                allow: VIEW_CHANNEL,
                deny: 0,
            },
        ];
        assert!(has(c.channel(&ow, GUILD_TEXT), VIEW_CHANNEL));
    }

    #[test]
    fn role_allow_wins_over_role_deny_at_same_level() {
        let r = roles();
        let c = ctx(USER, &r, &[MOD_ROLE, MUTED_ROLE]);
        let ow = [
            Overwrite {
                target_id: MUTED_ROLE,
                kind: OVERWRITE_ROLE,
                allow: 0,
                deny: SEND_MESSAGES,
            },
            Overwrite {
                target_id: MOD_ROLE,
                kind: OVERWRITE_ROLE,
                allow: SEND_MESSAGES,
                deny: 0,
            },
        ];
        assert!(has(c.channel(&ow, GUILD_TEXT), SEND_MESSAGES));
    }

    #[test]
    fn member_overwrite_has_highest_precedence() {
        let r = roles();
        let c = ctx(USER, &r, &[MOD_ROLE]);
        let ow = [
            Overwrite {
                target_id: MOD_ROLE,
                kind: OVERWRITE_ROLE,
                allow: SEND_MESSAGES,
                deny: 0,
            },
            Overwrite {
                target_id: USER,
                kind: OVERWRITE_MEMBER,
                allow: 0,
                deny: SEND_MESSAGES,
            },
        ];
        let p = c.channel(&ow, GUILD_TEXT);
        assert!(has(p, VIEW_CHANNEL));
        assert!(!has(p, SEND_MESSAGES));
    }

    #[test]
    fn overwrites_for_other_roles_or_members_are_ignored() {
        let r = roles();
        let c = ctx(USER, &r, &[]);
        let ow = [
            Overwrite {
                target_id: MOD_ROLE,
                kind: OVERWRITE_ROLE,
                allow: 0,
                deny: VIEW_CHANNEL,
            },
            Overwrite {
                target_id: 999,
                kind: OVERWRITE_MEMBER,
                allow: 0,
                deny: VIEW_CHANNEL,
            },
        ];
        assert!(has(c.channel(&ow, GUILD_TEXT), VIEW_CHANNEL));
    }

    #[test]
    fn no_send_removes_dependent_text_permissions() {
        let r = vec![RoleInfo {
            id: G,
            permissions: DEFAULT_EVERYONE | MENTION_EVERYONE,
            position: 0,
        }];
        let c = ctx(USER, &r, &[]);
        let ow = [Overwrite {
            target_id: G,
            kind: OVERWRITE_ROLE,
            allow: 0,
            deny: SEND_MESSAGES,
        }];
        let p = c.channel(&ow, GUILD_TEXT);
        assert!(has(p, VIEW_CHANNEL | READ_MESSAGE_HISTORY));
        assert_eq!(
            p & (SEND_MESSAGES | MENTION_EVERYONE | ATTACH_FILES | EMBED_LINKS),
            0
        );
    }

    #[test]
    fn text_channels_drop_voice_permissions_and_vice_versa() {
        let r = roles();
        let c = ctx(USER, &r, &[]);
        assert_eq!(c.channel(&[], GUILD_TEXT) & CONNECT, 0);
        let ow = [Overwrite {
            target_id: G,
            kind: OVERWRITE_ROLE,
            allow: 0,
            deny: CONNECT,
        }];
        let p = c.channel(&ow, GUILD_VOICE);
        assert!(has(p, VIEW_CHANNEL));
        assert_eq!(p & (CONNECT | SPEAK | STREAM | USE_VAD), 0);
    }

    #[test]
    fn timeout_limits_to_read_only() {
        let r = roles();
        let mut c = ctx(USER, &r, &[MOD_ROLE]);
        c.timed_out = true;
        assert_eq!(c.base(), VIEW_CHANNEL | READ_MESSAGE_HISTORY);
        let ow = [Overwrite {
            target_id: USER,
            kind: OVERWRITE_MEMBER,
            allow: SEND_MESSAGES,
            deny: 0,
        }];
        assert!(!has(c.channel(&ow, GUILD_TEXT), SEND_MESSAGES));
        // Administrators are not affected by timeouts.
        let mut a = ctx(USER, &r, &[ADMIN_ROLE]);
        a.timed_out = true;
        assert_eq!(a.base(), ALL);
    }

    #[test]
    fn hierarchy() {
        let r = roles();
        let owner = ctx(OWNER, &r, &[]);
        let admin = ctx(3, &r, &[ADMIN_ROLE]);
        let moder = ctx(4, &r, &[MOD_ROLE]);
        let plain = ctx(USER, &r, &[]);
        assert!(owner.outranks(&admin));
        assert!(admin.outranks(&moder));
        assert!(moder.outranks(&plain));
        assert!(!moder.outranks(&admin));
        assert!(!admin.outranks(&owner));
        assert!(!plain.outranks(&plain.clone()));
        let other_plain = ctx(5, &r, &[]);
        assert!(!plain.outranks(&other_plain), "equal rank must not outrank");
    }

    #[test]
    fn role_management_requires_higher_position() {
        let r = roles();
        let moder = ctx(4, &r, &[MOD_ROLE]);
        assert!(moder.can_manage_role(1));
        assert!(!moder.can_manage_role(5), "cannot manage own top role");
        assert!(!moder.can_manage_role(8));
        let plain = ctx(USER, &r, &[]);
        assert!(!plain.can_manage_role(0), "requires MANAGE_ROLES");
        assert!(ctx(OWNER, &r, &[]).can_manage_role(100));
    }
}
