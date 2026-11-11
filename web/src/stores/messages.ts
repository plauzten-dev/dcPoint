import { create } from 'zustand';
import { http } from '../api/client';
import type { Message } from '../api/types';
import { cmpId } from '../lib/snowflake';

const PAGE = 50;
/** Channels kept in memory for instant switching. */
const MAX_CACHED_CHANNELS = 30;

export interface ChannelMessages {
  messages: Message[];
  /** Older history exists on the server. */
  hasMoreBefore: boolean;
  /** Newer messages exist (after jumping to an old message). */
  hasMoreAfter: boolean;
  loading: boolean;
  /** Message to scroll to and highlight once rendered. */
  jumpTo?: string;
}

interface MessagesState {
  channels: Record<string, ChannelMessages>;
  /** Recently used channel ids, most recent last. */
  lru: string[];
  load(channelId: string): Promise<void>;
  loadOlder(channelId: string): Promise<void>;
  loadNewer(channelId: string): Promise<void>;
  jump(channelId: string, messageId: string): Promise<void>;
  clearJump(channelId: string): void;
  /** Inserts or replaces a message (matching id or nonce of a pending message). */
  upsert(m: Message): void;
  patch(channelId: string, id: string, fn: (m: Message) => Message): void;
  remove(channelId: string, id: string): void;
  reset(): void;
}

const inflight = new Map<string, Promise<void>>();

function once(key: string, fn: () => Promise<void>): Promise<void> {
  const existing = inflight.get(key);
  if (existing) return existing;
  const p = fn().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

function merge(existing: Message[], incoming: Message[]): Message[] {
  const byId = new Map(existing.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, { ...byId.get(m.id), ...m });
  return [...byId.values()].sort((a, b) => cmpId(a.id, b.id));
}

export const useMessages = create<MessagesState>()((set, get) => {
  const setChannel = (channelId: string, fn: (c: ChannelMessages | undefined) => ChannelMessages) =>
    set((s) => {
      const next = { ...s.channels, [channelId]: fn(s.channels[channelId]) };
      const lru = [...s.lru.filter((id) => id !== channelId), channelId];
      while (lru.length > MAX_CACHED_CHANNELS) delete next[lru.shift()!];
      return { channels: next, lru };
    });

  return {
    channels: {},
    lru: [],

    load: (channelId) =>
      once(`load:${channelId}`, async () => {
        if (get().channels[channelId]) return;
        setChannel(channelId, () => ({ messages: [], hasMoreBefore: true, hasMoreAfter: false, loading: true }));
        try {
          const messages = await http.get<Message[]>(`/channels/${channelId}/messages?limit=${PAGE}`);
          setChannel(channelId, (c) => ({
            messages: merge(c?.messages ?? [], messages),
            hasMoreBefore: messages.length === PAGE,
            hasMoreAfter: false,
            loading: false,
          }));
        } catch (e) {
          set((s) => {
            const { [channelId]: _, ...rest } = s.channels;
            return { channels: rest };
          });
          throw e;
        }
      }),

    loadOlder: (channelId) =>
      once(`older:${channelId}`, async () => {
        const c = get().channels[channelId];
        if (!c || !c.hasMoreBefore || c.loading) return;
        const first = c.messages.find((m) => !m.pending);
        if (!first) return;
        setChannel(channelId, (cur) => ({ ...cur!, loading: true }));
        const older = await http.get<Message[]>(`/channels/${channelId}/messages?limit=${PAGE}&before=${first.id}`);
        setChannel(channelId, (cur) => ({
          ...cur!,
          messages: merge(cur!.messages, older),
          hasMoreBefore: older.length === PAGE,
          loading: false,
        }));
      }),

    loadNewer: (channelId) =>
      once(`newer:${channelId}`, async () => {
        const c = get().channels[channelId];
        if (!c || !c.hasMoreAfter || c.loading) return;
        const last = c.messages[c.messages.length - 1];
        setChannel(channelId, (cur) => ({ ...cur!, loading: true }));
        const newer = await http.get<Message[]>(`/channels/${channelId}/messages?limit=${PAGE}&after=${last.id}`);
        setChannel(channelId, (cur) => ({
          ...cur!,
          messages: merge(cur!.messages, newer),
          hasMoreAfter: newer.length === PAGE,
          loading: false,
        }));
      }),

    jump: async (channelId, messageId) => {
      const c = get().channels[channelId];
      if (c?.messages.some((m) => m.id === messageId)) {
        setChannel(channelId, (cur) => ({ ...cur!, jumpTo: messageId }));
        return;
      }
      const around = await http.get<Message[]>(`/channels/${channelId}/messages?limit=${PAGE}&around=${messageId}`);
      setChannel(channelId, () => ({
        messages: around,
        hasMoreBefore: true,
        hasMoreAfter: true,
        loading: false,
        jumpTo: messageId,
      }));
    },

    clearJump: (channelId) => {
      if (get().channels[channelId]?.jumpTo) setChannel(channelId, (cur) => ({ ...cur!, jumpTo: undefined }));
    },

    upsert: (m) => {
      const c = get().channels[m.channel_id];
      if (!c) return;
      // While viewing old history, new messages are fetched when scrolling down.
      if (c.hasMoreAfter && !c.messages.some((x) => x.id === m.id || (m.nonce && x.nonce === m.nonce))) return;
      setChannel(m.channel_id, (cur) => {
        const list = cur!.messages.filter((x) => !(m.nonce && x.pending && x.nonce === m.nonce));
        const idx = list.findIndex((x) => x.id === m.id);
        if (idx >= 0) {
          const next = list.slice();
          next[idx] = { ...list[idx], ...m, reactions: m.reactions ?? list[idx].reactions };
          return { ...cur!, messages: next };
        }
        return { ...cur!, messages: merge(list, [m]) };
      });
    },

    patch: (channelId, id, fn) => {
      const c = get().channels[channelId];
      const idx = c?.messages.findIndex((m) => m.id === id) ?? -1;
      if (!c || idx < 0) return;
      setChannel(channelId, (cur) => {
        const next = cur!.messages.slice();
        next[idx] = fn(next[idx]);
        return { ...cur!, messages: next };
      });
    },

    remove: (channelId, id) => {
      const c = get().channels[channelId];
      if (!c?.messages.some((m) => m.id === id)) return;
      setChannel(channelId, (cur) => ({ ...cur!, messages: cur!.messages.filter((m) => m.id !== id) }));
    },

    reset: () => set({ channels: {}, lru: [] }),
  };
});

/** Warms the cache (e.g. on channel hover) so switching renders instantly. */
export function prefetchMessages(channelId: string) {
  void useMessages.getState().load(channelId).catch(() => {});
}
