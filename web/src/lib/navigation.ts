import { ChannelType } from '../api/types';
import { useUi } from '../stores/ui';
import { useData } from '../stores/data';
import { orderedChannels } from './hooks';

export function firstTextChannel(guildId: string): string | undefined {
  return orderedChannels(guildId).find((c) => c.type === ChannelType.GuildText)?.id;
}

/** Last visited (or first) text channel of a guild. */
export function defaultChannel(guildId: string): string | undefined {
  const last = useUi.getState().lastChannel[guildId];
  if (last && useData.getState().channels[guildId]?.[last]) return last;
  return firstTextChannel(guildId);
}

export function guildPath(guildId: string): string {
  const c = defaultChannel(guildId);
  return c ? `/channels/${guildId}/${c}` : `/channels/${guildId}`;
}
