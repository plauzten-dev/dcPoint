import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Hash, Volume2 } from 'lucide-react';
import { ChannelType } from '../api/types';
import { GuildIcon } from '../components/GuildIcon';
import { cn } from '../lib/cn';
import { guildPath } from '../lib/navigation';
import { useData } from '../stores/data';
import { toast } from '../stores/overlay';

type Result =
  | { kind: 'channel'; id: string; guildId: string; name: string; guildName: string; voice: boolean; score: number }
  | { kind: 'guild'; id: string; name: string; icon: string | null; score: number };

/** Lower is better; -1 means no match. Prefix > word start > substring > subsequence. */
export function matchScore(query: string, text: string): number {
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (t.startsWith(q)) return 1;
  if (t.split(/[\s\-_]/).some((w) => w.startsWith(q))) return 2;
  if (t.includes(q)) return 3;
  let i = 0;
  for (const ch of t) if (ch === q[i]) i++;
  return i === q.length ? 4 : -1;
}

export default function QuickSwitcher({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const guilds = useData((s) => s.guilds);
  const channels = useData((s) => s.channels);
  const order = useData((s) => s.guildOrder);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const currentGuild = location.pathname.split('/')[2];

  const results = useMemo<Result[]>(() => {
    const mode = query[0] === '#' ? 'channel' : query[0] === '*' ? 'guild' : 'all';
    const q = mode === 'all' ? query.trim() : query.slice(1).trim();
    const out: Result[] = [];
    if (mode !== 'guild') {
      for (const gid of order) {
        for (const c of Object.values(channels[gid] ?? {})) {
          if (c.type === ChannelType.GuildCategory) continue;
          const score = matchScore(q, c.name);
          if (score < 0) continue;
          out.push({ kind: 'channel', id: c.id, guildId: gid, name: c.name, guildName: guilds[gid]?.name ?? '', voice: c.type === ChannelType.GuildVoice, score: score + (gid === currentGuild ? 0 : 0.5) });
        }
      }
    }
    if (mode !== 'channel') {
      for (const gid of order) {
        const g = guilds[gid];
        const score = g ? matchScore(q, g.name) : -1;
        if (g && score >= 0) out.push({ kind: 'guild', id: g.id, name: g.name, icon: g.icon, score });
      }
    }
    return out.sort((a, b) => a.score - b.score || a.name.localeCompare(b.name)).slice(0, 50);
  }, [query, order, channels, guilds, currentGuild]);

  const go = (r: Result | undefined) => {
    if (!r) return;
    onClose();
    if (r.kind === 'guild') navigate(guildPath(r.id));
    else if (r.voice) toast('Sprachkanäle werden in Phase 4 freigeschaltet.');
    else navigate(`/channels/${r.guildId}/${r.id}`);
  };

  const move = (delta: number) => {
    const next = (active + delta + results.length) % Math.max(1, results.length);
    setActive(next);
    listRef.current?.children[next]?.scrollIntoView({ block: 'nearest' });
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 animate-fade-in bg-black/70" onMouseDown={onClose} />
      <div role="dialog" aria-label="Quick Switcher" className="relative w-[570px] max-w-[calc(100vw-32px)] animate-modal-in rounded-lg bg-sidebar p-4 shadow-elevation">
        <input
          autoFocus
          value={query}
          onChange={(e) => (setQuery(e.target.value), setActive(0))}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') (e.preventDefault(), move(1));
            else if (e.key === 'ArrowUp') (e.preventDefault(), move(-1));
            else if (e.key === 'Enter') go(results[active]);
          }}
          placeholder="Wohin möchtest du?"
          aria-label="Wohin möchtest du?"
          className="h-[70px] w-full rounded-[5px] bg-input-strong px-4 text-xl text-text outline-none placeholder:text-icon-muted"
        />
        <div ref={listRef} className="scroller-thin mt-2 max-h-[300px]" role="listbox">
          {results.map((r, i) => (
            <button
              key={`${r.kind}-${r.id}`}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onClick={() => go(r)}
              className={cn('flex h-[34px] w-full items-center gap-2 rounded px-2 text-left', i === active ? 'bg-selected text-header' : 'text-muted')}
            >
              {r.kind === 'channel' ? (
                <>
                  {r.voice ? <Volume2 size={18} className="text-icon-muted" /> : <Hash size={18} className="text-icon-muted" />}
                  <span className="truncate font-medium">{r.name}</span>
                  <span className="ml-auto truncate pl-4 text-xs font-semibold uppercase text-muted">{r.guildName}</span>
                </>
              ) : (
                <>
                  <GuildIcon guild={r} size={20} className="rounded-full text-[8px]" />
                  <span className="truncate font-medium">{r.name}</span>
                </>
              )}
            </button>
          ))}
          {results.length === 0 && <p className="py-6 text-center text-sm text-muted">Keine Ergebnisse für „{query}“</p>}
        </div>
        <p className="mt-3 text-xs font-bold uppercase text-online">
          Tipp: <span className="font-medium normal-case text-muted">Beginne mit # für Kanäle oder * für Server.</span>
        </p>
      </div>
    </div>
  );
}
