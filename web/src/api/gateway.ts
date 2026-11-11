import { queryClient } from '../lib/queryClient';
import { useData } from '../stores/data';
import { gatewayUrl } from './client';
import { ackChannel, mentionsMe, viewing } from '../lib/readState';
import { useMessages } from '../stores/messages';
import { useTyping } from '../stores/typing';
import type { Channel, CustomEmoji, GuildBase, GuildPayload, Member, Message, Presence, PrivateUser, ReactionCount, ReadyPayload, User } from './types';

const Op = {
  Dispatch: 0,
  Heartbeat: 1,
  Identify: 2,
  Resume: 6,
  Reconnect: 7,
  InvalidSession: 9,
  Hello: 10,
  HeartbeatAck: 11,
} as const;

interface Frame {
  op: number;
  t?: string;
  s?: number | null;
  d?: unknown;
}

type Listener = (event: string, data: unknown) => void;

/**
 * Gateway connection with heartbeating, zombie detection, exponential backoff
 * and session resume (missed events are replayed by the server).
 */
class Gateway {
  private ws: WebSocket | null = null;
  private token: string | null = null;
  private sessionId: string | null = null;
  private seq: number | null = null;
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private awaitingAck = false;
  private attempts = 0;
  private listeners = new Set<Listener>();
  onAuthFailed: (() => void) | null = null;

  constructor() {
    window.addEventListener('online', () => this.ws === null && this.token && this.open());
  }

  get active(): boolean {
    return this.token !== null;
  }

  connect(token: string) {
    this.token = token;
    this.sessionId = null;
    this.seq = null;
    this.open();
  }

  disconnect() {
    this.token = null;
    this.sessionId = null;
    this.seq = null;
    this.teardown();
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private teardown() {
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.heartbeatTimer = this.reconnectTimer = null;
    if (this.ws) {
      this.ws.onclose = this.ws.onmessage = this.ws.onerror = null;
      this.ws.close(1000);
      this.ws = null;
    }
  }

  private open() {
    this.teardown();
    if (!this.token) return;
    const ws = new WebSocket(gatewayUrl());
    this.ws = ws;
    ws.onmessage = (e) => this.onFrame(JSON.parse(e.data as string) as Frame);
    ws.onclose = (e) => this.onClose(e.code);
  }

  private send(payload: Frame) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(payload));
  }

  private startHeartbeat(interval: number) {
    const beat = () => {
      if (this.awaitingAck) {
        // Zombied connection: no ACK since the last beat.
        this.ws?.close(4000);
        return;
      }
      this.awaitingAck = true;
      this.send({ op: Op.Heartbeat, d: this.seq });
      this.heartbeatTimer = setTimeout(beat, interval);
    };
    this.awaitingAck = false;
    this.heartbeatTimer = setTimeout(beat, interval * Math.random());
  }

  private onFrame(f: Frame) {
    if (typeof f.s === 'number') this.seq = f.s;
    switch (f.op) {
      case Op.Hello: {
        this.startHeartbeat((f.d as { heartbeat_interval: number }).heartbeat_interval);
        if (this.sessionId && this.seq !== null) {
          this.send({ op: Op.Resume, d: { token: this.token, session_id: this.sessionId, seq: this.seq } });
        } else {
          this.send({ op: Op.Identify, d: { token: this.token } });
        }
        break;
      }
      case Op.HeartbeatAck:
        this.awaitingAck = false;
        break;
      case Op.InvalidSession:
        this.sessionId = null;
        this.seq = null;
        setTimeout(() => this.send({ op: Op.Identify, d: { token: this.token } }), 500 + Math.random() * 2000);
        break;
      case Op.Reconnect:
        this.ws?.close(4000);
        break;
      case Op.Dispatch:
        if (f.t === 'READY') {
          this.sessionId = (f.d as ReadyPayload).session_id;
          this.seq ??= 0;
        }
        this.attempts = 0;
        if (f.t) {
          handleDispatch(f.t, f.d);
          for (const l of this.listeners) l(f.t, f.d);
        }
        break;
    }
  }

  private onClose(code: number) {
    this.ws = null;
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer);
    if (!this.token) return;
    if (code === 4004) {
      this.onAuthFailed?.();
      return;
    }
    useData.getState().setConnection('reconnecting');
    const delay = Math.min(30_000, 1000 * 2 ** this.attempts) * (0.5 + Math.random() / 2);
    this.attempts++;
    this.reconnectTimer = setTimeout(() => this.open(), delay);
  }
}

export const gateway = new Gateway();

function updateMembers(guildId: string, fn: (members: Member[]) => Member[]) {
  queryClient.setQueryData<Member[]>(['members', guildId], (old) => (old ? fn(old) : old));
}

interface ReactionEvent {
  channel_id: string;
  message_id: string;
  user_id: string;
  emoji: string;
}

function applyReaction(e: ReactionEvent, delta: 1 | -1) {
  const me = useData.getState().me?.id;
  useMessages.getState().patch(e.channel_id, e.message_id, (m) => {
    const list: ReactionCount[] = [...(m.reactions ?? [])];
    const i = list.findIndex((r) => r.emoji === e.emoji);
    const mine = e.user_id === me;
    if (i < 0) {
      if (delta < 0) return m;
      list.push({ emoji: e.emoji, count: 1, me: mine });
    } else {
      const r = list[i];
      // Ignore echoes of our own optimistic updates.
      if (mine && r.me === (delta > 0)) return m;
      const count = r.count + delta;
      if (count <= 0) list.splice(i, 1);
      else list[i] = { ...r, count, me: mine ? delta > 0 : r.me };
    }
    return { ...m, reactions: list };
  });
}

