import { create } from 'zustand';
import { isNewer } from '../lib/snowflake';
import type { Channel, Guild, GuildBase, GuildPayload, Presence, PrivateUser, ReadyPayload, Role, User } from '../api/types';

export type ConnectionState = 'connecting' | 'ready' | 'reconnecting';

interface DataState {
  connection: ConnectionState;
  me: PrivateUser | null;
  guildOrder: string[];
  guilds: Record<string, Guild>;
  roles: Record<string, Record<string, Role>>;
  /** Channels grouped by guild id. */
  channels: Record<string, Record<string, Channel>>;
  channelGuild: Record<string, string>;
  presences: Record<string, Presence>;
  users: Record<string, User>;
  /** Per channel: last read message id and unread mention count. */
  readStates: Record<string, { last: string; mentions: number }>;

  setConnection(c: ConnectionState): void;
  ready(p: ReadyPayload): void;
  upsertGuild(p: GuildPayload): void;
  updateGuild(g: GuildBase): void;
  removeGuild(id: string): void;
  upsertChannel(c: Channel): void;
  removeChannel(c: Pick<Channel, 'id' | 'guild_id'>): void;
  setPresence(p: Presence): void;
  upsertUser(u: User): void;
  setMe(u: PrivateUser): void;
  /** Records a new message in a channel (unread tracking). */
  bumpLastMessage(channelId: string, messageId: string): void;
  markRead(channelId: string, messageId: string): void;
  addMention(channelId: string): void;
  reset(): void;
}

function splitGuild(p: GuildPayload) {
  const { roles, channels, ...guild } = p;
  return {
    guild: guild as Guild,
    roles: Object.fromEntries(roles.map((r) => [r.id, r])),
    channels: Object.fromEntries(channels.map((c) => [c.id, c])),
  };
}

/** The server never sends our own presence; derive it from our settings. */
function withSelfPresence(presences: Record<string, Presence>, me: PrivateUser): Record<string, Presence> {
  const next = { ...presences };
  if (me.status === 'invisible') delete next[me.id];
  else next[me.id] = { user_id: me.id, status: me.status, custom_status: me.custom_status };
  return next;
}

const initial = {
  connection: 'connecting' as ConnectionState,
  me: null,
  guildOrder: [],
  guilds: {},
  roles: {},
  channels: {},
  channelGuild: {},
  presences: {},
  users: {},
  readStates: {},
};

