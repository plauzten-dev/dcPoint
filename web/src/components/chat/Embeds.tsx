import { memo } from 'react';
import { API_BASE } from '../../api/client';
import type { Embed } from '../../api/types';

function EmbedCard({ e }: { e: Embed }) {
  const image = e.image ? `${API_BASE}${e.image.url}` : null;
  if (e.type === 'image' && image) {
    return (
      <a href={e.url} target="_blank" rel="noopener noreferrer" className="block max-w-[400px]">
        <img src={image} alt="" loading="lazy" className="max-h-[300px] max-w-full rounded-lg object-contain" />
      </a>
    );
  }
  return (
    <article
      className="flex max-w-[432px] gap-4 rounded border-l-4 bg-sidebar p-3 pr-4"
      style={{ borderLeftColor: e.color ?? 'var(--rail)' }}
      aria-label={e.title ?? e.url}
    >
      <div className="min-w-0 flex-1">
        {e.site_name && <div className="mb-1 truncate text-xs text-muted">{e.site_name}</div>}
        {e.title && (
          <a href={e.url} target="_blank" rel="noopener noreferrer" className="mb-1 block font-semibold text-link hover:underline">
            {e.title}
          </a>
        )}
        {e.description && <p className="whitespace-pre-line break-words text-sm text-text">{e.description}</p>}
        {image && e.large && <img src={image} alt="" loading="lazy" className="mt-3 max-h-[300px] max-w-full rounded object-cover" />}
      </div>
      {image && !e.large && <img src={image} alt="" loading="lazy" className="size-20 shrink-0 rounded object-cover" />}
    </article>
  );
}

export const Embeds = memo(function Embeds({ items }: { items: Embed[] }) {
  if (!items?.length) return null;
  return (
    <div className="mt-1 flex flex-col gap-1.5">
      {items.map((e, i) => (
        <EmbedCard key={`${e.url}-${i}`} e={e} />
      ))}
    </div>
  );
});
