import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { swipeHandlers, useMobileNav } from '../../lib/mobile';

interface Props {
  /** Server rail + channel list. */
  nav: ReactNode;
  /** Chat (or friends) view. */
  chat: ReactNode;
  /** Member list shown as a right-hand drawer. */
  members?: ReactNode;
}

/**
 * Phone layout: the chat slides over the navigation from the right, leaving a
 * thin strip visible to tap back. Swipe right to reveal the navigation, swipe
 * left to return to the chat.
 */
export function MobileShell({ nav, chat, members }: Props) {
  const panel = useMobileNav((s) => s.panel);
  const show = useMobileNav((s) => s.show);
  const membersOpen = useMobileNav((s) => s.membersOpen);
  const setMembersOpen = useMobileNav((s) => s.setMembersOpen);
  const navOpen = panel === 'nav';

  return (
    <div className="relative min-w-0 flex-1 overflow-hidden">
      <div className="absolute inset-0 isolate flex pr-12" inert={!navOpen} {...swipeHandlers(() => show('chat'))}>
        {nav}
      </div>
      <div
        className={cn(
          'absolute inset-0 z-10 isolate flex flex-col bg-chat shadow-[-8px_0_24px_rgb(0_0_0/0.35)] transition-transform duration-300 ease-out will-change-transform',
          navOpen ? 'translate-x-[calc(100%-48px)]' : 'translate-x-0',
        )}
        {...swipeHandlers(members ? () => setMembersOpen(true) : undefined, () => show('nav'))}
      >
        <div className="flex min-h-0 flex-1 flex-col" inert={navOpen}>
          {chat}
        </div>
        {navOpen && <button aria-label="Zurück zum Chat" className="absolute inset-0 z-20" onClick={() => show('chat')} />}
      </div>
      {members && (
        <div className={cn('fixed inset-0 z-40', !membersOpen && 'pointer-events-none')} inert={!membersOpen}>
          <div
            className={cn('absolute inset-0 bg-black/60 transition-opacity duration-300', membersOpen ? 'opacity-100' : 'opacity-0')}
            onClick={() => setMembersOpen(false)}
          />
          <div
            className={cn(
              'absolute inset-y-0 right-0 flex w-[85%] max-w-[320px] transition-transform duration-300 ease-out',
              membersOpen ? 'translate-x-0' : 'translate-x-full',
            )}
            {...swipeHandlers(undefined, () => setMembersOpen(false))}
          >
            {membersOpen && members}
          </div>
        </div>
      )}
    </div>
  );
}
