import { http } from '../api/client';
import type { Message } from '../api/types';
import { useData } from '../stores/data';
import { isNewer } from './snowflake';

/** Channel currently on screen and whether it is scrolled to the newest message. */
export const viewing = { channelId: null as string | null, atBottom: true };

const pending = new Map<string, ReturnType<typeof setTimeout>>();

/** Marks a channel as read up to `messageId` (default: newest). Server ack is debounced. */
export function ackChannel(channelId: string, messageId?: string) {
  const s = useData.getState();
  const guildId = s.channelGuild[channelId];
  const id = messageId ?? (guildId ? s.channels[guildId]?.[channelId]?.last_message_id : null);
  if (!id) return;
  const rs = s.readStates[channelId];
  if (rs && rs.mentions === 0 && !isNewer(id, rs.last)) return;
  s.markRead(channelId, id);
  clearTimeout(pending.get(channelId));
  pending.set(
    channelId,
    setTimeout(() => {
      pending.delete(channelId);
      void http.post(`/channels/${channelId}/messages/${id}/ack`).catch(() => {});
    }, 400),
  );
}

export function isUnread(channelId: string): boolean {
  const s = useData.getState();
  const guildId = s.channelGuild[channelId];
  const last = guildId ? s.channels[guildId]?.[channelId]?.last_message_id : null;
  return isNewer(last, s.readStates[channelId]?.last ?? '0');
}

/** Whether a message pings the current user (direct, role or @everyone). */
export function mentionsMe(m: Message): boolean {
  const s = useData.getState();
  const me = s.me?.id;
  if (!me || m.author?.id === me) return false;
  if (m.mention_everyone || m.mentions.includes(me)) return true;
  const myRoles = m.guild_id ? s.guilds[m.guild_id]?.my_roles ?? [] : [];
  return m.mention_roles.some((r) => myRoles.includes(r));
}
