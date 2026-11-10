import { Compass, Plus, Users } from 'lucide-react';
import { openModal } from '../../stores/overlay';
import { Button } from '../ui/Button';
import { Tooltip } from '../ui/Tooltip';
import { UserPanel } from './UserPanel';

export function HomeSidebar() {
  return (
    <div className="flex w-60 shrink-0 flex-col bg-sidebar">
      <div className="flex h-12 shrink-0 items-center px-2.5 shadow-[0_1px_0_rgb(4_4_5/0.2),0_1.5px_0_rgb(6_6_7/0.05),0_2px_0_rgb(4_4_5/0.05)]">
        <button
          onClick={() => openModal({ type: 'quickSwitcher' })}
          className="h-7 w-full truncate rounded bg-input-strong px-1.5 text-left text-sm font-medium text-muted"
        >
          Unterhaltung finden oder beginnen
        </button>
      </div>
      <nav className="scroller-thin flex-1 px-2 pt-2">
        <div aria-current="page" className="flex h-[42px] items-center gap-3 rounded bg-selected px-2 text-header">
          <Users size={22} />
          <span className="text-base font-medium">Freunde</span>
        </div>
        <div className="mt-4 flex items-center justify-between px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-muted">
          <span>Direktnachrichten</span>
          <Tooltip text="DM erstellen">
            <button aria-label="DM erstellen" disabled className="text-icon opacity-50">
              <Plus size={16} />
            </button>
          </Tooltip>
        </div>
        <p className="px-2 pt-2 text-sm text-muted">Direktnachrichten und Gruppen-DMs kommen mit Phase 3.</p>
      </nav>
      <UserPanel />
    </div>
  );
}

export function HomeMain() {
  return (
    <main className="flex min-w-0 flex-1 flex-col bg-chat">
      <header className="flex h-12 shrink-0 items-center gap-4 px-4 shadow-[0_1px_0_rgb(4_4_5/0.2),0_1.5px_0_rgb(6_6_7/0.05),0_2px_0_rgb(4_4_5/0.05)]">
        <div className="flex items-center gap-2 font-semibold text-header">
          <Users size={22} className="text-icon-muted" />
          Freunde
        </div>
        <div className="h-6 w-px bg-divider" />
        {['Online', 'Alle', 'Ausstehend', 'Blockiert'].map((t, i) => (
          <span key={t} className={i === 0 ? 'rounded bg-selected px-2 py-0.5 font-medium text-header' : 'px-2 py-0.5 font-medium text-muted'}>
            {t}
          </span>
        ))}
      </header>
      <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
        <svg width="260" height="160" viewBox="0 0 260 160" aria-hidden className="mb-8">
          <circle cx="130" cy="80" r="72" fill="var(--color-brand)" opacity="0.12" />
          <rect x="70" y="50" width="90" height="60" rx="14" fill="var(--color-brand)" opacity="0.85" />
          <rect x="110" y="70" width="80" height="54" rx="14" fill="var(--color-online)" opacity="0.85" />
          <circle cx="98" cy="80" r="6" fill="#fff" />
          <circle cx="150" cy="97" r="6" fill="#fff" />
        </svg>
        <h2 className="text-lg font-semibold text-header">Hier ist es noch ruhig</h2>
        <p className="mt-2 max-w-md text-sm text-muted">Erstelle deinen eigenen Server oder tritt mit einer Einladung bei. Freundesliste und DMs folgen in Phase 3.</p>
        <div className="mt-6 flex gap-3">
          <Button onClick={() => openModal({ type: 'createGuild' })}>
            <Plus size={16} /> Server erstellen
          </Button>
          <Button variant="secondary" onClick={() => openModal({ type: 'createGuild' })}>
            <Compass size={16} /> Einladung nutzen
          </Button>
        </div>
      </div>
    </main>
  );
}
