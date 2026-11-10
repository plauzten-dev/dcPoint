import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/cn';

type Placement = 'right' | 'left' | 'top' | 'bottom';

interface Props {
  anchor: DOMRect;
  placement?: Placement;
  align?: 'start' | 'end' | 'center';
  onClose: () => void;
  children: ReactNode;
  className?: string;
}

/** Floating panel anchored to an element rect; closes on outside click and Escape. */
export function Popout({ anchor, placement = 'right', align = 'start', onClose, children, className }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current!;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const gap = 8;
    let left: number;
    let top: number;
    if (placement === 'right' || placement === 'left') {
      left = placement === 'right' ? anchor.right + gap : anchor.left - w - gap;
      top = align === 'end' ? anchor.bottom - h : align === 'center' ? anchor.top + anchor.height / 2 - h / 2 : anchor.top;
    } else {
      top = placement === 'bottom' ? anchor.bottom + gap : anchor.top - h - gap;
      left = align === 'end' ? anchor.right - w : align === 'center' ? anchor.left + anchor.width / 2 - w / 2 : anchor.left;
    }
    setPos({
      left: Math.max(8, Math.min(left, window.innerWidth - w - 8)),
      top: Math.max(8, Math.min(top, window.innerHeight - h - 8)),
    });
  }, [anchor, placement, align]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}
      className={cn('fixed z-[90] rounded-lg bg-floating shadow-elevation', pos && 'animate-popout-in', className)}
    >
      {children}
    </div>,
    document.body,
  );
}
