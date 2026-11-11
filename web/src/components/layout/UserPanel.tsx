import { useState } from 'react';
import { Headphones, HeadphoneOff, Mic, MicOff, Pencil, Settings, SmilePlus, X } from 'lucide-react';
import { http } from '../../api/client';
import type { PrivateUser, Status } from '../../api/types';
import { reportError } from '../../lib/actions';
import { displayName } from '../../lib/cdn';
import { cn } from '../../lib/cn';
import { useData } from '../../stores/data';
import { openModal } from '../../stores/overlay';
import { useUi } from '../../stores/ui';
import { Avatar, StatusIcon, statusLabel } from '../ui/Avatar';
import { Popout } from '../ui/Popout';
import { Tooltip } from '../ui/Tooltip';
import { ProfileCard } from '../ProfileCard';

export async function setStatus(status: Exclude<Status, 'offline'>) {
  try {
    useData.getState().setMe(await http.patch<PrivateUser>('/users/@me/settings', { status }));
  } catch (e) {
    reportError(e);
  }
}

export async function clearCustomStatus() {
  try {
    useData.getState().setMe(await http.patch<PrivateUser>('/users/@me/settings', { custom_status: null }));
  } catch (e) {
    reportError(e);
  }
}

const STATUS_OPTIONS: Array<{ status: Exclude<Status, 'offline'>; hint?: string }> = [
  { status: 'online' },
  { status: 'idle' },
  { status: 'dnd', hint: 'Du erhältst keine Desktop-Benachrichtigungen.' },
  { status: 'invisible', hint: 'Du wirst als offline angezeigt, hast aber vollen Zugriff auf dcPoint.' },
];

function StatusPopout({ me, anchor, onClose }: { me: PrivateUser; anchor: DOMRect; onClose: () => void }) {
  return (
    <Popout anchor={anchor} placement="top" onClose={onClose} className="w-[300px] overflow-hidden">
      <ProfileCard user={me} status={me.status} customStatus={me.custom_status} compact />
      <div className="mx-3 mb-3 rounded-lg bg-sidebar p-2">
        {STATUS_OPTIONS.map((o) => (
          <button
            key={o.status}
            onClick={() => {
              onClose();
              void setStatus(o.status);
            }}
            className={cn('group flex w-full items-start gap-3 rounded px-2 py-1.5 text-left hover:bg-brand hover:text-white', me.status === o.status && 'bg-hover')}
          >
            <span className="mt-1">
              <StatusIcon status={o.status} size={12} />
            </span>
            <span className="flex flex-col">
              <span className="text-sm font-medium text-header-2 group-hover:text-white">{statusLabel[o.status]}</span>
              {o.hint && <span className="text-xs text-muted group-hover:text-white/90">{o.hint}</span>}
            </span>
          </button>
        ))}
        <div className="my-1 h-px bg-divider" />
        <div className="group flex items-center rounded hover:bg-brand">
          <button
            onClick={() => {
              onClose();
              openModal({ type: 'customStatus' });
            }}
            className="flex flex-1 items-center gap-3 px-2 py-1.5 text-left text-sm font-medium text-header-2 group-hover:text-white"
          >
            {me.custom_status ? <Pencil size={14} /> : <SmilePlus size={14} />}
            {me.custom_status ? 'Benutzerdefinierten Status bearbeiten' : 'Benutzerdefinierten Status festlegen'}
          </button>
          {me.custom_status && (
            <Tooltip text="Status löschen">
              <button
                aria-label="Status löschen"
                onClick={() => {
                  onClose();
                  void clearCustomStatus();
                }}
                className="p-1.5 text-icon group-hover:text-white"
              >
                <X size={16} />
              </button>
            </Tooltip>
          )}
        </div>
      </div>
    </Popout>
  );
}

function PanelButton({ label, onClick, active, children }: { label: string; onClick: () => void; active?: boolean; children: React.ReactNode }) {
  return (
    <Tooltip text={label}>
      <button
        aria-label={label}
        aria-pressed={active}
        onClick={onClick}
        className={cn('flex size-8 items-center justify-center rounded transition-colors hover:bg-hover', active ? 'text-dnd' : 'text-icon hover:text-icon-hover')}
      >
        {children}
      </button>
    </Tooltip>
  );
}

export function UserPanel() {
  const me = useData((s) => s.me);
  const { muted, deafened, toggleMute, toggleDeafen } = useUi();
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  if (!me) return null;
  const sub = me.custom_status?.text || statusLabel[me.status];
  return (
    <section aria-label="Benutzerbereich" className="box-content flex h-[52px] shrink-0 items-center gap-2 bg-panel px-2 pb-[env(safe-area-inset-bottom)]">
      <button
        data-testid="user-panel"
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget.getBoundingClientRect())}
        className="group -ml-0.5 flex min-w-0 flex-1 items-center gap-2 rounded py-0.5 pl-0.5 pr-1 text-left hover:bg-hover"
      >
        <Avatar user={me} size={32} status={me.status} ring="var(--panel)" />
        <span className="min-w-0 leading-tight">
          <span className="block truncate text-sm font-semibold text-header">{displayName(me)}</span>
          <span className="relative block h-4 overflow-hidden text-xs text-muted">
            <span className="block truncate transition-transform duration-150 group-hover:-translate-y-4">{sub}</span>
            <span className="block truncate transition-transform duration-150 group-hover:-translate-y-4">{me.username}</span>
          </span>
        </span>
      </button>
      <div className="flex shrink-0">
        <PanelButton label={muted || deafened ? 'Stummschaltung aufheben' : 'Stummschalten'} onClick={toggleMute} active={muted || deafened}>
          {muted || deafened ? <MicOff size={20} /> : <Mic size={20} />}
        </PanelButton>
        <PanelButton label={deafened ? 'Ein-/Ausgabe aktivieren' : 'Ein-/Ausgabe deaktivieren'} onClick={toggleDeafen} active={deafened}>
          {deafened ? <HeadphoneOff size={20} /> : <Headphones size={20} />}
        </PanelButton>
        <PanelButton label="Benutzereinstellungen" onClick={() => openModal({ type: 'userSettings' })}>
          <Settings size={20} />
        </PanelButton>
      </div>
      {anchor && <StatusPopout me={me} anchor={anchor} onClose={() => setAnchor(null)} />}
    </section>
  );
}
