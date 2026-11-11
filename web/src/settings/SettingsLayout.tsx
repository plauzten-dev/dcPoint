import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useIsMobile } from '../lib/mobile';
import { cn } from '../lib/cn';
import { Button } from '../components/ui/Button';

export interface NavEntry {
  id: string;
  label: string;
  danger?: boolean;
  header?: boolean;
  separator?: boolean;
  onClick?: () => void;
}

interface Props {
  nav: NavEntry[];
  active: string;
  onSelect: (id: string) => void;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** Phones: open directly on the content instead of the section list. */
  mobileStartInContent?: boolean;
}

/** Fullscreen settings layer: sidebar navigation left, content right, ESC button. */
export function SettingsLayout({ nav, active, onSelect, onClose, children, footer, mobileStartInContent }: Props) {
  const contentRef = useRef<HTMLDivElement>(null);
  const mobile = useIsMobile();
  const [mobileView, setMobileView] = useState<'menu' | 'content'>(mobileStartInContent ? 'content' : 'menu');
  useEffect(() => {
    contentRef.current?.scrollTo(0, 0);
  }, [active, mobileView]);

  if (mobile) {
    const current = nav.find((n) => n.id === active && !n.header && !n.separator);
    const inContent = mobileView === 'content';
    return (
      <div className="fixed inset-0 z-[100] flex animate-settings-in flex-col bg-chat" role="dialog" aria-modal="true" aria-label="Einstellungen">
        <header className="flex h-12 shrink-0 items-center gap-1 border-b border-divider bg-sidebar px-1">
          {inContent && (
            <button aria-label="Zurück" onClick={() => setMobileView('menu')} className="flex p-2 text-icon">
              <ChevronLeft size={24} />
            </button>
          )}
          <h2 className={cn('flex-1 truncate text-base font-semibold text-header', !inContent && 'pl-3')}>{inContent ? current?.label : 'Einstellungen'}</h2>
          <button aria-label="Schließen" onClick={onClose} className="flex p-2 text-icon">
            <X size={24} />
          </button>
        </header>
        {inContent ? (
          <div ref={contentRef} className="scroller-auto flex-1 px-4 pb-[max(40px,env(safe-area-inset-bottom))] pt-5">
            {children}
          </div>
        ) : (
          <nav className="scroller-auto flex-1 bg-sidebar px-3 pb-[max(24px,env(safe-area-inset-bottom))] pt-3">
            {nav.map((n) =>
              n.separator ? (
                <div key={n.id} className="mx-2 my-3 h-px bg-divider" />
              ) : n.header ? (
                <h3 key={n.id} className="px-2 pb-2 pt-3 text-xs font-bold uppercase tracking-wide text-muted">
                  {n.label}
                </h3>
              ) : (
                <button
                  key={n.id}
                  onClick={() => {
                    if (n.onClick) n.onClick();
                    else {
                      onSelect(n.id);
                      setMobileView('content');
                    }
                  }}
                  className={cn('flex h-12 w-full items-center justify-between rounded-lg px-3 text-left text-base font-medium active:bg-hover', n.danger ? 'text-[#f23f43]' : 'text-header')}
                >
                  {n.label}
                  {!n.danger && <ChevronRight size={20} className="text-icon-muted" />}
                </button>
              ),
            )}
            {footer && <div className="px-3 pt-4 text-xs text-muted">{footer}</div>}
          </nav>
        )}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[100] flex animate-settings-in bg-chat" role="dialog" aria-modal="true" aria-label="Einstellungen">
      <div className="scroller-thin flex flex-[1_0_218px] justify-end bg-sidebar">
        <nav className="w-[218px] px-1.5 py-[60px] pl-5">
          {nav.map((n) =>
            n.separator ? (
              <div key={n.id} className="mx-2.5 my-2 h-px bg-divider" />
            ) : n.header ? (
              <h3 key={n.id} className="px-2.5 pb-1.5 pt-1.5 text-xs font-bold uppercase tracking-wide text-muted">
                {n.label}
              </h3>
            ) : (
              <button
                key={n.id}
                onClick={() => (n.onClick ? n.onClick() : onSelect(n.id))}
                aria-current={active === n.id ? 'page' : undefined}
                className={cn(
                  'mb-0.5 flex h-8 w-full items-center rounded px-2.5 text-left text-base font-medium',
                  n.danger ? 'text-[#f23f43] hover:bg-hover' : active === n.id ? 'bg-selected text-header' : 'text-muted hover:bg-hover hover:text-header-2',
                )}
              >
                {n.label}
              </button>
            ),
          )}
          {footer && <div className="px-2.5 pt-2 text-xs text-muted">{footer}</div>}
        </nav>
      </div>
      <div className="flex flex-[1_1_800px] items-start bg-chat">
        <div ref={contentRef} className="scroller-auto h-full max-w-[740px] flex-1 px-10 pb-20 pt-[60px]">
          {children}
        </div>
        <div className="shrink-0 pr-5 pt-[60px]">
          <button onClick={onClose} aria-label="Schließen" className="group flex flex-col items-center gap-2">
            <span className="flex size-9 items-center justify-center rounded-full border-2 border-icon text-icon group-hover:border-icon-hover group-hover:bg-hover group-hover:text-icon-hover">
              <X size={18} />
            </span>
            <span className="text-[13px] font-semibold text-icon">ESC</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="mb-5 text-xl font-semibold text-header">{children}</h2>;
}

/** Sticky "unsaved changes" bar like the original. */
export function SaveBar({ visible, busy, onReset, onSave, error }: { visible: boolean; busy?: boolean; onReset: () => void; onSave: () => void; error?: string | null }) {
  return (
    <div
      className={cn(
        'pointer-events-none sticky bottom-5 mt-10 transition-[transform,opacity,visibility] duration-200',
        visible ? 'visible translate-y-0 opacity-100' : 'invisible translate-y-[120%] opacity-0',
      )}
    >
      <div className="pointer-events-auto flex items-center gap-3 rounded-[5px] bg-floating p-2.5 pl-4 shadow-elevation">
        <span className={cn('flex-1 text-base font-medium', error ? 'text-[#fa777c]' : 'text-text')}>{error ?? 'Achtung – du hast ungespeicherte Änderungen!'}</span>
        <Button variant="link" size="sm" onClick={onReset}>
          Zurücksetzen
        </Button>
        <Button variant="success" size="sm" loading={busy} onClick={onSave}>
          Änderungen speichern
        </Button>
      </div>
    </div>
  );
}

export function Row({ label, value, action }: { label: string; value: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <div className="min-w-0">
        <div className="text-xs font-bold uppercase tracking-wide text-header-2">{label}</div>
        <div className="truncate text-base text-text">{value}</div>
      </div>
      {action}
    </div>
  );
}
