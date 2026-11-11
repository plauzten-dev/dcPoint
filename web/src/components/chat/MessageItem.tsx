import { memo, useEffect, useRef, useState, type MouseEvent } from 'react';
import { Copy, Hash, Link, MessagesSquare, Pencil, Pin, PinOff, RefreshCw, Reply, SmilePlus, Trash2, Ellipsis } from 'lucide-react';
import { http } from '../../api/client';
import type { Attachment, Message } from '../../api/types';
import { reportError } from '../../lib/actions';
import { cn } from '../../lib/cn';
import { copyText } from '../../lib/format';
import { EmojiGlyph, isJumbo, renderMarkdown, type MarkdownContext } from '../../lib/markdown';
import { discardFailed, retryMessage } from '../../lib/send';
import { fullTimestamp, messageTimestamp, shortTime } from '../../lib/time';
import { useChatUi } from '../../stores/chatUi';
import { useMessages } from '../../stores/messages';
import { openModal, useOverlay, type MenuEntry } from '../../stores/overlay';
import { Avatar } from '../ui/Avatar';
import { Tooltip } from '../ui/Tooltip';
import { copyMessageLink, deleteMessage, replyTo, startEdit, togglePin, toggleReaction, type AuthorInfo } from './actions';
import { Attachments } from './Attachments';
import { Embeds } from './Embeds';
import { MAX_LENGTH } from './Composer';

