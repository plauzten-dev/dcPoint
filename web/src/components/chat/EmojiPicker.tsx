import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import type { CustomEmoji } from '../../api/types';
import { EMOJI_CATEGORIES, recentEmojis, searchEmojis, type EmojiEntry } from '../../lib/emoji';
import { EmojiGlyph } from '../../lib/markdown';
import { useData } from '../../stores/data';
import { Popout } from '../ui/Popout';

interface Props {
  anchor: DOMRect;
  /** Unicode emoji, or for custom emojis `name:id` plus the emoji itself. */
  onSelect: (emoji: string, custom?: CustomEmoji) => void;
  onClose: () => void;
  placement?: 'top' | 'bottom' | 'left' | 'right';
  align?: 'start' | 'end' | 'center';
}

function Grid({ items, onSelect, onHover }: { items: EmojiEntry[]; onSelect: (e: string) => void; onHover: (e: EmojiEntry) => void }) {
  return (
    <div className="grid grid-cols-8 gap-0.5">
      {items.map((e) => (
        <button
          key={e[0]}
          type="button"
          aria-label={e[1]}
          onMouseEnter={() => onHover(e)}
          onClick={() => onSelect(e[0])}
          className="flex size-10 items-center justify-center rounded text-2xl hover:bg-hover"
        >
          <EmojiGlyph emoji={e[0]} size={24} />
        </button>
      ))}
    </div>
  );
}

export function EmojiPicker({ anchor, onSelect, onClose, placement = 'top', align = 'end' }: Props) {
  const [query, setQuery] = useState('');
  const [hovered, setHovered] = useState<EmojiEntry | null>(null);
  const recent = useMemo(() => recentEmojis(), []);
  const results = useMemo(() => searchEmojis(query, 120), [query]);
  const lookup = useMemo(() => new Map(EMOJI_CATEGORIES.flatMap((c) => c.emojis).map((e) => [e[0], e])), []);
  const guilds = useData((s) => s.guilds);
  const allCustom = useData((s) => s.emojis);
  const currentGuild = location.pathname.split('/')[2];
  const customGroups = useMemo(
    () =>
      Object.entries(allCustom)
        .filter(([, list]) => list.length)
        .sort(([a], [b]) => Number(b === currentGuild) - Number(a === currentGuild))
        .map(([gid, list]) => ({ name: guilds[gid]?.name ?? 'Server', list })),
    [allCustom, guilds, currentGuild],
  );
  const customMatches = useMemo(() => {
    const q = query.toLowerCase().replace(/^:/, '');
    return q ? Object.values(allCustom).flat().filter((e) => e.name.toLowerCase().includes(q)).slice(0, 40) : [];
  }, [allCustom, query]);
  const pick = (e: string) => {
    onSelect(e);
    onClose();
  };
  const pickCustom = (e: CustomEmoji) => {
    onSelect(`${e.name}:${e.id}`, e);
    onClose();
  };
  const customGrid = (list: CustomEmoji[]) => (
    <div className="grid grid-cols-8 gap-0.5">
      {list.map((e) => (
        <button
          key={e.id}
          type="button"
          aria-label={e.name}
          onMouseEnter={() => setHovered([`${e.name}:${e.id}`, e.name])}
          onClick={() => pickCustom(e)}
          className="flex size-10 items-center justify-center rounded hover:bg-hover"
        >
          <EmojiGlyph emoji={`${e.name}:${e.id}`} size={28} />
        </button>
      ))}
    </div>
  );
  return (
    <Popout anchor={anchor} placement={placement} align={align} onClose={onClose} className="flex h-[420px] w-[360px] max-w-[calc(100vw-16px)] flex-col overflow-hidden">
      <div className="p-2 pb-1">
        <div className="relative">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Finde das perfekte Emoji"
            aria-label="Emoji suchen"
            className="h-8 w-full rounded bg-input-strong pl-2 pr-8 text-sm text-text outline-none placeholder:text-icon-muted"
            onKeyDown={(e) => e.key === 'Enter' && results[0] && pick(results[0][0])}
          />
          <Search size={16} className="pointer-events-none absolute right-2 top-2 text-icon" />
        </div>
      </div>
      <div className="scroller-thin flex-1 px-2">
        {query ? (
          results.length || customMatches.length ? (
            <>
              {customMatches.length > 0 && customGrid(customMatches)}
              <Grid items={results} onSelect={pick} onHover={setHovered} />
            </>
          ) : (
            <p className="py-8 text-center text-sm text-muted">Keine Emojis gefunden</p>
          )
        ) : (
          <>
            {recent.length > 0 && (
              <section>
                <h4 className="sticky top-0 z-10 bg-floating py-1.5 text-xs font-semibold uppercase text-muted">Häufig verwendet</h4>
                <Grid items={recent.map((r) => lookup.get(r) ?? [r, r])} onSelect={pick} onHover={setHovered} />
              </section>
            )}
            {customGroups.map((g) => (
              <section key={g.name}>
                <h4 className="sticky top-0 z-10 bg-floating py-1.5 text-xs font-semibold uppercase text-muted">{g.name}</h4>
                {customGrid(g.list)}
              </section>
            ))}
            {EMOJI_CATEGORIES.map((c) => (
              <section key={c.name}>
                <h4 className="sticky top-0 z-10 bg-floating py-1.5 text-xs font-semibold uppercase text-muted">{c.name}</h4>
                <Grid items={c.emojis} onSelect={pick} onHover={setHovered} />
              </section>
            ))}
          </>
        )}
      </div>
      <div className="flex h-11 shrink-0 items-center gap-2 bg-sidebar px-3 text-sm text-header">
        {hovered && (
          <>
            <EmojiGlyph emoji={hovered[0]} size={24} />:{hovered[1]}:
          </>
        )}
      </div>
    </Popout>
  );
}