export const useData = create<DataState>()((set) => ({
  ...initial,

  setConnection: (connection) => set({ connection }),

  ready: (p) =>
    set(() => {
      const guilds: DataState['guilds'] = {};
      const roles: DataState['roles'] = {};
      const channels: DataState['channels'] = {};
      const channelGuild: DataState['channelGuild'] = {};
      for (const g of p.guilds) {
        const s = splitGuild(g);
        guilds[g.id] = s.guild;
        roles[g.id] = s.roles;
        channels[g.id] = s.channels;
        for (const c of g.channels) channelGuild[c.id] = g.id;
      }
      const stored = loadGuildOrder();
      const order = [...stored.filter((id) => guilds[id]), ...p.guilds.map((g) => g.id).filter((id) => !stored.includes(id))];
      return {
        connection: 'ready',
        me: p.user,
        guildOrder: order,
        guilds,
        roles,
        channels,
        channelGuild,
        presences: withSelfPresence(Object.fromEntries(p.presences.map((x) => [x.user_id, x])), p.user),
        users: { ...useData.getState().users, [p.user.id]: p.user },
        readStates: Object.fromEntries(p.read_states.map((r) => [r.id, { last: r.last_message_id, mentions: r.mention_count }])),
      };
    }),

  upsertGuild: (p) =>
    set((s) => {
      const split = splitGuild(p);
      const channelGuild = { ...s.channelGuild };
      for (const c of p.channels) channelGuild[c.id] = p.id;
      const guildOrder = s.guildOrder.includes(p.id) ? s.guildOrder : [...s.guildOrder, p.id];
      saveGuildOrder(guildOrder);
      return {
        guilds: { ...s.guilds, [p.id]: split.guild },
        roles: { ...s.roles, [p.id]: split.roles },
        channels: { ...s.channels, [p.id]: split.channels },
        channelGuild,
        guildOrder,
      };
    }),

  updateGuild: (g) =>
    set((s) => (s.guilds[g.id] ? { guilds: { ...s.guilds, [g.id]: { ...s.guilds[g.id], ...g } } } : {})),

  removeGuild: (id) =>
    set((s) => {
      const { [id]: _g, ...guilds } = s.guilds;
      const { [id]: _r, ...roles } = s.roles;
      const { [id]: removed, ...channels } = s.channels;
      const channelGuild = { ...s.channelGuild };
      for (const cid of Object.keys(removed ?? {})) delete channelGuild[cid];
      const guildOrder = s.guildOrder.filter((g) => g !== id);
      saveGuildOrder(guildOrder);
      return { guilds, roles, channels, channelGuild, guildOrder };
    }),

  upsertChannel: (c) =>
    set((s) => {
      if (!c.guild_id || !s.guilds[c.guild_id]) return {};
      return {
        channels: { ...s.channels, [c.guild_id]: { ...s.channels[c.guild_id], [c.id]: c } },
        channelGuild: { ...s.channelGuild, [c.id]: c.guild_id },
      };
    }),

  removeChannel: (c) =>
    set((s) => {
      if (!c.guild_id || !s.channels[c.guild_id]?.[c.id]) return {};
      const { [c.id]: _c, ...rest } = s.channels[c.guild_id];
      const { [c.id]: _x, ...channelGuild } = s.channelGuild;
      return { channels: { ...s.channels, [c.guild_id]: rest }, channelGuild };
    }),

  setPresence: (p) =>
    set((s) => {
      if (p.status === 'offline') {
        if (!s.presences[p.user_id]) return {};
        const { [p.user_id]: _p, ...presences } = s.presences;
        return { presences };
      }
      return { presences: { ...s.presences, [p.user_id]: p } };
    }),

  upsertUser: (u) => set((s) => ({ users: { ...s.users, [u.id]: { ...s.users[u.id], ...u } } })),

  setMe: (u) => set((s) => ({ me: u, users: { ...s.users, [u.id]: u }, presences: withSelfPresence(s.presences, u) })),

  bumpLastMessage: (channelId, messageId) =>
    set((s) => {
      const guildId = s.channelGuild[channelId];
      const c = guildId ? s.channels[guildId]?.[channelId] : undefined;
      if (!c || !isNewer(messageId, c.last_message_id)) return {};
      return { channels: { ...s.channels, [guildId]: { ...s.channels[guildId], [channelId]: { ...c, last_message_id: messageId } } } };
    }),

  markRead: (channelId, messageId) =>
    set((s) => {
      const cur = s.readStates[channelId];
      if (cur && cur.mentions === 0 && !isNewer(messageId, cur.last)) return {};
      const last = cur && isNewer(cur.last, messageId) ? cur.last : messageId;
      return { readStates: { ...s.readStates, [channelId]: { last, mentions: 0 } } };
    }),

  addMention: (channelId) =>
    set((s) => {
      const cur = s.readStates[channelId] ?? { last: '0', mentions: 0 };
      return { readStates: { ...s.readStates, [channelId]: { ...cur, mentions: cur.mentions + 1 } } };
    }),

  reset: () => set({ ...initial }),
}));

const ORDER_KEY = 'dcpoint-guild-order';

function loadGuildOrder(): string[] {
  try {
    return JSON.parse(localStorage.getItem(ORDER_KEY) ?? '[]');
  } catch {
    return [];
  }
}

export function saveGuildOrder(order: string[]) {
  try {
    localStorage.setItem(ORDER_KEY, JSON.stringify(order));
  } catch {
    /* storage unavailable */
  }
}

export function moveGuild(id: string, toIndex: number) {
  useData.setState((s) => {
    const order = s.guildOrder.filter((g) => g !== id);
    order.splice(Math.max(0, Math.min(toIndex, order.length)), 0, id);
    saveGuildOrder(order);
    return { guildOrder: order };
  });
}
