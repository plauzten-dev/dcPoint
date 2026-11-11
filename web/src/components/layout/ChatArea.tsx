import { useState } from 'react';
import { Bell, CircleHelp, Gift, Hash, Inbox, Menu, MessagesSquare, Pin, PlusCircle, Search, Smile, Sticker, Users } from 'lucide-react';
import type { Channel } from '../../api/types';
import { cn } from '../../lib/cn';
import { useChannelPermissions } from '../../lib/hooks';
import { has, P } from '../../lib/permissions';
import { openModal, toast } from '../../stores/overlay';
import { useUi } from '../../stores/ui';
import { showNav, useIsMobile, useMobileNav } from '../../lib/mobile';
import { Tooltip } from '../ui/Tooltip';

function HeaderIcon({ label, onClick, active, children, desktopOnly }: { label: string; onClick: () => void; active?: boolean; children: React.ReactNode; desktopOnly?: boolean }) {
  return (
    <Tooltip text={label} placement="bottom" className={desktopOnly ? 'max-md:hidden' : undefined}>
      <button aria-label={label} onClick={onClick} className={cn('flex p-1 transition-colors', active ? 'text-header' : 'text-icon hover:text-icon-hover')}>
        {children}
      </button>
    </Tooltip>
  );
}

export function ChannelHeader({ channel }: { channel: Channel }) {
  const memberListOpen = useUi((s) => s.memberListOpen);
  const toggleMembers = useUi((s) => s.toggleMemberList);
  const mobile = useIsMobile();
  const openMembers = useMobileNav((s) => s.setMembersOpen);
  const [query, setQuery] = useState('');
  return (
    <header className="relative z-[2] flex h-12 shrink-0 items-center gap-2 px-2 shadow-[0_1px_0_rgb(4_4_5/0.2),0_1.5px_0_rgb(6_6_7/0.05),0_2px_0_rgb(4_4_5/0.05)]">
      <div className="flex min-w-0 flex-1 items-center gap-2 pl-2 max-md:pl-0">
        <button aria-label="Kanäle anzeigen" onClick={showNav} className="flex p-1 text-icon md:hidden">
          <Menu size={24} />
        </button>
        <Hash size={24} className="shrink-0 text-icon-muted" />
        <h1 className="shrink-0 truncate text-base font-semibold text-header">{channel.name}</h1>
        {channel.topic && (
          <>
            <div className="mx-2 h-6 w-px shrink-0 bg-divider max-md:hidden" />
            <p className="truncate text-sm text-muted max-md:hidden" title={channel.topic}>
              {channel.topic}
            </p>
          </>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-3 pr-2">
        <HeaderIcon label="Threads" desktopOnly onClick={() => toast('Threads folgen in Phase 2.')}>
          <MessagesSquare size={22} />
        </HeaderIcon>
        <HeaderIcon label="Benachrichtigungseinstellungen" desktopOnly onClick={() => toast('Benachrichtigungen folgen in Phase 5.')}>
          <Bell size={22} />
        </HeaderIcon>
        <HeaderIcon label="Angepinnte Nachrichten" desktopOnly onClick={() => toast('Angepinnte Nachrichten folgen in Phase 2.')}>
          <Pin size={22} />
        </HeaderIcon>
        <HeaderIcon
          label={memberListOpen && !mobile ? 'Mitgliederliste ausblenden' : 'Mitgliederliste anzeigen'}
          onClick={mobile ? () => openMembers(true) : toggleMembers}
          active={memberListOpen && !mobile}
        >
          <Users size={22} />
        </HeaderIcon>
        <form
          className="relative max-md:hidden"
          onSubmit={(e) => {
            e.preventDefault();
            toast('Die Suche folgt in Phase 5.');
          }}
        >
          <input
            aria-label="Suchen"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Suchen"
            className="h-6 w-36 rounded bg-input-strong pl-1.5 pr-6 text-sm text-text outline-none transition-[width] duration-200 placeholder:text-muted focus:w-60"
          />
          <Search size={16} className="pointer-events-none absolute right-1.5 top-1 text-muted" />
        </form>
        <HeaderIcon label="Posteingang" desktopOnly onClick={() => toast('Der Posteingang folgt in Phase 2.')}>
          <Inbox size={22} />
        </HeaderIcon>
        <HeaderIcon label="Tastaturkürzel" desktopOnly onClick={() => openModal({ type: 'userSettings', section: 'keybinds' })}>
          <CircleHelp size={22} />
        </HeaderIcon>
      </div>
    </header>
  );
}

export function ChatArea({ channel }: { channel: Channel }) {
  const perms = useChannelPermissions(channel);
  const canSend = has(perms, P.SEND_MESSAGES);
  const canManage = has(perms, P.MANAGE_CHANNELS);
  const [draft, setDraft] = useState('');

  return (
    <main className="flex min-w-0 flex-1 flex-col bg-chat">
      <ChannelHeader channel={channel} />
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="scroller-auto flex flex-1 flex-col justify-end">
            <div className="m-4 mb-6 max-md:mx-3" data-testid="channel-welcome">
              <div className="mb-2 flex size-[68px] items-center justify-center rounded-full bg-[#4e5058] text-white">
                <Hash size={42} />
              </div>
              <h2 className="my-2 break-words text-[32px] font-bold leading-10 text-header max-md:text-2xl max-md:leading-8">Willkommen in #{channel.name}!</h2>
              <p className="text-base text-muted">Dies ist der Anfang des Kanals #{channel.name}.</p>
              {canManage && (
                <button onClick={() => openModal({ type: 'channelSettings', channelId: channel.id })} className="mt-3 text-sm font-medium text-link hover:underline">
                  Kanal bearbeiten
                </button>
              )}
            </div>
          </div>
          <form
            className="shrink-0 px-4 pb-6 max-md:px-2 max-md:pb-[max(8px,env(safe-area-inset-bottom))]"
            onSubmit={(e) => {
              e.preventDefault();
              if (draft.trim()) toast('Echtzeit-Nachrichten werden in Phase 2 freigeschaltet.');
            }}
          >
            <div className={cn('flex min-h-11 items-center rounded-lg bg-input', !canSend && 'opacity-60')}>
              <button type="button" aria-label="Datei hochladen" disabled={!canSend} className="px-4 text-icon hover:text-icon-hover">
                <PlusCircle size={22} />
              </button>
              <input
                aria-label={`Nachricht an #${channel.name}`}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                disabled={!canSend}
                placeholder={canSend ? `Nachricht an #${channel.name}` : 'Du hast keine Berechtigung, in diesem Kanal Nachrichten zu senden.'}
                className="h-11 min-w-0 flex-1 bg-transparent text-base text-text outline-none placeholder:text-icon-muted"
              />
              <div className="flex items-center gap-3 px-3 text-icon max-md:hidden">
                <Gift size={22} className="hover:text-icon-hover" />
                <Sticker size={22} className="hover:text-icon-hover" />
                <Smile size={22} className="hover:text-icon-hover" />
              </div>
            </div>
          </form>
        </div>
      </div>
    </main>
  );
}

/** Shown when a guild has no visible text channel. */
export function NoChannel() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center bg-chat p-8 text-center">
      <svg width="220" height="140" viewBox="0 0 220 140" aria-hidden className="mb-6 text-icon-muted">
        <rect x="20" y="30" width="180" height="90" rx="14" fill="currentColor" opacity="0.15" />
        <rect x="40" y="52" width="80" height="10" rx="5" fill="currentColor" opacity="0.4" />
        <rect x="40" y="72" width="130" height="10" rx="5" fill="currentColor" opacity="0.25" />
        <rect x="40" y="92" width="100" height="10" rx="5" fill="currentColor" opacity="0.25" />
      </svg>
      <h2 className="text-lg font-semibold text-header">Keine Textkanäle</h2>
      <p className="mt-2 max-w-sm text-sm text-muted">Hier gibt es noch nichts zu lesen: Entweder hat dieser Server keine Textkanäle oder dir fehlt der Zugriff darauf.</p>
    </main>
  );
}
