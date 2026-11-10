import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { http } from '../api/client';
import { ChannelType, type Channel, type Member } from '../api/types';
import { useData } from '../stores/data';
import { queryClient } from './queryClient';
import { basePermissions, channelPermissions, has, type PermContext } from './permissions';

export interface CategoryGroup {
  category: Channel | null;
  channels: Channel[];
}

const byPosition = (a: Channel, b: Channel) => a.position - b.position || (BigInt(a.id) < BigInt(b.id) ? -1 : 1);
/** Text-like channels are listed above voice channels inside a category. */
const byTypeThenPosition = (a: Channel, b: Channel) =>
  Number(a.type === ChannelType.GuildVoice) - Number(b.type === ChannelType.GuildVoice) || byPosition(a, b);

/** Sorted category tree as shown in the sidebar. */
export function buildChannelTree(channels: Record<string, Channel> | undefined): CategoryGroup[] {
  if (!channels) return [];
  const all = Object.values(channels);
  const categories = all.filter((c) => c.type === ChannelType.GuildCategory).sort(byPosition);
  const children = new Map<string | null, Channel[]>();
  for (const c of all) {
    if (c.type === ChannelType.GuildCategory) continue;
    const parent = c.parent_id && channels[c.parent_id] ? c.parent_id : null;
    const list = children.get(parent) ?? [];
    list.push(c);
    children.set(parent, list);
  }
  const groups: CategoryGroup[] = [{ category: null, channels: (children.get(null) ?? []).sort(byTypeThenPosition) }];
  for (const cat of categories) groups.push({ category: cat, channels: (children.get(cat.id) ?? []).sort(byTypeThenPosition) });
  return groups;
}

export function useChannelTree(guildId: string | undefined): CategoryGroup[] {
  const channels = useData((s) => (guildId ? s.channels[guildId] : undefined));
  return useMemo(() => buildChannelTree(channels), [channels]);
}

/** Channels in sidebar order (for Alt+↑/↓ and the quick switcher). */
export function orderedChannels(guildId: string): Channel[] {
  return buildChannelTree(useData.getState().channels[guildId]).flatMap((g) => g.channels);
}

export function useChannel(channelId: string | undefined): Channel | undefined {
  return useData((s) => {
    if (!channelId) return undefined;
    const g = s.channelGuild[channelId];
    return g ? s.channels[g]?.[channelId] : undefined;
  });
}

function usePermContext(guildId: string | undefined): PermContext | null {
  const guild = useData((s) => (guildId ? s.guilds[guildId] : undefined));
  const roles = useData((s) => (guildId ? s.roles[guildId] : undefined));
  const userId = useData((s) => s.me?.id);
  return useMemo(() => (guild && roles && userId ? { guild, roles, userId } : null), [guild, roles, userId]);
}

export function useGuildPermissions(guildId: string | undefined): bigint {
  const ctx = usePermContext(guildId);
  return useMemo(() => (ctx ? basePermissions(ctx) : 0n), [ctx]);
}

export function useChannelPermissions(channel: Channel | undefined): bigint {
  const ctx = usePermContext(channel?.guild_id ?? undefined);
  return useMemo(() => (ctx && channel ? channelPermissions(ctx, channel) : 0n), [ctx, channel]);
}

export function useCan(guildId: string | undefined, perm: bigint): boolean {
  return has(useGuildPermissions(guildId), perm);
}

const membersQuery = (guildId: string | undefined) => ({
  queryKey: ['members', guildId],
  queryFn: () => http.get<Member[]>(`/guilds/${guildId}/members?limit=1000`),
});

export function useMembers(guildId: string | undefined) {
  return useQuery({ ...membersQuery(guildId), enabled: !!guildId });
}

/** Warms the member list when hovering a server so switching feels instant. */
export function prefetchMembers(guildId: string) {
  return queryClient.prefetchQuery(membersQuery(guildId));
}
