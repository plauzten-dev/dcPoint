import { memo, useState, type DragEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Plus } from 'lucide-react';
import { cn } from '../../lib/cn';
import { copyText } from '../../lib/format';
import { guildPath } from '../../lib/navigation';
import { P } from '../../lib/permissions';
import { useCan } from '../../lib/hooks';
import { confirmLeaveGuild } from '../../lib/actions';
import { moveGuild, useData } from '../../stores/data';
import { openModal, useOverlay } from '../../stores/overlay';
import { GuildIcon } from '../GuildIcon';
import { LogoMark } from '../ui/Logo';
import { Tooltip } from '../ui/Tooltip';

function Pill({ state }: { state: 'none' | 'hover' | 'selected' }) {
  return (
    <span className="absolute left-0 top-1/2 flex w-2 -translate-y-1/2 items-center overflow-hidden" aria-hidden>
      <span
        className={cn(
          'block w-2 -translate-x-1 rounded-r bg-header transition-[height,opacity] duration-200',
          state === 'none' && 'h-0 opacity-0',
          state === 'hover' && 'h-5 opacity-100',
          state === 'selected' && 'h-10 opacity-100',
        )}
      />
    </span>
  );
}

interface RailItemProps {
  label: string;
  selected: boolean;
  onClick: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  children: React.ReactNode;
  idleClass?: string;
  activeClass?: string;
  testId?: string;
}

function RailItem({ label, selected, onClick, onContextMenu, children, idleClass = 'bg-chat text-text', activeClass = 'bg-brand text-white', testId }: RailItemProps) {
  const [hover, setHover] = useState(false);
  return (
    <div className="relative flex w-full justify-center" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <Pill state={selected ? 'selected' : hover ? 'hover' : 'none'} />
      <Tooltip text={label} placement="right" large>
        <button
          aria-label={label}
          data-testid={testId}
          onClick={onClick}
          onContextMenu={onContextMenu}
          className={cn(
            'flex size-12 items-center justify-center overflow-hidden transition-[border-radius,background-color,color] duration-150 ease-out active:translate-y-px',
            selected || hover ? 'rounded-2xl' : 'rounded-3xl',
            selected || hover ? activeClass : idleClass,
          )}
        >
          {children}
        </button>
      </Tooltip>
    </div>
  );
}

const GuildItem = memo(function GuildItem({ id, selected, index }: { id: string; selected: boolean; index: number }) {
  const guild = useData((s) => s.guilds[id]);
  const me = useData((s) => s.me);
  const navigate = useNavigate();
  const canInvite = useCan(id, P.CREATE_INSTANT_INVITE);
  const canManage = useCan(id, P.MANAGE_GUILD);
  const [drop, setDrop] = useState<'above' | 'below' | null>(null);
  if (!guild) return null;

  const menu = (e: React.MouseEvent) => {
    e.preventDefault();
    const firstChannel = Object.values(useData.getState().channels[id] ?? {}).find((c) => c.type === 0);
    useOverlay.getState().openMenu(e.clientX, e.clientY, [
      { label: 'Leute einladen', disabled: !canInvite || !firstChannel, onClick: () => firstChannel && openModal({ type: 'invite', guildId: id, channelId: firstChannel.id }) },
      { separator: true },
      { label: 'Servereinstellungen', disabled: !canManage, onClick: () => openModal({ type: 'guildSettings', guildId: id }) },
      { label: 'Kanal erstellen', onClick: () => openModal({ type: 'createChannel', guildId: id }) },
      { separator: true },
      ...(guild.owner_id !== me?.id ? [{ label: 'Server verlassen', danger: true, onClick: () => confirmLeaveGuild(id, navigate) }] : []),
      { label: 'Server-ID kopieren', hint: 'ID', onClick: () => copyText(id) },
    ]);
  };

  const onDragOver = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes('application/x-dcpoint-guild')) return;
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    setDrop(e.clientY < r.top + r.height / 2 ? 'above' : 'below');
  };
  const onDrop = (e: DragEvent) => {
    const dragged = e.dataTransfer.getData('application/x-dcpoint-guild');
    setDrop(null);
    if (!dragged || dragged === id) return;
    const order = useData.getState().guildOrder;
    const from = order.indexOf(dragged);
    let to = drop === 'above' ? index : index + 1;
    if (from < to) to -= 1;
    moveGuild(dragged, to);
  };

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-dcpoint-guild', id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onDragOver={onDragOver}
      onDragLeave={() => setDrop(null)}
      onDrop={onDrop}
      className="relative w-full"
    >
      {drop && <div className={cn('absolute left-3 right-3 h-0.5 rounded bg-online', drop === 'above' ? '-top-1' : '-bottom-1')} />}
      <RailItem label={guild.name} selected={selected} onClick={() => navigate(guildPath(id))} onContextMenu={menu} testId={`guild-${guild.name}`}>
        <GuildIcon guild={guild} className="!bg-transparent !text-inherit" />
      </RailItem>
    </div>
  );
});

export function GuildBar() {
  const { guildId } = useParams();
  const order = useData((s) => s.guildOrder);
  const navigate = useNavigate();
  const isHome = !guildId || guildId === '@me';
  return (
    <nav aria-label="Server" className="scroller-none flex w-[72px] shrink-0 flex-col items-center gap-2 bg-rail pb-3 pt-3">
      <RailItem label="Direktnachrichten" selected={isHome} onClick={() => navigate('/channels/@me')} testId="home">
        <LogoMark size={28} className="[--logo-dot:transparent]" />
      </RailItem>
      <div className="h-0.5 w-8 shrink-0 rounded-sm bg-divider" />
      {order.map((id, i) => (
        <GuildItem key={id} id={id} index={i} selected={guildId === id} />
      ))}
      <RailItem
        label="Server hinzufügen"
        selected={false}
        onClick={() => openModal({ type: 'createGuild' })}
        idleClass="bg-chat text-online"
        activeClass="bg-online text-white"
        testId="add-guild"
      >
        <Plus size={24} />
      </RailItem>
    </nav>
  );
}
