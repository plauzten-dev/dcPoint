import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/cn';

type Placement = 'right' | 'top' | 'bottom' | 'left';

interface Props {
  text: ReactNode;
  placement?: Placement;
  children: ReactNode;
  className?: string;
  /** Large variant used by the server rail. */
  large?: boolean;
  disabled?: boolean;
}

export function Tooltip({ text, placement = 'top', children, className, large, disabled }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  return (
    <div
      ref={ref}
      className={className}
      onMouseEnter={() => !disabled && setRect(ref.current!.getBoundingClientRect())}
      onMouseLeave={() => setRect(null)}
      onMouseDown={() => setRect(null)}
    >
      {children}
      {rect && text && createPortal(<TooltipBubble rect={rect} placement={placement} large={large}>{text}</TooltipBubble>, document.body)}
    </div>
  );
}

function TooltipBubble({ rect, placement, large, children }: { rect: DOMRect; placement: Placement; large?: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current!;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const gap = 8;
    let left = 0;
    let top = 0;
    if (placement === 'right') {
      left = rect.right + gap;
      top = rect.top + rect.height / 2 - h / 2;
    } else if (placement === 'left') {
      left = rect.left - w - gap;
      top = rect.top + rect.height / 2 - h / 2;
    } else if (placement === 'top') {
      left = rect.left + rect.width / 2 - w / 2;
      top = rect.top - h - gap;
    } else {
      left = rect.left + rect.width / 2 - w / 2;
      top = rect.bottom + gap;
    }
    setPos({ left: Math.max(8, Math.min(left, window.innerWidth - w - 8)), top: Math.max(8, top) });
  }, [rect, placement]);
  const arrow = {
    right: 'left-[-4px] top-1/2 -translate-y-1/2',
    left: 'right-[-4px] top-1/2 -translate-y-1/2',
    top: 'bottom-[-4px] left-1/2 -translate-x-1/2',
    bottom: 'top-[-4px] left-1/2 -translate-x-1/2',
  }[placement];
  return (
    <div
      ref={ref}
      role="tooltip"
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}
      className={cn(
        'pointer-events-none fixed z-[1000] max-w-[190px] rounded-[5px] bg-floating text-header shadow-elevation',
        large ? 'px-3 py-2 text-base font-semibold' : 'px-2 py-1.5 text-sm font-medium',
        pos && 'animate-fade-in',
      )}
    >
      <span className={cn('absolute size-2 rotate-45 bg-floating', arrow)} />
      <div className="relative break-words">{children}</div>
    </div>
  );
}
