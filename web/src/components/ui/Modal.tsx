import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/cn';

interface ModalProps {
  onClose: () => void;
  children: ReactNode;
  className?: string;
  labelledBy?: string;
  /** Local (non-stack) modals handle Escape themselves. */
  nested?: boolean;
}

/** Centered dialog with backdrop; Escape is handled by the global modal stack unless `nested`. */
export function Modal({ onClose, children, className, labelledBy, nested }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!nested) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [nested, onClose]);
  useEffect(() => {
    const el = ref.current;
    const focusable = el?.querySelector<HTMLElement>('[data-autofocus], input, textarea, button:not([data-close])');
    focusable?.focus();
  }, []);
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 animate-fade-in bg-black/70" onMouseDown={onClose} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className={cn('relative max-h-[calc(100vh-40px)] w-[440px] max-w-[calc(100vw-32px)] animate-modal-in overflow-hidden rounded-lg bg-chat text-text shadow-elevation', className)}
      >
        {children}
      </div>
    </div>
  );
}

export function ModalHeader({ title, subtitle, onClose, id, center }: { title: ReactNode; subtitle?: ReactNode; onClose?: () => void; id?: string; center?: boolean }) {
  return (
    <div className={cn('relative px-4 pt-4', center ? 'pb-0 text-center' : 'pb-3')}>
      <h2 id={id} className={cn('font-bold text-header', center ? 'text-2xl' : 'text-xl')}>
        {title}
      </h2>
      {subtitle && <div className="mt-2 text-[15px] text-header-2">{subtitle}</div>}
      {onClose && (
        <button data-close aria-label="Schließen" onClick={onClose} className="absolute right-3 top-3 rounded p-1 text-icon hover:text-icon-hover">
          <X size={24} />
        </button>
      )}
    </div>
  );
}

export function ModalBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('scroller-thin max-h-[60vh] px-4 pb-5', className)}>{children}</div>;
}

export function ModalFooter({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex items-center justify-end gap-2 bg-sidebar p-4', className)}>{children}</div>;
}
