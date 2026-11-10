import { CircleAlert, CircleCheck, Info } from 'lucide-react';
import { cn } from '../../lib/cn';
import { useOverlay } from '../../stores/overlay';

export function Toasts() {
  const toasts = useOverlay((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed bottom-6 left-1/2 z-[300] flex -translate-x-1/2 flex-col items-center gap-2" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn('flex animate-popout-in items-center gap-2 rounded-lg bg-floating px-4 py-2.5 text-sm font-medium text-header shadow-elevation')}
        >
          {t.kind === 'error' ? <CircleAlert size={18} className="text-dnd" /> : t.kind === 'success' ? <CircleCheck size={18} className="text-online" /> : <Info size={18} className="text-link" />}
          {t.text}
        </div>
      ))}
    </div>
  );
}
