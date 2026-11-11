import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { Eye, EyeOff, FileText, Hash, PlusCircle, Smile, Trash2, X } from 'lucide-react';
import { create } from 'zustand';
import { http } from '../../api/client';
import { ChannelType, type Channel } from '../../api/types';
import { reportError } from '../../lib/actions';
import { cn } from '../../lib/cn';
import { searchEmojis } from '../../lib/emoji';
import { EmojiGlyph } from '../../lib/markdown';
import { has, P } from '../../lib/permissions';
import { sendMessage, type OutgoingFile } from '../../lib/send';
import { formatBytes } from '../../lib/time';
import { useChatUi } from '../../stores/chatUi';
import { useData } from '../../stores/data';
import { useMessages } from '../../stores/messages';
import { toast } from '../../stores/overlay';
import { useTyping } from '../../stores/typing';
import { Avatar } from '../ui/Avatar';
import type { useMemberInfo } from './actions';
import { EmojiPicker } from './EmojiPicker';

export const MAX_LENGTH = 4000;
const MAX_FILES = 10;

interface DraftFile extends OutgoingFile {
  id: string;
  preview: string | null;
}

/** Unsent text and files per channel (kept while switching channels). */
const useDrafts = create<{ files: Record<string, DraftFile[]> }>()(() => ({ files: {} }));
const textDrafts = new Map<string, string>();

export function addDraftFiles(channelId: string, list: FileList | File[]) {
  const incoming = [...list];
  useDrafts.setState((s) => {
    const cur = s.files[channelId] ?? [];
    const room = MAX_FILES - cur.length;
    if (incoming.length > room) toast(`Maximal ${MAX_FILES} Dateien pro Nachricht.`, 'error');
    const added = incoming.slice(0, Math.max(0, room)).map((file) => ({
      id: `${Date.now()}-${Math.random()}`,
      file,
      spoiler: false,
      preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
    }));
    return { files: { ...s.files, [channelId]: [...cur, ...added] } };
  });
}

function clearDraftFiles(channelId: string) {
  useDrafts.setState((s) => {
    s.files[channelId]?.forEach((f) => f.preview && URL.revokeObjectURL(f.preview));
    const { [channelId]: _, ...rest } = s.files;
    return { files: rest };
  });
}

type Suggestion =
  | { kind: 'user'; id: string; label: string; sub: string; insert: string; raw: string; avatar: { id: string; avatar: string | null; username: string } }
  | { kind: 'role'; id: string; label: string; insert: string; raw: string; color?: string }
  | { kind: 'special'; id: string; label: string; insert: string; sub: string }
  | { kind: 'channel'; id: string; label: string; insert: string; raw: string }
  | { kind: 'emoji'; id: string; label: string; insert: string }
  | { kind: 'custom'; id: string; label: string; insert: string; raw: string };

interface Props {
  channel: Channel;
  perms: bigint;
  info: ReturnType<typeof useMemberInfo>;
}

