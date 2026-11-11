// Mirror of server/src/permissions.rs — keep both in sync.
import { ChannelType, type Channel, type Guild, type Role } from '../api/types';

const b = (n: number) => 1n << BigInt(n);

export const P = {
  CREATE_INSTANT_INVITE: b(0),
  KICK_MEMBERS: b(1),
  BAN_MEMBERS: b(2),
  ADMINISTRATOR: b(3),
  MANAGE_CHANNELS: b(4),
  MANAGE_GUILD: b(5),
  ADD_REACTIONS: b(6),
  VIEW_AUDIT_LOG: b(7),
  PRIORITY_SPEAKER: b(8),
  STREAM: b(9),
  VIEW_CHANNEL: b(10),
  SEND_MESSAGES: b(11),
  SEND_TTS_MESSAGES: b(12),
  MANAGE_MESSAGES: b(13),
  EMBED_LINKS: b(14),
  ATTACH_FILES: b(15),
  READ_MESSAGE_HISTORY: b(16),
  MENTION_EVERYONE: b(17),
  USE_EXTERNAL_EMOJIS: b(18),
  CONNECT: b(20),
  SPEAK: b(21),
  MUTE_MEMBERS: b(22),
  DEAFEN_MEMBERS: b(23),
  MOVE_MEMBERS: b(24),
  USE_VAD: b(25),
  CHANGE_NICKNAME: b(26),
  MANAGE_NICKNAMES: b(27),
  MANAGE_ROLES: b(28),
  MANAGE_WEBHOOKS: b(29),
  MANAGE_EMOJIS: b(30),
  MANAGE_THREADS: b(34),
  CREATE_PUBLIC_THREADS: b(35),
  CREATE_PRIVATE_THREADS: b(36),
  SEND_MESSAGES_IN_THREADS: b(38),
  MODERATE_MEMBERS: b(40),
} as const;

export const ALL = Object.values(P).reduce((a, v) => a | v, 0n);
const VOICE_ONLY =
  P.CONNECT | P.SPEAK | P.STREAM | P.MUTE_MEMBERS | P.DEAFEN_MEMBERS | P.MOVE_MEMBERS | P.USE_VAD | P.PRIORITY_SPEAKER;

export interface PermContext {
  guild: Pick<Guild, 'id' | 'owner_id' | 'my_roles' | 'my_communication_disabled_until'>;
  roles: Record<string, Role>;
  userId: string;
}

function timedOut(ctx: PermContext) {
  const until = ctx.guild.my_communication_disabled_until;
  return !!until && new Date(until).getTime() > Date.now();
}

export function basePermissions(ctx: PermContext): bigint {
  if (ctx.guild.owner_id === ctx.userId) return ALL;
  let perms = BigInt(ctx.roles[ctx.guild.id]?.permissions ?? '0');
  for (const id of ctx.guild.my_roles) {
    const r = ctx.roles[id];
    if (r) perms |= BigInt(r.permissions);
  }
  if (perms & P.ADMINISTRATOR) return ALL;
  if (timedOut(ctx)) perms &= P.VIEW_CHANNEL | P.READ_MESSAGE_HISTORY;
  return perms;
}

export function channelPermissions(ctx: PermContext, channel: Channel): bigint {
  const base = basePermissions(ctx);
  if (base & P.ADMINISTRATOR) return ALL;
  let perms = base;
  const ows = channel.permission_overwrites;
  const everyone = ows.find((o) => o.type === 0 && o.id === ctx.guild.id);
  if (everyone) perms = (perms & ~BigInt(everyone.deny)) | BigInt(everyone.allow);
  let allow = 0n;
  let deny = 0n;
  for (const o of ows) {
    if (o.type === 0 && ctx.guild.my_roles.includes(o.id)) {
      allow |= BigInt(o.allow);
      deny |= BigInt(o.deny);
    }
  }
  perms = (perms & ~deny) | allow;
  const member = ows.find((o) => o.type === 1 && o.id === ctx.userId);
  if (member) perms = (perms & ~BigInt(member.deny)) | BigInt(member.allow);
  if (timedOut(ctx)) perms &= P.VIEW_CHANNEL | P.READ_MESSAGE_HISTORY;
  if (!(perms & P.VIEW_CHANNEL)) return 0n;
  if (channel.type === ChannelType.GuildText || channel.type === ChannelType.PublicThread) {
    perms &= ~VOICE_ONLY;
    if (channel.type === ChannelType.PublicThread) {
      perms = perms & P.SEND_MESSAGES_IN_THREADS ? perms | P.SEND_MESSAGES : perms & ~P.SEND_MESSAGES;
    }
    if (!(perms & P.SEND_MESSAGES)) perms &= ~(P.SEND_TTS_MESSAGES | P.MENTION_EVERYONE | P.ATTACH_FILES | P.EMBED_LINKS);
  } else if (channel.type === ChannelType.GuildVoice && !(perms & P.CONNECT)) {
    perms &= ~(VOICE_ONLY & ~P.CONNECT);
  }
  return perms;
}

export function has(perms: bigint, required: bigint): boolean {
  return (perms & P.ADMINISTRATOR) !== 0n || (perms & required) === required;
}