function threadName(content: string): string {
  const plain = content.replace(/<[@#][!&]?\d+>|<a?:\w+:\d+>|[*_~`|>]/g, '').replace(/\s+/g, ' ').trim();
  return plain.length > 40 ? `${plain.slice(0, 40).trimEnd()}…` : plain || 'Neuer Thread';
}

/** Single-line preview with mentions resolved (used for reply previews). */
function plainText(src: string, md: MarkdownContext): string {
  return src
    .replace(/<@!?(\d+)>/g, (_, id) => `@${md.user(id) ?? 'unbekannt'}`)
    .replace(/<@&(\d+)>/g, (_, id) => `@${md.role(id)?.name ?? 'rolle'}`)
    .replace(/<#(\d+)>/g, (_, id) => `#${md.channel(id) ?? 'kanal'}`)
    .replace(/```[\s\S]*?```/g, '[Code]')
    .replace(/\|\|[\s\S]*?\|\|/g, '[Spoiler]')
    .replace(/\s+/g, ' ');
}

export interface ItemProps {
  message: Message;
  groupStart: boolean;
  author: AuthorInfo;
  replyAuthor?: AuthorInfo;
  isMine: boolean;
  mentionsMe: boolean;
  canManage: boolean;
  canReact: boolean;
  canSend: boolean;
  flash: boolean;
  md: MarkdownContext;
  onOpenProfile: (userId: string, rect: DOMRect) => void;
  onReactPicker: (m: Message, rect: DOMRect) => void;
  onOpenImage: (a: Attachment) => void;
  onJump: (id: string) => void;
  onOpenThread: (id: string) => void;
  /** May start a thread from this message (text channels only). */
  canThread: boolean;
}

function InlineEditor({ message }: { message: Message }) {
  const [value, setValue] = useState(message.content);
  const ref = useRef<HTMLTextAreaElement>(null);
  const cancel = () => useChatUi.getState().setEditing(null);
  useEffect(() => {
    const el = ref.current!;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  useEffect(() => {
    const el = ref.current!;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 400)}px`;
  }, [value]);
  const save = async () => {
    const content = value.trimEnd();
    cancel();
    if (content === message.content) return;
    if (!content && message.attachments.length === 0) {
      deleteMessage(message);
      return;
    }
    useMessages.getState().patch(message.channel_id, message.id, (m) => ({ ...m, content, edited_at: new Date().toISOString() }));
    try {
      await http.patch(`/channels/${message.channel_id}/messages/${message.id}`, { content });
    } catch (e) {
      useMessages.getState().patch(message.channel_id, message.id, (m) => ({ ...m, content: message.content, edited_at: message.edited_at }));
      reportError(e);
    }
  };
  return (
    <div className="py-1">
      <div className="rounded-lg bg-input px-4 py-2.5">
        <textarea
          ref={ref}
          value={value}
          rows={1}
          maxLength={MAX_LENGTH}
          aria-label="Nachricht bearbeiten"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              cancel();
            } else if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void save();
            }
          }}
          className="block w-full resize-none bg-transparent text-base text-text outline-none"
        />
      </div>
      <div className="mt-1 text-xs text-text">
        Escape zum <button className="text-link hover:underline" onClick={cancel}>Abbrechen</button> • Enter zum{' '}
        <button className="text-link hover:underline" onClick={() => void save()}>Speichern</button>
      </div>
    </div>
  );
}

function ToolbarButton({ label, onClick, children, danger }: { label: string; onClick: (e: MouseEvent<HTMLButtonElement>) => void; children: React.ReactNode; danger?: boolean }) {
  return (
    <Tooltip text={label}>
      <button aria-label={label} onClick={onClick} className={cn('flex size-8 items-center justify-center hover:bg-hover', danger ? 'text-dnd' : 'text-icon hover:text-icon-hover')}>
        {children}
      </button>
    </Tooltip>
  );
}

export const MessageItem = memo(function MessageItem(p: ItemProps) {
  const { message: m, groupStart, author, isMine } = p;
  const editing = useChatUi((s) => s.editingId === m.id);
  const failed = !!m.failed;
  const pending = !!m.pending;

  const menu = (x: number, y: number) => {
    if (failed) {
      useOverlay.getState().openMenu(x, y, [
        { label: 'Erneut senden', icon: <RefreshCw size={16} />, onClick: () => retryMessage(m.channel_id, m.id) },
        { label: 'Nachricht verwerfen', icon: <Trash2 size={16} />, danger: true, onClick: () => discardFailed(m.channel_id, m.id) },
      ]);
      return;
    }
    if (pending) return;
    const items: MenuEntry[] = [
      { label: 'Reaktion hinzufügen', icon: <SmilePlus size={16} />, disabled: !p.canReact, onClick: () => p.onReactPicker(m, new DOMRect(x, y, 0, 0)) },
      ...(isMine ? [{ label: 'Nachricht bearbeiten', icon: <Pencil size={16} />, onClick: () => startEdit(m) }] : []),
      { label: 'Antworten', icon: <Reply size={16} />, disabled: !p.canSend, onClick: () => replyTo(m) },
      ...(p.canThread && !m.thread
        ? [{ label: 'Thread erstellen', icon: <MessagesSquare size={16} />, onClick: () => openModal({ type: 'createThread', channelId: m.channel_id, messageId: m.id, defaultName: threadName(m.content) }) }]
        : []),
      ...(p.canManage ? [{ label: m.pinned ? 'Nachricht loslösen' : 'Nachricht anpinnen', icon: m.pinned ? <PinOff size={16} /> : <Pin size={16} />, onClick: () => void togglePin(m) }] : []),
      { separator: true },
      { label: 'Text kopieren', icon: <Copy size={16} />, disabled: !m.content, onClick: () => void copyText(m.content) },
      { label: 'Nachrichtenlink kopieren', icon: <Link size={16} />, onClick: () => copyMessageLink(m) },
      ...(isMine || p.canManage ? [{ separator: true } as const, { label: 'Nachricht löschen', icon: <Trash2 size={16} />, danger: true, onClick: () => deleteMessage(m) }] : []),
      { separator: true },
      { label: 'Nachrichten-ID kopieren', hint: 'ID', onClick: () => void copyText(m.id) },
    ];
    useOverlay.getState().openMenu(x, y, items);
  };

  const ref = m.referenced_message;
  const content = m.content ? (
    <div className={cn('md text-base leading-[1.375rem] text-text', isJumbo(m.content) && 'md-jumbo', failed && 'text-dnd', pending && 'opacity-60')}>
      {renderMarkdown(m.content, p.md)}
      {m.edited_at && (
        <Tooltip text={fullTimestamp(m.edited_at)} className="inline">
          <span className="ml-1 select-none text-[10px] text-muted">(bearbeitet)</span>
        </Tooltip>
      )}
    </div>
  ) : null;

  return (
    <div
      data-msg-id={m.id}
      role="article"
      aria-label={`${author.name}: ${plainText(m.content.slice(0, 200), p.md)}`}
      onContextMenu={(e) => {
        if ((e.target as HTMLElement).closest('a')) return;
        e.preventDefault();
        menu(e.clientX, e.clientY);
      }}
      className={cn(
        'group relative pl-[72px] pr-12 max-md:pr-3',
        groupStart ? 'mt-[17px] min-h-[44px] py-0.5' : 'py-0.5',
        p.mentionsMe ? 'border-l-2 border-idle bg-idle/10 pl-[70px] hover:bg-idle/[0.14]' : 'hover:bg-black/[0.06] light:hover:bg-black/[0.03]',
        p.flash && 'msg-flash',
      )}
    >
      {ref && (
        <div className="relative mb-1 flex items-center gap-1 text-sm">
          <span className="absolute -left-[38px] top-[9px] h-[13px] w-[33px] rounded-tl-md border-l-2 border-t-2 border-icon-muted/60" aria-hidden />
          {ref.author ? (
            <>
              <Avatar user={ref.author} size={16} />
              <span className="shrink-0 font-medium opacity-80" style={{ color: p.replyAuthor?.color }}>
                @{p.replyAuthor?.name ?? ref.author.username}
              </span>
            </>
          ) : null}
          <button onClick={() => p.onJump(ref.id)} className="min-w-0 truncate text-left text-muted hover:text-text">
            {ref.content ? plainText(ref.content, p.md) : ref.has_attachments ? '📎 Anhang' : 'Ursprüngliche Nachricht wurde gelöscht'}
          </button>
        </div>
      )}
      {m.reply_to_id && !ref && <div className="mb-1 text-sm italic text-muted">Ursprüngliche Nachricht wurde gelöscht</div>}

      {groupStart ? (
        <>
          <button
            className={cn('absolute left-4 cursor-pointer rounded-full', ref ? 'top-[26px]' : 'top-0.5')}
            onClick={(e) => m.author && p.onOpenProfile(m.author.id, e.currentTarget.getBoundingClientRect())}
            aria-label={`Profil von ${author.name}`}
          >
            {m.author ? <Avatar user={m.author} size={40} /> : <div className="size-10 rounded-full bg-hover" />}
          </button>
          <h3 className="flex items-baseline gap-2 leading-[1.375rem]">
            <button
              className="truncate text-base font-medium text-header hover:underline"
              style={author.color ? { color: author.color } : undefined}
              onClick={(e) => m.author && p.onOpenProfile(m.author.id, e.currentTarget.getBoundingClientRect())}
            >
              {author.name}
            </button>
            <Tooltip text={fullTimestamp(m.timestamp)} className="inline">
              <time dateTime={m.timestamp} className="shrink-0 text-xs text-muted">
                {messageTimestamp(m.timestamp)}
              </time>
            </Tooltip>
            {m.pinned && <Pin size={12} className="shrink-0 text-muted" aria-label="Angepinnt" />}
          </h3>
        </>
      ) : (
        <time dateTime={m.timestamp} className="absolute left-0 top-1 hidden w-[72px] pr-2 text-right text-[11px] leading-[1.375rem] text-muted group-hover:block max-md:!hidden">
          {shortTime(m.timestamp)}
        </time>
      )}

      {editing ? <InlineEditor message={m} /> : content}
      <Attachments items={m.attachments} onOpenImage={p.onOpenImage} />
      <Embeds items={m.embeds} />
      {m.thread && (
        <button
          onClick={() => p.onOpenThread(m.thread!.id)}
          className="mt-1.5 flex w-[min(400px,100%)] items-center gap-2 rounded-lg border border-divider bg-sidebar px-3 py-2 text-left hover:bg-hover"
        >
          <MessagesSquare size={18} className="shrink-0 text-icon" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-header">{m.thread.name}</span>
            <span className="text-xs text-link">
              {m.thread.message_count} {m.thread.message_count === 1 ? 'Nachricht' : 'Nachrichten'}
              {m.thread.archived && <span className="ml-1 text-muted">· archiviert</span>}
            </span>
          </span>
        </button>
      )}
      {m.progress !== undefined && pending && (
        <div className="mt-1 h-1.5 w-60 max-w-full overflow-hidden rounded bg-input">
          <div className="h-full bg-brand transition-[width]" style={{ width: `${Math.round(m.progress * 100)}%` }} />
        </div>
      )}
      {failed && (
        <div className="mt-0.5 text-xs text-dnd">
          Nachricht konnte nicht gesendet werden.{' '}
          <button className="text-link hover:underline" onClick={() => retryMessage(m.channel_id, m.id)}>
            Erneut senden
          </button>{' '}
          ·{' '}
          <button className="text-link hover:underline" onClick={() => discardFailed(m.channel_id, m.id)}>
            Verwerfen
          </button>
        </div>
      )}

      {!!m.reactions?.length && (
        <div className="mt-1 flex flex-wrap gap-1">
          {m.reactions.map((r) => (
            <button
              key={r.emoji}
              aria-pressed={r.me}
              aria-label={`${r.emoji} ${r.count}`}
              disabled={!p.canReact && !r.me}
              onClick={() => void toggleReaction(m, r.emoji)}
              className={cn(
                'flex h-6 items-center gap-1.5 rounded-lg border px-1.5 text-sm',
                r.me ? 'border-brand bg-brand/15 text-header' : 'border-transparent bg-sidebar text-muted hover:border-icon-muted/40',
              )}
            >
              <EmojiGlyph emoji={r.emoji} size={16} />
              <span className="font-semibold tabular-nums">{r.count}</span>
            </button>
          ))}
          {p.canReact && (
            <button
              aria-label="Reaktion hinzufügen"
              onClick={(e) => p.onReactPicker(m, e.currentTarget.getBoundingClientRect())}
              className="hidden h-6 items-center rounded-lg bg-sidebar px-1.5 text-icon hover:text-icon-hover group-hover:flex"
            >
              <SmilePlus size={16} />
            </button>
          )}
        </div>
      )}

      {!editing && !pending && !failed && (
        <div className="absolute -top-4 right-3.5 z-10 hidden overflow-hidden rounded-md border border-divider bg-chat shadow-sm group-hover:flex [@media(hover:none)]:!hidden">
          {p.canReact && (
            <ToolbarButton label="Reaktion hinzufügen" onClick={(e) => p.onReactPicker(m, e.currentTarget.getBoundingClientRect())}>
              <SmilePlus size={18} />
            </ToolbarButton>
          )}
          {isMine ? (
            <ToolbarButton label="Bearbeiten" onClick={() => startEdit(m)}>
              <Pencil size={18} />
            </ToolbarButton>
          ) : (
            p.canSend && (
              <ToolbarButton label="Antworten" onClick={() => replyTo(m)}>
                <Reply size={18} />
              </ToolbarButton>
            )
          )}
          {(isMine || p.canManage) && (
            <ToolbarButton label="Löschen (Umschalt: ohne Nachfrage)" danger onClick={(e) => deleteMessage(m, e.shiftKey)}>
              <Trash2 size={18} />
            </ToolbarButton>
          )}
          <ToolbarButton
            label="Mehr"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              menu(r.left, r.bottom + 4);
            }}
          >
            <Ellipsis size={18} />
          </ToolbarButton>
        </div>
      )}
    </div>
  );
});

export function DayDivider({ label }: { label: string }) {
  return (
    <div className="relative mx-4 mb-1 mt-6 flex h-0 items-center border-t border-divider" role="separator">
      <span className="absolute left-1/2 -translate-x-1/2 bg-chat px-1 text-xs font-semibold text-muted">{label}</span>
    </div>
  );
}

export function UnreadDivider() {
  return (
    <div className="relative mx-4 mb-1 mt-4 flex h-0 items-center border-t border-dnd" role="separator" aria-label="Neue Nachrichten">
      <span className="absolute right-0 rounded-r-sm rounded-l bg-dnd px-1 text-[10px] font-bold uppercase leading-[13px] text-white">Neu</span>
    </div>
  );
}

export function ChannelWelcome({ name, onEdit }: { name: string; onEdit?: () => void }) {
  return (
    <div className="m-4 mb-2 max-md:mx-3" data-testid="channel-welcome">
      <div className="mb-2 flex size-[68px] items-center justify-center rounded-full bg-[#4e5058] text-white">
        <Hash size={42} />
      </div>
      <h2 className="my-2 break-words text-[32px] font-bold leading-10 text-header max-md:text-2xl max-md:leading-8">Willkommen in #{name}!</h2>
      <p className="text-base text-muted">Dies ist der Anfang des Kanals #{name}.</p>
      {onEdit && (
        <button onClick={onEdit} className="mt-3 text-sm font-medium text-link hover:underline">
          Kanal bearbeiten
        </button>
      )}
    </div>
  );
}
