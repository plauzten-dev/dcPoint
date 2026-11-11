import { memo, useState } from 'react';
import { Download, FileText } from 'lucide-react';
import { API_BASE } from '../../api/client';
import type { Attachment } from '../../api/types';
import { cn } from '../../lib/cn';
import { formatBytes } from '../../lib/time';

const MAX_W = 400;
const MAX_H = 300;

function fit(a: Attachment): { width: number; height: number } {
  if (!a.width || !a.height) return { width: MAX_W, height: MAX_H };
  const scale = Math.min(1, MAX_W / a.width, MAX_H / a.height);
  return { width: Math.round(a.width * scale), height: Math.round(a.height * scale) };
}

function SpoilerCover({ onReveal }: { onReveal: () => void }) {
  return (
    <button onClick={onReveal} className="absolute inset-0 z-10 flex items-center justify-center backdrop-blur-2xl">
      <span className="rounded-full bg-black/60 px-3 py-1.5 text-sm font-bold uppercase tracking-wide text-white">Spoiler</span>
    </button>
  );
}

const ImageAttachment = memo(function ImageAttachment({ a, onOpen }: { a: Attachment; onOpen: (a: Attachment) => void }) {
  const [revealed, setRevealed] = useState(!a.spoiler);
  const size = fit(a);
  const url = `${API_BASE}${a.url}`;
  return (
    <div className="relative max-w-full overflow-hidden rounded-lg bg-sidebar" style={{ width: size.width, aspectRatio: `${size.width} / ${size.height}` }}>
      {!revealed && <SpoilerCover onReveal={() => setRevealed(true)} />}
      {a.url ? (
        <img
          src={url}
          alt={a.filename}
          loading="lazy"
          decoding="async"
          onClick={() => revealed && onOpen(a)}
          className={cn('size-full cursor-pointer object-cover', !revealed && 'blur-2xl')}
        />
      ) : (
        <div className="size-full animate-pulse bg-hover" />
      )}
    </div>
  );
});

function FileCard({ a }: { a: Attachment }) {
  return (
    <div className="flex w-[min(432px,100%)] items-center gap-3 rounded-lg border border-divider bg-sidebar p-3">
      <FileText size={36} className="shrink-0 text-brand" />
      <div className="min-w-0 flex-1">
        {a.url ? (
          <a href={`${API_BASE}${a.url}`} className="block truncate text-base text-link hover:underline" download={a.filename}>
            {a.filename}
          </a>
        ) : (
          <span className="block truncate text-base text-text">{a.filename}</span>
        )}
        <span className="text-xs text-muted">{formatBytes(a.size)}</span>
      </div>
      {a.url && (
        <a href={`${API_BASE}${a.url}`} download={a.filename} aria-label="Herunterladen" className="text-icon hover:text-icon-hover">
          <Download size={22} />
        </a>
      )}
    </div>
  );
}

export const Attachments = memo(function Attachments({ items, onOpenImage }: { items: Attachment[]; onOpenImage: (a: Attachment) => void }) {
  if (!items.length) return null;
  return (
    <div className="mt-1 flex flex-col items-start gap-1.5">
      {items.map((a) => {
        const type = a.content_type;
        if (/^image\/(png|jpeg|gif|webp)$/.test(type)) return <ImageAttachment key={a.id} a={a} onOpen={onOpenImage} />;
        if (/^video\/(mp4|webm)$/.test(type) && a.url)
          return <video key={a.id} src={`${API_BASE}${a.url}`} controls preload="metadata" className="max-h-[300px] max-w-[min(400px,100%)] rounded-lg bg-black" />;
        if (/^audio\//.test(type) && a.url)
          return (
            <div key={a.id} className="w-[min(400px,100%)] rounded-lg border border-divider bg-sidebar p-3">
              <div className="mb-2 truncate text-sm text-text">{a.filename}</div>
              <audio src={`${API_BASE}${a.url}`} controls preload="none" className="w-full" />
            </div>
          );
        return <FileCard key={a.id} a={a} />;
      })}
    </div>
  );
});

/** Fullscreen image viewer. */
export function ImageViewer({ attachment, onClose }: { attachment: Attachment; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[120] flex animate-fade-in flex-col items-center justify-center bg-black/85 p-6" onClick={onClose} role="dialog" aria-label={attachment.filename}>
      <img src={`${API_BASE}${attachment.url}`} alt={attachment.filename} className="max-h-[85vh] max-w-full animate-modal-in rounded object-contain" onClick={(e) => e.stopPropagation()} />
      <a href={`${API_BASE}${attachment.url}`} target="_blank" rel="noopener noreferrer" className="mt-3 text-sm text-white/80 hover:underline" onClick={(e) => e.stopPropagation()}>
        Original öffnen
      </a>
    </div>
  );
}
