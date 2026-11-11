import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown } from 'lucide-react';
import { ChannelType, type Attachment, type Channel, type Message } from '../../api/types';
import { showChat } from '../../lib/mobile';
import { reportError } from '../../lib/actions';
import { has, P } from '../../lib/permissions';
import { ackChannel, isUnread, mentionsMe, viewing } from '../../lib/readState';
import { isNewer } from '../../lib/snowflake';
import { dayLabel, isSameDay } from '../../lib/time';
import { useData } from '../../stores/data';
import { useMessages } from '../../stores/messages';
import { openModal } from '../../stores/overlay';
import { useMarkdownContext, useMemberInfo } from './actions';
import { ImageViewer } from './Attachments';
import { EmojiPicker } from './EmojiPicker';
import { toggleReaction } from './actions';
import { ChannelWelcome, DayDivider, MessageItem, UnreadDivider } from './MessageItem';
import { ThreadWelcome } from './ThreadViews';
import { UserProfilePopout } from './UserProfilePopout';

const GROUP_MS = 7 * 60 * 1000;

type Row =
  | { kind: 'welcome'; key: string }
  | { kind: 'loading'; key: string }
  | { kind: 'day'; key: string; label: string }
  | { kind: 'unread'; key: string }
  | { kind: 'message'; key: string; message: Message; groupStart: boolean };

function buildRows(messages: Message[], hasMoreBefore: boolean, unreadAfter: string | null, meId: string | undefined): Row[] {
  const rows: Row[] = [hasMoreBefore ? { kind: 'loading', key: 'loading' } : { kind: 'welcome', key: 'welcome' }];
  let prev: Message | null = null;
  let unreadPlaced = false;
  for (const m of messages) {
    if (!prev || !isSameDay(prev.timestamp, m.timestamp)) rows.push({ kind: 'day', key: `day-${m.id}`, label: dayLabel(m.timestamp) });
    const unread = !unreadPlaced && unreadAfter !== null && isNewer(m.id, unreadAfter) && m.author?.id !== meId && !m.pending;
    if (unread) {
      rows.push({ kind: 'unread', key: 'unread' });
      unreadPlaced = true;
    }
    const groupStart =
      !prev ||
      unread ||
      prev.author?.id !== m.author?.id ||
      m.type === 19 ||
      new Date(m.timestamp).getTime() - new Date(prev.timestamp).getTime() > GROUP_MS ||
      !isSameDay(prev.timestamp, m.timestamp);
    // Optimistic messages keep a stable key when the server copy replaces them.
    rows.push({ kind: 'message', key: m.nonce ?? m.id, message: m, groupStart });
    prev = m;
  }
  return rows;
}

