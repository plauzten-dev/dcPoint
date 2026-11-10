import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { cn } from '../../lib/cn';
import { useOverlay, type MenuEntry } from '../../stores/overlay';

/** Renders the single global context menu. */
export function ContextMenuHost() {
  const menu = useOverlay((s) => s.menu);
  const close = useOverlay((s) => s.closeMenu);
  if (!menu) return null;
  return <Menu x={menu.x} y={menu.y} items={menu.items} onClose={close} />;
}

export function Menu({ x, y, items, onClose }: { x: number; y: number; items: MenuEntry[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y, ready: false });
  const [active, setActive] = useState(-1);
  const actionable = items.map((it, i) => ('separator' in it && it.separator ? -1 : it.disabled ? -1 : i)).filter((i) => i >= 0);

  useLayoutEffect(() => {
    const el = ref.current!;
    const left = x + el.offsetWidth > window.innerWidth - 8 ? x - el.offsetWidth : x;
    const top = y + el.offsetHeight > window.innerHeight - 8 ? Math.max(8, window.innerHeight - el.offsetHeight - 8) : y;
    setPos({ left, top, ready: true });
    el.focus();
  }, [x, y]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', onClose);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', onClose);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  const run = (it: MenuEntry) => {
    if ('separator' in it && it.separator) return;
    if (it.disabled) return;
    onClose();
    it.onClick?.();
  };

  return (
    <div
      ref={ref}
      role="menu"
      tabIndex={-1}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          const idx = actionable.indexOf(active);
          const next = e.key === 'ArrowDown' ? actionable[(idx + 1) % actionable.length] : actionable[(idx - 1 + actionable.length) % actionable.length];
          setActive(next ?? -1);
        } else if (e.key === 'Enter' && active >= 0) {
          run(items[active]);
        }
      }}
      style={{ left: pos.left, top: pos.top, visibility: pos.ready ? 'visible' : 'hidden' }}
      className="fixed z-[200] min-w-[188px] max-w-[320px] rounded-[4px] bg-floating px-2 py-1.5 shadow-elevation outline-none"
    >
      {items.map((it, i) =>
        'separator' in it && it.separator ? (
          <div key={i} className="mx-1 my-1 h-px bg-divider" />
        ) : (
          <button
            key={i}
            role="menuitem"
            disabled={it.disabled}
            onMouseEnter={() => setActive(i)}
            onMouseLeave={() => setActive(-1)}
            onClick={() => run(it)}
            className={cn(
              'my-0.5 flex min-h-8 w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-sm font-medium',
              it.disabled && 'opacity-50',
              it.danger ? 'text-[#f23f43]' : 'text-header-2',
              active === i && !it.disabled && (it.danger ? 'bg-danger text-white' : 'bg-brand text-white'),
            )}
          >
            <span className="truncate">{it.label}</span>
            {it.checked !== undefined ? (
              <span className={cn('flex size-[18px] items-center justify-center rounded-[3px] border', it.checked ? 'border-brand bg-brand text-white' : 'border-current')}>
                {it.checked && <Check size={14} strokeWidth={3} />}
              </span>
            ) : (
              (it.icon || it.hint) && <span className="flex shrink-0 items-center text-xs opacity-80">{it.icon ?? it.hint}</span>
            )}
          </button>
        ),
      )}
    </div>
  );
}
