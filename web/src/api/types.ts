export type Snowflake = string;

export type Status = 'online' | 'idle' | 'dnd' | 'invisible' | 'offline';

export interface CustomStatus {
  text: string | null;
  emoji: string | null;
  expires_at: string | null;
}

export interface User {
  id: Snowflake;
  username: string;
  display_name: string | null;
  avatar: string | null;
  banner: string | null;
  bio: string;
  pronouns: string;
  accent_color: number | null;
  created_at: string;
}

export interface PrivateUser extends User {
  email: string;
  mfa_enabled: boolean;
  status: Exclude<Status, 'offline'>;
  custom_status: CustomStatus | null;
}

export interface Role {
  id: Snowflake;
  guild_id: Snowflake;
  name: string;
  color: number;
  hoist: boolean;
  mentionable: boolean;
  position: number;
  permissions: string;
}

export const ChannelType = {
  GuildText: 0,
  DM: 1,
  GuildVoice: 2,
  GroupDM: 3,
  GuildCategory: 4,
} as const;
export type ChannelTypeValue = (typeof ChannelType)[keyof typeof ChannelType];

export interface PermissionOverwrite {
  id: Snowflake;
  type: 0 | 1;
  allow: string;
  deny: string;
}

export interface Channel {
  id: Snowflake;
  guild_id: Snowflake | null;
  type: ChannelTypeValue;
  name: string;
  topic: string | null;
  position: number;
  parent_id: Snowflake | null;
  nsfw: boolean;
  bitrate: number | null;
  user_limit: number | null;
  rate_limit_per_user: number;
  last_message_id: Snowflake | null;
  permission_overwrites: PermissionOverwrite[];
}

export interface GuildBase {
  id: Snowflake;
  name: string;
  icon: string | null;
  description: string | null;
  owner_id: Snowflake;
  created_at: string;
}

export interface GuildPayload extends GuildBase {
  roles: Role[];
  channels: Channel[];
  member_count: number;
  joined_at: string;
  my_roles: Snowflake[];
  my_communication_disabled_until: string | null;
}

export interface Guild extends GuildBase {
  member_count: number;
  joined_at: string;
  my_roles: Snowflake[];
  my_communication_disabled_until: string | null;
}

export interface Member {
  guild_id: Snowflake;
  user: User;
  nick: string | null;
  roles: Snowflake[];
  joined_at: string;
  communication_disabled_until: string | null;
}

export interface Presence {
  user_id: Snowflake;
  status: Status;
  custom_status: CustomStatus | null;
}

export interface Invite {
  code: string;
  guild: { id: Snowflake; name: string; icon: string | null; description: string | null };
  channel: { id: Snowflake; name: string; type: ChannelTypeValue };
  inviter: User | null;
  uses: number;
  max_uses: number;
  max_age: number;
  created_at: string;
  expires_at: string | null;
  approximate_member_count: number;
  approximate_presence_count: number;
}

export interface ReadyPayload {
  v: number;
  session_id: string;
  user: PrivateUser;
  guilds: GuildPayload[];
  presences: Presence[];
}

export type AuthResponse = { token: string; user: PrivateUser } | { mfa: true; ticket: string };