function estimate(row: Row): number {
  switch (row.kind) {
    case 'welcome':
      return 180;
    case 'loading':
      return 120;
    case 'day':
      return 40;
    case 'unread':
      return 24;
    case 'message': {
      let h = row.groupStart ? 64 : 24;
      for (const a of row.message.attachments) h += a.width && a.height ? Math.min(300, (a.height * Math.min(1, 400 / a.width)) | 0) + 8 : 80;
      if (row.message.reactions?.length) h += 30;
      if (row.message.content.includes('```')) h += 60;
      return h;
    }
  }
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6 px-4 py-6" aria-label="Ältere Nachrichten werden geladen">
      {[0, 1].map((i) => (
        <div key={i} className="flex gap-4 opacity-60">
          <div className="size-10 shrink-0 rounded-full bg-hover" />
          <div className="flex-1 space-y-2">
            <div className="h-3.5 w-32 rounded bg-hover" />
            <div className="h-3.5 w-3/4 rounded bg-hover" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function MessageList({ channel, perms }: { channel: Channel; perms: bigint }) {
  const navigate = useNavigate();
  const channelId = channel.id;
  const guildId = channel.guild_id;
  const state = useMessages((s) => s.channels[channelId]);
  const meId = useData((s) => s.me?.id);
  const info = useMemberInfo(guildId);
  const md = useMarkdownContext(guildId, navigate, info);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stick = useRef(!state?.jumpTo);
  /** First visible row before older history is prepended; restored once the new rows exist. */
  const anchor = useRef<{ key: string; offset: number; count: number } | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [flashId, setFlashId] = useState<string | null>(null);
  const [profile, setProfile] = useState<{ userId: string; rect: DOMRect } | null>(null);
  const [picker, setPicker] = useState<{ message: Message; rect: DOMRect } | null>(null);
  const [image, setImage] = useState<Attachment | null>(null);
  // Snapshot of the read position when the channel was opened ("NEU" divider).
  const [unreadAfter] = useState(() => (isUnread(channelId) ? (useData.getState().readStates[channelId]?.last ?? '0') : null));

  const canManage = has(perms, P.MANAGE_MESSAGES);
  const canReact = has(perms, P.ADD_REACTIONS);
  const canSend = has(perms, P.SEND_MESSAGES);
  const isThread = channel.type === ChannelType.PublicThread;
  const canThread = channel.type === ChannelType.GuildText && has(perms, P.CREATE_PUBLIC_THREADS);

  useEffect(() => {
    void useMessages.getState().load(channelId).catch(reportError);
    viewing.channelId = channelId;
    viewing.atBottom = true;
    return () => {
      if (viewing.channelId === channelId) viewing.channelId = null;
    };
  }, [channelId]);

  const messages = state?.messages;
  const rows = useMemo(
    () => (messages ? buildRows(messages, state.hasMoreBefore, unreadAfter, meId) : []),
    [messages, state?.hasMoreBefore, unreadAfter, meId],
  );

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => estimate(rows[i]),
    getItemKey: (i) => rows[i].key,
    overscan: 10,
  });

  // Keep the viewport anchored: at the bottom, or on the same message after older history was prepended.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (anchor.current) {
      // Intermediate renders (e.g. the loading flag) must not consume the anchor.
      if (rows.length === anchor.current.count) return;
      const idx = rows.findIndex((r) => r.key === anchor.current!.key);
      if (idx >= 0) {
        const start = virtualizer.measurementsCache[idx]?.start ?? 0;
        el.scrollTop = start - anchor.current.offset;
      }
      anchor.current = null;
    } else if (stick.current) {
      el.scrollTop = el.scrollHeight;
    }
  });

  // Jump to a message (reply click, pins, links).
  useEffect(() => {
    const target = state?.jumpTo;
    if (!target) return;
    const idx = rows.findIndex((r) => r.kind === 'message' && r.message.id === target);
    if (idx < 0) return;
    stick.current = false;
    virtualizer.scrollToIndex(idx, { align: 'center' });
    setFlashId(target);
    useMessages.getState().clearJump(channelId);
    const t = setTimeout(() => setFlashId(null), 2000);
    return () => clearTimeout(t);
  }, [state?.jumpTo, rows, virtualizer, channelId]);

  const lastId = messages?.[messages.length - 1]?.id;
  useEffect(() => {
    if (atBottom && !state?.hasMoreAfter && document.hasFocus()) ackChannel(channelId);
  }, [atBottom, lastId, channelId, state?.hasMoreAfter]);

  useEffect(() => {
    const onFocus = () => viewing.atBottom && viewing.channelId === channelId && ackChannel(channelId);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [channelId]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !state) return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    stick.current = bottom && !state.hasMoreAfter;
    viewing.atBottom = stick.current;
    setAtBottom(stick.current);
    if (el.scrollTop < 600 && state.hasMoreBefore && !state.loading) {
      // Remember the first visible message so prepending does not move the view.
      const first = virtualizer.getVirtualItems().find((v) => rows[v.index]?.kind === 'message' && v.end > el.scrollTop);
      if (first) anchor.current = { key: String(first.key), offset: first.start - el.scrollTop, count: rows.length };
      void useMessages.getState().loadOlder(channelId).catch(reportError);
    }
    if (state.hasMoreAfter && el.scrollHeight - el.scrollTop - el.clientHeight < 600 && !state.loading) {
      void useMessages.getState().loadNewer(channelId).catch(reportError);
    }
  }, [state, virtualizer, rows, channelId]);

  // Still at the very top after a page arrived (no scroll event will fire): keep loading.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && !stick.current && el.scrollTop < 200 && state?.hasMoreBefore && !state.loading) onScroll();
  }, [state?.hasMoreBefore, state?.loading, onScroll]);

  const openProfile = useCallback((userId: string, rect: DOMRect) => setProfile({ userId, rect }), []);
  const openPicker = useCallback((message: Message, rect: DOMRect) => setPicker({ message, rect }), []);
  const openThread = useCallback(
    (id: string) => {
      navigate(`/channels/${guildId}/${id}`);
      showChat();
    },
    [navigate, guildId],
  );
  const jump = useCallback((id: string) => void useMessages.getState().jump(channelId, id).catch(reportError), [channelId]);

  const jumpToPresent = () => {
    const c = useMessages.getState().channels[channelId];
    stick.current = true;
    if (c?.hasMoreAfter) {
      useMessages.setState((s) => {
        const { [channelId]: _, ...rest } = s.channels;
        return { channels: rest };
      });
      void useMessages.getState().load(channelId);
    } else {
      virtualizer.scrollToIndex(rows.length - 1, { align: 'end' });
    }
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={scrollRef} onScroll={onScroll} className="scroller-auto flex-1 [overflow-anchor:none]" data-testid="message-list">
        {!state || (state.loading && !state.messages.length) ? (
          <div className="flex h-full flex-col justify-end">
            <LoadingSkeleton />
          </div>
        ) : (
          <div className="flex min-h-full flex-col justify-end">
            <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
              {virtualizer.getVirtualItems().map((v) => {
                const row = rows[v.index];
                return (
                  <div key={v.key} data-index={v.index} ref={virtualizer.measureElement} style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${v.start}px)` }}>
                    {row.kind === 'welcome' && isThread ? (
                      <ThreadWelcome thread={channel} md={md} info={info} />
                    ) : row.kind === 'welcome' ? (
                      <ChannelWelcome name={channel.name} onEdit={has(perms, P.MANAGE_CHANNELS) ? () => openModal({ type: 'channelSettings', channelId }) : undefined} />
                    ) : row.kind === 'loading' ? (
                      <LoadingSkeleton />
                    ) : row.kind === 'day' ? (
                      <DayDivider label={row.label} />
                    ) : row.kind === 'unread' ? (
                      <UnreadDivider />
                    ) : (
                      <MessageItem
                        message={row.message}
                        groupStart={row.groupStart}
                        author={info.info(row.message.author?.id ?? '', row.message.author)}
                        replyAuthor={row.message.referenced_message?.author ? info.info(row.message.referenced_message.author.id, row.message.referenced_message.author) : undefined}
                        isMine={row.message.author?.id === meId}
                        mentionsMe={mentionsMe(row.message)}
                        canManage={canManage}
                        canReact={canReact}
                        canSend={canSend}
                        canThread={canThread}
                        onOpenThread={openThread}
                        flash={flashId === row.message.id}
                        md={md}
                        onOpenProfile={openProfile}
                        onReactPicker={openPicker}
                        onOpenImage={setImage}
                        onJump={jump}
                      />
                    )}
                  </div>
                );
              })}
            </div>
            <div className="h-6 shrink-0" />
          </div>
        )}
      </div>
      {(!atBottom || state?.hasMoreAfter) && state && state.messages.length > 0 && (
        <button
          onClick={jumpToPresent}
          className="absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-brand px-4 py-1.5 text-sm font-semibold text-white shadow-elevation hover:bg-brand-hover"
        >
          Zu neuen Nachrichten springen <ArrowDown size={16} />
        </button>
      )}
      {profile && guildId && <UserProfilePopout userId={profile.userId} guildId={guildId} anchor={profile.rect} onClose={() => setProfile(null)} />}
      {picker && (
        <EmojiPicker anchor={picker.rect} placement="left" align="start" onClose={() => setPicker(null)} onSelect={(e) => void toggleReaction(picker.message, e)} />
      )}
      {image && <ImageViewer attachment={image} onClose={() => setImage(null)} />}
    </div>
  );
}
