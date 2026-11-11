import { useEffect, useRef, useState, type DragEvent } from 'react';
import { Bell, CircleHelp, Hash, Inbox, Menu, MessagesSquare, Pin, Search, Upload, Users } from 'lucide-react';
import type { Channel } from '../../api/types';
import { cn } from '../../lib/cn';
import { useChannelPermissions } from '../../lib/hooks';
import { has, P } from '../../lib/permissions';
import { openModal, toast } from '../../stores/overlay';
import { useUi } from '../../stores/ui';
import { showNav, useIsMobile, useMobileNav } from '../../lib/mobile';
import { Tooltip } from '../ui/Tooltip';
import { useChatUi } from '../../stores/chatUi';
import { useMemberInfo } from '../chat/actions';
import { addDraftFiles, Composer, TypingIndicator } from '../chat/Composer';
import { MessageList } from '../chat/MessageList';
import { PinsPopout } from '../chat/PinsPopout';

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
  const [pinsAnchor, setPinsAnchor] = useState<DOMRect | null>(null);
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
        <HeaderIcon label="Threads" desktopOnly onClick={() => toast('Threads folgen im nächsten Schritt von Phase 2.')}>
          <MessagesSquare size={22} />
        </HeaderIcon>
        <HeaderIcon label="Benachrichtigungseinstellungen" desktopOnly onClick={() => toast('Benachrichtigungen folgen in Phase 5.')}>
          <Bell size={22} />
        </HeaderIcon>
        <HeaderIcon
          label="Angepinnte Nachrichten"
          active={!!pinsAnchor}
          onClick={() => setPinsAnchor(pinsAnchor ? null : document.querySelector('[aria-label="Angepinnte Nachrichten"]')!.getBoundingClientRect())}
        >
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
        <HeaderIcon label="Posteingang" desktopOnly onClick={() => toast('Der Posteingang mit allen Erwähnungen folgt mit den Benachrichtigungen (Phase 5).')}>
          <Inbox size={22} />
        </HeaderIcon>
        <HeaderIcon label="Tastaturkürzel" desktopOnly onClick={() => openModal({ type: 'userSettings', section: 'keybinds' })}>
          <CircleHelp size={22} />
        </HeaderIcon>
      </div>
      {pinsAnchor && <PinsPopout channelId={channel.id} guildId={channel.guild_id} anchor={pinsAnchor} onClose={() => setPinsAnchor(null)} />}
    </header>
  );
}

export function ChatArea({ channel }: { channel: Channel }) {
  const perms = useChannelPermissions(channel);
  const info = useMemberInfo(channel.guild_id);
  const canAttach = has(perms, P.SEND_MESSAGES | P.ATTACH_FILES);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);

  useEffect(() => () => useChatUi.getState().reset(), [channel.id]);

  const hasFiles = (e: DragEvent) => e.dataTransfer.types.includes('Files');
  return (
    <main
      className="relative flex min-w-0 flex-1 flex-col bg-chat"
      onDragEnter={(e) => {
        if (!hasFiles(e) || !canAttach) return;
        dragDepth.current++;
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!hasFiles(e)) return;
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragging(false);
      }}
      onDragOver={(e) => hasFiles(e) && canAttach && e.preventDefault()}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        if (canAttach && e.dataTransfer.files.length) addDraftFiles(channel.id, e.dataTransfer.files);
      }}
    >
      <ChannelHeader channel={channel} />
      <MessageList channel={channel} perms={perms} />
      <Composer channel={channel} perms={perms} info={info} />
      <div className="max-md:pb-[env(safe-area-inset-bottom)]">
        <TypingIndicator channelId={channel.id} info={info} />
      </div>
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-black/60 p-8">
          <div className="rounded-xl bg-brand p-2 shadow-elevation">
            <div className="rounded-lg border-2 border-dashed border-white/60 px-10 py-8 text-center text-white">
              <Upload size={40} className="mx-auto mb-3" />
              <div className="text-xl font-bold">Hochladen nach #{channel.name}</div>
              <div className="mt-1 text-sm opacity-90">Du kannst bis zu 10 Dateien auf einmal hinzufügen.</div>
            </div>
          </div>
        </div>
      )}
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
