import { useSyncExternalStore, type TouchEvent as ReactTouchEvent } from 'react';
import { create } from 'zustand';

/** Matches Tailwind's `max-md` variant (width < 48rem). */
const MOBILE_QUERY = '(max-width: 767.98px)';
const mobileMql = typeof window !== 'undefined' ? window.matchMedia(MOBILE_QUERY) : null;

export function isMobileViewport(): boolean {
  return !!mobileMql?.matches;
}

/** True when the viewport is phone-sized. Re-renders on resize/rotation. */
export function useIsMobile(): boolean {
  return useSyncExternalStore(
    (cb) => {
      mobileMql?.addEventListener('change', cb);
      return () => mobileMql?.removeEventListener('change', cb);
    },
    isMobileViewport,
    () => false,
  );
}

/** Devices without hover (phones, tablets): no tooltips, long-press opens menus. */
export const isTouchDevice = typeof window !== 'undefined' && window.matchMedia('(hover: none)').matches;

type Panel = 'nav' | 'chat';

interface MobileNavState {
  /** Which layer is in front on phones: server/channel list or the chat. */
  panel: Panel;
  membersOpen: boolean;
  show(panel: Panel): void;
  setMembersOpen(open: boolean): void;
}

const initialPanel: Panel = typeof location !== 'undefined' && /^\/channels\/\d+\/\d+/.test(location.pathname) ? 'chat' : 'nav';

export const useMobileNav = create<MobileNavState>()((set) => ({
  panel: initialPanel,
  membersOpen: false,
  show: (panel) => set({ panel, membersOpen: false }),
  setMembersOpen: (membersOpen) => set({ membersOpen }),
}));

export const showChat = () => useMobileNav.getState().show('chat');
export const showNav = () => useMobileNav.getState().show('nav');

/**
 * Long-press on touch devices dispatches a `contextmenu` event so every
 * right-click menu also works on phones. The click after a long press is
 * suppressed. Native long-press menus (Android) are respected.
 */
export function installLongPress() {
  if (!isTouchDevice) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let start = { x: 0, y: 0 };
  let fired = false;
  let touching = false;
  const cancel = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
  };
  document.addEventListener(
    'touchstart',
    (e) => {
      cancel();
      fired = false;
      if (e.touches.length !== 1) return;
      touching = true;
      const t = e.touches[0];
      start = { x: t.clientX, y: t.clientY };
      const target = e.target as Element;
      timer = setTimeout(() => {
        fired = true;
        target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: start.x, clientY: start.y }));
        navigator.vibrate?.(10);
      }, 500);
    },
    { passive: true },
  );
  document.addEventListener(
    'touchmove',
    (e) => {
      const t = e.touches[0];
      if (t && Math.hypot(t.clientX - start.x, t.clientY - start.y) > 10) cancel();
    },
    { passive: true },
  );
  document.addEventListener(
    'touchend',
    (e) => {
      touching = false;
      cancel();
      if (fired) e.preventDefault();
    },
    { passive: false },
  );
  document.addEventListener('touchcancel', () => {
    touching = false;
    cancel();
  });
  // The browser opened its own long-press menu event: don't fire a second one.
  document.addEventListener(
    'contextmenu',
    (e) => {
      if (e.isTrusted && touching) {
        cancel();
        fired = true;
      }
    },
    true,
  );
}

/** Horizontal swipe detection for the mobile panels. */
export function swipeHandlers(onLeft?: () => void, onRight?: () => void) {
  let x = 0;
  let y = 0;
  return {
    onTouchStart: (e: ReactTouchEvent) => {
      x = e.touches[0].clientX;
      y = e.touches[0].clientY;
    },
    onTouchEnd: (e: ReactTouchEvent) => {
      const t = e.changedTouches[0];
      const dx = t.clientX - x;
      const dy = t.clientY - y;
      if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      if (dx > 0) onRight?.();
      else onLeft?.();
    },
  };
}