export function Composer({ channel, perms, info }: Props) {
  const channelId = channel.id;
  const [value, setValue] = useState(() => textDrafts.get(channelId) ?? '');
  const files = useDrafts((s) => s.files[channelId]) ?? [];
  const replyTo = useChatUi((s) => s.replyTo);
  const replyMention = useChatUi((s) => s.replyMention);
  const [cursor, setCursor] = useState(0);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [emojiAnchor, setEmojiAnchor] = useState<DOMRect | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const tokens = useRef(new Map<string, string>());
  /** Caret position to restore right after the next value change (before further keystrokes). */
  const pendingCaret = useRef<number | null>(null);
  const lastTyping = useRef(0);
  const channels = useData((s) => (channel.guild_id ? s.channels[channel.guild_id] : undefined));
  const customEmojis = useData((s) => s.emojis);
  const canSend = has(perms, P.SEND_MESSAGES);
  const canAttach = has(perms, P.ATTACH_FILES);
  const canEveryone = has(perms, P.MENTION_EVERYONE);

  useEffect(() => {
    textDrafts.set(channelId, value);
  }, [channelId, value]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (pendingCaret.current !== null) {
      el.setSelectionRange(pendingCaret.current, pendingCaret.current);
      setCursor(pendingCaret.current);
      pendingCaret.current = null;
    }
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, window.innerHeight * 0.5)}px`;
  }, [value]);

  // Autocomplete trigger directly before the cursor: @name, #channel or :emoji
  const trigger = useMemo(() => {
    const before = value.slice(0, cursor);
    const m = /(^|\s)([@#:])([^\s@#:]*)$/.exec(before);
    if (!m) return null;
    if (m[2] === ':' && m[3].length < 2) return null;
    return { char: m[2], query: m[3].toLowerCase(), start: before.length - m[3].length - 1 };
  }, [value, cursor]);

  const suggestions = useMemo<Suggestion[]>(() => {
    if (!trigger || `${trigger.start}:${trigger.query}` === dismissed) return [];
    const q = trigger.query;
    if (trigger.char === '@') {
      const out: Suggestion[] = [];
      for (const m of info.members.values()) {
        const name = info.info(m.user.id).name;
        if (!q || name.toLowerCase().startsWith(q) || m.user.username.startsWith(q)) {
          out.push({ kind: 'user', id: m.user.id, label: name, sub: m.user.username, insert: `@${name}`, raw: `<@${m.user.id}>`, avatar: m.user });
        }
        if (out.length >= 8) break;
      }
      for (const r of Object.values(info.roles)) {
        if (r.id === channel.guild_id || (!r.mentionable && !canEveryone)) continue;
        if (!q || r.name.toLowerCase().startsWith(q)) out.push({ kind: 'role', id: r.id, label: r.name, insert: `@${r.name}`, raw: `<@&${r.id}>`, color: r.color ? `#${r.color.toString(16).padStart(6, '0')}` : undefined });
      }
      if (canEveryone) {
        for (const s of ['everyone', 'here']) {
          if (s.startsWith(q)) out.push({ kind: 'special', id: s, label: `@${s}`, insert: `@${s}`, sub: s === 'everyone' ? 'Alle, die Zugriff auf diesen Kanal haben' : 'Alle, die online sind' });
        }
      }
      return out.slice(0, 10);
    }
    if (trigger.char === '#') {
      return Object.values(channels ?? {})
        .filter((c) => c.type === ChannelType.GuildText && c.name.startsWith(q))
        .slice(0, 10)
        .map((c) => ({ kind: 'channel', id: c.id, label: c.name, insert: `#${c.name}`, raw: `<#${c.id}>` }));
    }
    const custom: Suggestion[] = Object.values(customEmojis)
      .flat()
      .filter((e) => e.name.toLowerCase().startsWith(q))
      .slice(0, 5)
      .map((e) => ({ kind: 'custom', id: e.id, label: `:${e.name}:`, insert: `:${e.name}:`, raw: `<${e.animated ? 'a' : ''}:${e.name}:${e.id}>` }));
    return [...custom, ...searchEmojis(q, 10 - custom.length).map(([e, name]): Suggestion => ({ kind: 'emoji', id: name, label: `:${name}:`, insert: e }))];
  }, [trigger, dismissed, info, channels, canEveryone, channel.guild_id, customEmojis]);

  useEffect(() => setActive(0), [suggestions.length, trigger?.query]);

  const insertAt = (start: number, end: number, text: string) => {
    const next = value.slice(0, start) + text + value.slice(end);
    pendingCaret.current = start + text.length;
    setValue(next);
    ref.current?.focus();
  };

  const choose = (s: Suggestion) => {
    if (!trigger) return;
    if ('raw' in s) tokens.current.set(s.insert, s.raw);
    insertAt(trigger.start, cursor, `${s.insert} `);
  };

  /** Turns "@Name" / "#channel" picked from autocomplete into wire tokens. */
  const encode = (text: string) => {
    let out = text;
    const entries = [...tokens.current.entries()].sort((a, b) => b[0].length - a[0].length);
    for (const [display, raw] of entries) out = out.split(display).join(raw);
    return out;
  };

  const notifyTyping = () => {
    const now = Date.now();
    if (now - lastTyping.current < 8000) return;
    lastTyping.current = now;
    void http.post(`/channels/${channelId}/typing`).catch(() => {});
  };

  const send = () => {
    const content = encode(value.trim());
    if (!content && files.length === 0) return;
    if (content.length > MAX_LENGTH) {
      toast(`Nachrichten dürfen höchstens ${MAX_LENGTH} Zeichen lang sein.`, 'error');
      return;
    }
    const outgoing = files.map(({ file, spoiler }) => ({ file, spoiler }));
    setValue('');
    textDrafts.delete(channelId);
    tokens.current.clear();
    clearDraftFiles(channelId);
    useChatUi.getState().setReply(null);
    lastTyping.current = 0;
    useTyping.getState().stop(channelId, useData.getState().me?.id ?? '');
    void sendMessage({ channelId, content, replyTo, replyMention, files: outgoing }).catch(reportError);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (suggestions.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        choose(suggestions[active]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setDismissed(`${trigger!.start}:${trigger!.query}`);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    } else if (e.key === 'Escape' && replyTo) {
      e.preventDefault();
      e.stopPropagation();
      useChatUi.getState().setReply(null);
    } else if (e.key === 'ArrowUp' && !value) {
      const me = useData.getState().me?.id;
      const list = useMessages.getState().channels[channelId]?.messages ?? [];
      const mine = [...list].reverse().find((m) => m.author?.id === me && !m.pending && !m.failed);
      if (mine) {
        e.preventDefault();
        useChatUi.getState().setEditing(mine.id);
      }
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    if (e.clipboardData.files.length && canAttach) {
      e.preventDefault();
      addDraftFiles(channelId, e.clipboardData.files);
    }
  };

  const replyAuthor = replyTo?.author ? info.info(replyTo.author.id, replyTo.author) : null;
  const placeholder = canSend ? `Nachricht an #${channel.name}` : 'Du hast keine Berechtigung, in diesem Kanal Nachrichten zu senden.';

  return (
    <div className="relative shrink-0 px-4 max-md:px-2">
      {suggestions.length > 0 && (
        <div className="absolute inset-x-4 bottom-full z-20 mb-2 overflow-hidden rounded-lg bg-sidebar py-2 shadow-elevation max-md:inset-x-2" role="listbox">
          <div className="px-3 pb-1 text-xs font-bold uppercase text-muted">
            {trigger?.char === '@' ? 'Mitglieder' : trigger?.char === '#' ? 'Textkanäle' : 'Emojis'}
          </div>
          {suggestions.map((s, i) => (
            <button
              key={`${s.kind}-${s.id}`}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(s);
              }}
              className={cn('flex h-9 w-full items-center gap-2 px-3 text-left', i === active && 'bg-selected')}
            >
              {s.kind === 'user' && <Avatar user={s.avatar} size={24} />}
              {s.kind === 'channel' && <Hash size={18} className="text-icon-muted" />}
              {s.kind === 'emoji' && <span className="text-xl">{s.insert}</span>}
              {s.kind === 'custom' && <EmojiGlyph emoji={`${s.label.slice(1, -1)}:${s.id}`} size={22} />}
              <span className="truncate text-sm font-medium text-header" style={s.kind === 'role' ? { color: s.color } : undefined}>
                {s.kind === 'role' ? `@${s.label}` : s.label}
              </span>
              {(s.kind === 'user' || s.kind === 'special') && <span className="ml-auto truncate text-xs text-muted">{s.sub}</span>}
            </button>
          ))}
        </div>
      )}

      {replyTo && (
        <div className="flex h-9 items-center gap-2 rounded-t-lg bg-sidebar px-4 text-sm text-muted">
          <span className="min-w-0 flex-1 truncate">
            Antworten an <strong className="font-semibold text-header">{replyAuthor?.name ?? 'Unbekannt'}</strong>
          </span>
          <button onClick={() => useChatUi.getState().toggleReplyMention()} className={cn('shrink-0 text-xs font-bold', replyMention ? 'text-link' : 'text-muted')}>
            @{replyMention ? 'AN' : 'AUS'}
          </button>
          <button aria-label="Antwort abbrechen" onClick={() => useChatUi.getState().setReply(null)} className="text-icon hover:text-icon-hover">
            <X size={16} />
          </button>
        </div>
      )}

      <div className={cn('bg-input', replyTo ? 'rounded-b-lg' : 'rounded-lg', !canSend && 'opacity-60')}>
        {files.length > 0 && (
          <div className="scroller-thin flex gap-3 overflow-x-auto border-b border-divider p-3">
            {files.map((f) => (
              <div key={f.id} className="relative flex w-[180px] shrink-0 flex-col rounded bg-sidebar p-2">
                <div className="flex h-[130px] items-center justify-center overflow-hidden rounded">
                  {f.preview ? <img src={f.preview} alt="" className={cn('max-h-full max-w-full object-contain', f.spoiler && 'blur-xl')} /> : <FileText size={56} className="text-brand" />}
                </div>
                <div className="mt-2 truncate text-sm text-text">{f.file.name}</div>
                <div className="text-xs text-muted">{formatBytes(f.file.size)}</div>
                <div className="absolute right-1 top-1 flex overflow-hidden rounded bg-chat shadow">
                  <button
                    aria-label={f.spoiler ? 'Spoiler entfernen' : 'Als Spoiler markieren'}
                    onClick={() => useDrafts.setState((s) => ({ files: { ...s.files, [channelId]: s.files[channelId].map((x) => (x.id === f.id ? { ...x, spoiler: !x.spoiler } : x)) } }))}
                    className="p-1.5 text-icon hover:text-icon-hover"
                  >
                    {f.spoiler ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                  <button
                    aria-label="Datei entfernen"
                    onClick={() => {
                      if (f.preview) URL.revokeObjectURL(f.preview);
                      useDrafts.setState((s) => ({ files: { ...s.files, [channelId]: s.files[channelId].filter((x) => x.id !== f.id) } }));
                    }}
                    className="p-1.5 text-dnd hover:bg-hover"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-start">
          <button
            type="button"
            aria-label="Datei hochladen"
            disabled={!canSend || !canAttach}
            onClick={() => fileInput.current?.click()}
            className="flex h-11 shrink-0 items-center px-4 text-icon hover:text-icon-hover disabled:opacity-50 max-md:px-3"
          >
            <PlusCircle size={22} />
          </button>
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files?.length) addDraftFiles(channelId, e.target.files);
              e.target.value = '';
            }}
          />
          <textarea
            ref={ref}
            data-composer
            rows={1}
            value={value}
            disabled={!canSend}
            placeholder={placeholder}
            aria-label={placeholder}
            maxLength={MAX_LENGTH + 500}
            onChange={(e) => {
              setValue(e.target.value);
              setCursor(e.target.selectionStart);
              setDismissed(null);
              if (e.target.value) notifyTyping();
            }}
            onSelect={(e) => setCursor(e.currentTarget.selectionStart)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            className="scroller-thin min-w-0 flex-1 resize-none bg-transparent py-[11px] text-base leading-[1.375rem] text-text outline-none placeholder:text-icon-muted"
          />
          {value.length > MAX_LENGTH - 200 && (
            <span className={cn('self-center px-1 text-xs tabular-nums', value.length > MAX_LENGTH ? 'text-dnd' : 'text-muted')}>{MAX_LENGTH - value.length}</span>
          )}
          <button
            type="button"
            aria-label="Emoji auswählen"
            disabled={!canSend}
            onClick={(e) => setEmojiAnchor(emojiAnchor ? null : e.currentTarget.getBoundingClientRect())}
            className="flex h-11 shrink-0 items-center px-3 text-icon hover:text-icon-hover"
          >
            <Smile size={22} />
          </button>
        </div>
      </div>
      {emojiAnchor && (
        <EmojiPicker
          anchor={emojiAnchor}
          onClose={() => setEmojiAnchor(null)}
          onSelect={(emoji, custom) => {
            const el = ref.current;
            const start = el?.selectionStart ?? value.length;
            const end = el?.selectionEnd ?? value.length;
            if (custom) {
              tokens.current.set(`:${custom.name}:`, `<${custom.animated ? 'a' : ''}:${custom.name}:${custom.id}>`);
              insertAt(start, end, `:${custom.name}:`);
            } else insertAt(start, end, emoji);
          }}
        />
      )}
    </div>
  );
}

export function TypingIndicator({ channelId, info }: { channelId: string; info: ReturnType<typeof useMemberInfo> }) {
  const typing = useTyping((s) => s.typing[channelId]);
  const names = Object.entries(typing ?? {})
    .filter(([, until]) => until > Date.now())
    .map(([id]) => info.info(id).name);
  const text =
    names.length === 0
      ? ''
      : names.length === 1
        ? `${names[0]} schreibt …`
        : names.length <= 3
          ? `${names.slice(0, -1).join(', ')} und ${names[names.length - 1]} schreiben …`
          : 'Mehrere Leute schreiben …';
  return (
    <div className="flex h-6 shrink-0 items-center gap-1.5 px-4 text-xs text-text max-md:px-3" aria-live="polite">
      {text && (
        <>
          <span className="flex gap-0.5" aria-hidden>
            {[0, 1, 2].map((i) => (
              <span key={i} className="size-1.5 animate-bounce rounded-full bg-text" style={{ animationDelay: `${i * 120}ms` }} />
            ))}
          </span>
          <span className="truncate font-medium">{text}</span>
        </>
      )}
    </div>
  );
}
