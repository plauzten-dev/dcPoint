import { memo, useEffect, useState, type ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';
import { API_BASE } from '../api/client';
import { cn } from './cn';
import { copyText } from './format';
import { highlight } from './highlight';

export interface MarkdownContext {
  user(id: string): string | null;
  role(id: string): { name: string; color: string | null } | null;
  channel(id: string): string | null;
  onChannelClick?(id: string): void;
  onUserClick?(id: string, el: HTMLElement): void;
}

// ---------------------------------------------------------------------------
// Inline
// ---------------------------------------------------------------------------

type Rule = { re: RegExp; render: (m: RegExpExecArray, ctx: MarkdownContext, key: number) => ReactNode; wordBoundary?: boolean };

const URL_RE = /https?:\/\/[^\s<]+[^<.,:;"')\]\s]/y;

const rules: Rule[] = [
  { re: /\\([*_~`|\\<>#@:[\]()-])/y, render: (m) => m[1] },
  { re: /(`+)([\s\S]*?[^`])\1(?!`)/y, render: (m, _c, k) => <code key={k} className="md-code">{m[2].trim() || m[2]}</code> },
  { re: /\|\|([\s\S]+?)\|\|/y, render: (m, c, k) => <Spoiler key={k}>{inline(m[1], c)}</Spoiler> },
  { re: /\*\*\*([\s\S]+?)\*\*\*(?!\*)/y, render: (m, c, k) => <strong key={k}><em>{inline(m[1], c)}</em></strong> },
  { re: /\*\*([\s\S]+?)\*\*(?!\*)/y, render: (m, c, k) => <strong key={k}>{inline(m[1], c)}</strong> },
  { re: /__([\s\S]+?)__(?!_)/y, render: (m, c, k) => <u key={k}>{inline(m[1], c)}</u> },
  { re: /\*(?=\S)([\s\S]*?\S)\*(?!\*)/y, render: (m, c, k) => <em key={k}>{inline(m[1], c)}</em> },
  { re: /_(?=\S)([\s\S]*?\S)_(?![\p{L}\p{N}_])/uy, render: (m, c, k) => <em key={k}>{inline(m[1], c)}</em>, wordBoundary: true },
  { re: /~~([\s\S]+?)~~/y, render: (m, c, k) => <s key={k}>{inline(m[1], c)}</s> },
  {
    re: /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/y,
    render: (m, c, k) => (
      <a key={k} href={m[2]} target="_blank" rel="noopener noreferrer" className="md-link" title={m[2]}>
        {inline(m[1], c)}
      </a>
    ),
  },
  {
    re: URL_RE,
    render: (m, _c, k) => (
      <a key={k} href={m[0]} target="_blank" rel="noopener noreferrer" className="md-link">
        {m[0]}
      </a>
    ),
  },
  {
    re: /<@!?(\d+)>/y,
    render: (m, c, k) => (
      <span
        key={k}
        className="md-mention"
        role="button"
        tabIndex={0}
        onClick={(e) => c.onUserClick?.(m[1], e.currentTarget)}
      >
        @{c.user(m[1]) ?? 'unbekannter-benutzer'}
      </span>
    ),
  },
  {
    re: /<@&(\d+)>/y,
    render: (m, c, k) => {
      const r = c.role(m[1]);
      return (
        <span key={k} className="md-mention" style={r?.color ? { color: r.color, background: `${r.color}26` } : undefined}>
          @{r?.name ?? 'gelöschte-rolle'}
        </span>
      );
    },
  },
  {
    re: /<#(\d+)>/y,
    render: (m, c, k) => (
      <span key={k} className="md-mention" role="button" tabIndex={0} onClick={() => c.onChannelClick?.(m[1])}>
        #{c.channel(m[1]) ?? 'unbekannt'}
      </span>
    ),
  },
  { re: /@(everyone|here)/y, render: (m, _c, k) => <span key={k} className="md-mention">@{m[1]}</span> },
  {
    re: /<(a?):(\w{2,32}):(\d+)>/y,
    render: (m, _c, k) => <img key={k} src={`${API_BASE}/cdn/emojis/${m[3]}`} alt={`:${m[2]}:`} title={`:${m[2]}:`} className="md-emoji" draggable={false} />,
  },
];

/** Renders a reaction/picker emoji: unicode or custom `name:id`. */
export function EmojiGlyph({ emoji, size = 16 }: { emoji: string; size?: number }) {
  const custom = /^(\w+):(\d+)$/.exec(emoji);
  if (custom) return <img src={`${API_BASE}/cdn/emojis/${custom[2]}`} alt={`:${custom[1]}:`} width={size} height={size} className="inline-block object-contain" draggable={false} />;
  return <span style={{ fontSize: size }} className="leading-none">{emoji}</span>;
}

/** Characters that may start a rule; everything else is copied verbatim. */
const SPECIAL = /[\\`|*_~[h<@]/g;

export function inline(src: string, ctx: MarkdownContext): ReactNode[] {
  const out: ReactNode[] = [];
  let text = '';
  let i = 0;
  let key = 0;
  const flush = () => {
    if (text) out.push(text);
    text = '';
  };
  while (i < src.length) {
    SPECIAL.lastIndex = i;
    const next = SPECIAL.exec(src);
    if (!next) {
      text += src.slice(i);
      break;
    }
    text += src.slice(i, next.index);
    i = next.index;
    let matched = false;
    for (const rule of rules) {
      if (rule.wordBoundary && i > 0 && /[\p{L}\p{N}]/u.test(src[i - 1])) continue;
      rule.re.lastIndex = i;
      const m = rule.re.exec(src);
      if (m) {
        flush();
        out.push(rule.render(m, ctx, key++));
        i += m[0].length;
        matched = true;
        break;
      }
    }
    if (!matched) {
      text += src[i];
      i += 1;
    }
  }
  flush();
  return out;
}

function Spoiler({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState(false);
  return (
    <span
      role="button"
      tabIndex={0}
      aria-label={shown ? undefined : 'Spoiler anzeigen'}
      onClick={(e) => {
        e.stopPropagation();
        setShown(true);
      }}
      className={cn('md-spoiler', shown && 'md-spoiler-shown')}
    >
      <span aria-hidden={!shown}>{children}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

export const CodeBlock = memo(function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let alive = true;
    if (lang && code.length < 50_000) void highlight(code, lang.toLowerCase()).then((h) => alive && setHtml(h));
    return () => {
      alive = false;
    };
  }, [code, lang]);
  return (
    <div className="md-codeblock group/code relative">
      <button
        aria-label="Code kopieren"
        onClick={() => {
          void copyText(code);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
        className="absolute right-2 top-2 hidden rounded bg-input p-1 text-icon hover:text-icon-hover group-hover/code:block"
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
      {html !== null ? <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} /> : <code>{code}</code>}
    </div>
  );
});

const FENCE = /```([\w+#.-]*)\n?([\s\S]*?)```/g;

function blocks(src: string, ctx: MarkdownContext, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const lines = src.split('\n');
  let para: string[] = [];
  let i = 0;
  const flushPara = () => {
    if (para.length) out.push(<span key={`${keyBase}p${out.length}`}>{inline(para.join('\n'), ctx)}</span>);
    para = [];
  };
  while (i < lines.length) {
    const line = lines[i];
    const heading = /^(#{1,3}) (.+)$/.exec(line);
    const sub = /^-# (.+)$/.exec(line);
    if (line.startsWith('> ') || line === '>') {
      flushPara();
      const quote: string[] = [];
      while (i < lines.length && (lines[i].startsWith('> ') || lines[i] === '>')) quote.push(lines[i++].slice(2));
      out.push(
        <blockquote key={`${keyBase}q${i}`} className="md-quote">
          {inline(quote.join('\n'), ctx)}
        </blockquote>,
      );
      continue;
    }
    if (heading) {
      flushPara();
      const Tag = (['h1', 'h2', 'h3'] as const)[heading[1].length - 1];
      out.push(
        <Tag key={`${keyBase}h${i}`} className={`md-${Tag}`}>
          {inline(heading[2], ctx)}
        </Tag>,
      );
      i++;
      continue;
    }
    if (sub) {
      flushPara();
      out.push(
        <small key={`${keyBase}s${i}`} className="md-sub">
          {inline(sub[1], ctx)}
        </small>,
      );
      i++;
      continue;
    }
    if (/^\s*[-*] \S/.test(line) || /^\s*\d+\. \S/.test(line)) {
      flushPara();
      const ordered = /^\s*\d+\. /.test(line);
      const items: string[] = [];
      const itemRe = ordered ? /^\s*\d+\. (.*)$/ : /^\s*[-*] (.*)$/;
      while (i < lines.length && itemRe.test(lines[i])) items.push(itemRe.exec(lines[i++])![1]);
      const List = ordered ? 'ol' : 'ul';
      out.push(
        <List key={`${keyBase}l${i}`} className={ordered ? 'md-ol' : 'md-ul'}>
          {items.map((it, j) => (
            <li key={j}>{inline(it, ctx)}</li>
          ))}
        </List>,
      );
      continue;
    }
    para.push(line);
    i++;
  }
  flushPara();
  return out;
}

const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}|️|‍|⃣|\s|<a?:\w+:\d+>)+$/u;
const PICTO = /\p{Extended_Pictographic}|\p{Regional_Indicator}|<a?:\w+:\d+>/gu;

/** Messages that consist only of up to 27 emojis render large. */
export function isJumbo(src: string): boolean {
  const t = src.trim();
  if (!t || !EMOJI_ONLY.test(t)) return false;
  const n = t.match(PICTO)?.length ?? 0;
  return n > 0 && n <= 27;
}

export function renderMarkdown(src: string, ctx: MarkdownContext): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let k = 0;
  FENCE.lastIndex = 0;
  for (let m = FENCE.exec(src); m; m = FENCE.exec(src)) {
    if (m.index > last) out.push(...blocks(src.slice(last, m.index).replace(/\n$/, ''), ctx, `b${k++}`));
    out.push(<CodeBlock key={`c${k++}`} code={m[2].replace(/\n$/, '')} lang={m[1]} />);
    last = m.index + m[0].length;
    if (src[last] === '\n') last++;
  }
  if (last < src.length) out.push(...blocks(src.slice(last), ctx, `b${k++}`));
  return out;
}