/** Keeps a thread's message counter (sidebar + starter message chip) current. */
function bumpThreadCount(channelId: string, delta: 1 | -1) {
  const s = useData.getState();
  const guildId = s.channelGuild[channelId];
  const thread = guildId ? s.channels[guildId]?.[channelId] : undefined;
  if (!thread || thread.type !== 11) return;
  const message_count = Math.max(0, thread.message_count + delta);
  s.upsertChannel({ ...thread, message_count, archived: delta > 0 ? false : thread.archived });
  if (thread.parent_id && thread.thread_message_id)
    useMessages.getState().patch(thread.parent_id, thread.thread_message_id, (m) => (m.thread ? { ...m, thread: { ...m.thread, message_count } } : m));
}

function handleDispatch(t: string, d: unknown) {
  const s = useData.getState();
  switch (t) {
    case 'MESSAGE_CREATE': {
      const m = d as Message;
      useMessages.getState().upsert(m);
      s.bumpLastMessage(m.channel_id, m.id);
      bumpThreadCount(m.channel_id, 1);
      if (m.author) useTyping.getState().stop(m.channel_id, m.author.id);
      if (m.author?.id === s.me?.id) s.markRead(m.channel_id, m.id);
      else if (viewing.channelId === m.channel_id && viewing.atBottom && document.hasFocus()) ackChannel(m.channel_id, m.id);
      else if (mentionsMe(m)) s.addMention(m.channel_id);
      break;
    }
    case 'MESSAGE_UPDATE': {
      const m = d as Message;
      useMessages.getState().patch(m.channel_id, m.id, (old) => ({ ...old, ...m, reactions: m.reactions ?? old.reactions }));
      break;
    }
    case 'MESSAGE_DELETE': {
      const { id, channel_id } = d as { id: string; channel_id: string };
      useMessages.getState().remove(channel_id, id);
      bumpThreadCount(channel_id, -1);
      break;
    }
    case 'MESSAGE_REACTION_ADD':
      applyReaction(d as ReactionEvent, 1);
      break;
    case 'MESSAGE_REACTION_REMOVE':
      applyReaction(d as ReactionEvent, -1);
      break;
    case 'MESSAGE_ACK': {
      const { channel_id, message_id } = d as { channel_id: string; message_id: string };
      s.markRead(channel_id, message_id);
      break;
    }
    case 'TYPING_START': {
      const { channel_id, user_id } = d as { channel_id: string; user_id: string };
      if (user_id !== s.me?.id) useTyping.getState().start(channel_id, user_id);
      break;
    }
    case 'GUILD_EMOJIS_UPDATE': {
      const { guild_id, emojis } = d as { guild_id: string; emojis: CustomEmoji[] };
      s.setEmojis(guild_id, emojis);
      break;
    }
    case 'CHANNEL_PINS_UPDATE':
      void queryClient.invalidateQueries({ queryKey: ['pins', (d as { channel_id: string }).channel_id] });
      break;
    case 'READY':
      s.ready(d as ReadyPayload);
      // Missed events were not replayed: cached message lists may have gaps.
      useMessages.getState().reset();
      // A fresh snapshot supersedes cached member lists.
      queryClient.invalidateQueries({ queryKey: ['members'] });
      break;
    case 'RESUMED':
      s.setConnection('ready');
      break;
    case 'GUILD_CREATE':
      s.upsertGuild(d as GuildPayload);
      break;
    case 'GUILD_UPDATE':
      s.updateGuild(d as GuildBase);
      break;
    case 'GUILD_DELETE': {
      const id = (d as { id: string }).id;
      s.removeGuild(id);
      queryClient.removeQueries({ queryKey: ['members', id] });
      break;
    }
    case 'CHANNEL_CREATE':
    case 'CHANNEL_UPDATE':
      s.upsertChannel(d as Channel);
      break;
    case 'CHANNEL_DELETE': {
      const c = d as Channel;
      s.removeChannel(c);
      if (c.type === 11 && c.parent_id && c.thread_message_id)
        useMessages.getState().patch(c.parent_id, c.thread_message_id, (m) => ({ ...m, thread: null }));
      break;
    }
    case 'GUILD_MEMBER_ADD': {
      const m = d as Member;
      updateMembers(m.guild_id, (list) => (list.some((x) => x.user.id === m.user.id) ? list : [...list, m]));
      const g = s.guilds[m.guild_id];
      if (g) s.updateGuild({ ...g, member_count: g.member_count + 1 } as GuildBase);
      break;
    }
    case 'GUILD_MEMBER_REMOVE': {
      const { guild_id, user_id } = d as { guild_id: string; user_id: string };
      updateMembers(guild_id, (list) => list.filter((x) => x.user.id !== user_id));
      const g = s.guilds[guild_id];
      if (g) s.updateGuild({ ...g, member_count: Math.max(0, g.member_count - 1) } as GuildBase);
      break;
    }
    case 'PRESENCE_UPDATE':
      s.setPresence(d as Presence);
      break;
    case 'USER_UPDATE': {
      const u = d as User | PrivateUser;
      if (u.id === s.me?.id && 'email' in u) s.setMe(u);
      else s.upsertUser(u);
      for (const q of queryClient.getQueriesData<Member[]>({ queryKey: ['members'] })) {
        if (q[1]?.some((m) => m.user.id === u.id)) {
          queryClient.setQueryData<Member[]>(q[0], q[1].map((m) => (m.user.id === u.id ? { ...m, user: { ...m.user, ...u } } : m)));
        }
      }
      break;
    }
  }
}
