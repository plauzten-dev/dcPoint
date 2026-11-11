import { useMemo } from 'react';
import type { NavigateFunction } from 'react-router';
import { http } from '../../api/client';
import type { Member, Message, Role } from '../../api/types';
import { reportError } from '../../lib/actions';
import { colorToHex, displayName } from '../../lib/cdn';
import { copyText } from '../../lib/format';
import { useMembers } from '../../lib/hooks';
import type { MarkdownContext } from '../../lib/markdown';
import { rememberEmoji } from '../../lib/emoji';
import { useChatUi } from '../../stores/chatUi';
import { useData } from '../../stores/data';
import { useMessages } from '../../stores/messages';
import { openModal } from '../../stores/overlay';

export interface AuthorInfo {
  name: string;
  color?: string;
  member?: Member;
}

/** Fast lookups for names and role colors in a guild. */
export function useMemberInfo(guildId: string | null) {
  const { data: members } = useMembers(guildId ?? undefined);
  const roles = useData((s) => (guildId ? s.roles[guildId] : undefined));
  const users = useData((s) => s.users);
  return useMemo(() => {
    const byId = new Map<string, Member>((members ?? []).map((m) => [m.user.id, m]));
    const colorOf = (m: Member | undefined): string | undefined => {
      if (!m || !roles) return undefined;
      let best: Role | undefined;
      for (const id of m.roles) {
        const r = roles[id];
        if (r && r.color && (!best || r.position > best.position)) best = r;
      }
      return best ? colorToHex(best.color) : undefined;
    };
    const info = (userId: string, fallback?: { username: string; display_name: string | null } | null): AuthorInfo => {
      const member = byId.get(userId);
      const user = member?.user ?? users[userId] ?? fallback;
      return { name: user ? displayName(user, member?.nick) : 'Unbekannt', color: colorOf(member), member };
    };
    return { info, members: byId, roles: roles ?? {} };
  }, [members, roles, users]);
}

export function useMarkdownContext(guildId: string | null, navigate: NavigateFunction, info: ReturnType<typeof useMemberInfo>): MarkdownContext {
  const channels = useData((s) => (guildId ? s.channels[guildId] : undefined));
  return useMemo(
    () => ({
      user: (id) => (info.members.has(id) || useData.getState().users[id] ? info.info(id).name : null),
      role: (id) => {
        const r = info.roles[id];
        return r ? { name: r.name, color: r.color ? colorToHex(r.color) : null } : null;
      },
      channel: (id) => channels?.[id]?.name ?? null,
      onChannelClick: (id) => channels?.[id] && navigate(`/channels/${guildId}/${id}`),
    }),
    [info, channels, guildId, navigate],
  );
}

// ---------------------------------------------------------------------------
// Actions (stable module functions, no React context needed)
// ---------------------------------------------------------------------------

export async function toggleReaction(target: Message, emoji: string) {
  const m = useMessages.getState().channels[target.channel_id]?.messages.find((x) => x.id === target.id) ?? target;
  const existing = m.reactions?.find((r) => r.emoji === emoji);
  const remove = !!existing?.me;
  rememberEmoji(emoji);
  // Optimistic update; the gateway echo is ignored when it matches.
  useMessages.getState().patch(m.channel_id, m.id, (cur) => {
    const list = [...(cur.reactions ?? [])];
    const i = list.findIndex((r) => r.emoji === emoji);
    if (remove && i >= 0) {
      const count = list[i].count - 1;
      if (count <= 0) list.splice(i, 1);
      else list[i] = { ...list[i], count, me: false };
    } else if (!remove) {
      if (i >= 0) list[i] = { ...list[i], count: list[i].count + 1, me: true };
      else list.push({ emoji, count: 1, me: true });
    }
    return { ...cur, reactions: list };
  });
  const path = `/channels/${m.channel_id}/messages/${m.id}/reactions/${encodeURIComponent(emoji)}/@me`;
  try {
    if (remove) await http.delete(path);
    else await http.put(path, {});
  } catch (e) {
    reportError(e);
  }
}

export function deleteMessage(m: Message, skipConfirm = false) {
  const run = () => http.delete(`/channels/${m.channel_id}/messages/${m.id}`).then(() => useMessages.getState().remove(m.channel_id, m.id));
  if (skipConfirm) {
    void run().catch(reportError);
    return;
  }
  openModal({
    type: 'confirm',
    title: 'Nachricht löschen',
    body: (
      <>
        Bist du sicher, dass du diese Nachricht löschen möchtest?
        <span className="mt-3 block rounded border border-divider bg-sidebar p-3 text-sm text-text">{m.content || '📎 Anhang'}</span>
        <span className="mt-3 block text-xs text-muted">Tipp: Halte Umschalt beim Klick auf Löschen, um diese Abfrage zu überspringen.</span>
      </>
    ),
    confirm: 'Löschen',
    danger: true,
    onConfirm: run,
  });
}

export async function togglePin(m: Message) {
  try {
    if (m.pinned) await http.delete(`/channels/${m.channel_id}/pins/${m.id}`);
    else await http.put(`/channels/${m.channel_id}/pins/${m.id}`, {});
  } catch (e) {
    reportError(e);
  }
}

export function replyTo(m: Message) {
  useChatUi.getState().setReply(m);
  requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('[data-composer]')?.focus());
}

export function startEdit(m: Message) {
  useChatUi.getState().setEditing(m.id);
}

export function copyMessageLink(m: Message) {
  void copyText(`${location.origin}/channels/${m.guild_id ?? '@me'}/${m.channel_id}/${m.id}`);
}
