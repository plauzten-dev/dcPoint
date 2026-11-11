import { createContext, memo, useContext, useState, type DragEvent, type MouseEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ChevronDown, FolderPlus, Hash, Lock, LogOut, PlusCircle, Settings, UserPlus, Volume2, X } from 'lucide-react';
import { http } from '../../api/client';
import { ChannelType, type Channel, type GuildPayload } from '../../api/types';
import { confirmDeleteChannel, confirmLeaveGuild, reportError } from '../../lib/actions';
import { cn } from '../../lib/cn';
import { copyText } from '../../lib/format';
import { useChannelPermissions, useChannelTree, useGuildPermissions, type CategoryGroup } from '../../lib/hooks';
import { showChat } from '../../lib/mobile';
import { has, P } from '../../lib/permissions';
import { useData } from '../../stores/data';
import { openModal, toast, useOverlay } from '../../stores/overlay';
import { useUi } from '../../stores/ui';
import { Tooltip } from '../ui/Tooltip';
import { UserPanel } from './UserPanel';

type DropPos = 'before' | 'after' | 'inside';
interface DragState {
  dragging: Channel | null;
  target: { id: string; pos: DropPos } | null;
  setDragging(c: Channel | null): void;
  setTarget(t: { id: string; pos: DropPos } | null): void;
  drop(): void;
  enabled: boolean;
}
const DragCtx = createContext<DragState | null>(null);

function isPrivate(c: Channel): boolean {
  const everyone = c.permission_overwrites.find((o) => o.type === 0 && o.id === c.guild_id);
  return !!everyone && (BigInt(everyone.deny) & P.VIEW_CHANNEL) !== 0n;
}

function sameOverwrites(a: Channel, b: Channel | undefined): boolean {
  if (!b) return a.permission_overwrites.length === 0;
  const key = (c: Channel) => JSON.stringify([...c.permission_overwrites].sort((x, y) => x.id.localeCompare(y.id)));
  return key(a) === key(b);
}

interface PositionUpdate {
  id: string;
  position: number;
  parent_id?: string | null;
  lock_permissions?: boolean;
}

/** Computes the minimal set of position updates for a drag & drop move. */
export function computeMove(tree: CategoryGroup[], dragged: Channel, targetId: string, pos: DropPos): PositionUpdate[] {
  const updates: PositionUpdate[] = [];
  if (dragged.type === ChannelType.GuildCategory) {
    const cats = tree.map((g) => g.category).filter((c): c is Channel => !!c && c.id !== dragged.id);
    let idx = cats.findIndex((c) => c.id === targetId);
    if (idx < 0) return [];
    if (pos === 'after' || pos === 'inside') idx += 1;
    cats.splice(idx, 0, dragged);
    cats.forEach((c, i) => c.position !== i && updates.push({ id: c.id, position: i }));
    return updates;
  }
  const all = tree.flatMap((g) => (g.category ? [g.category, ...g.channels] : g.channels));
  const target = all.find((c) => c.id === targetId);
  if (!target) return [];
  const parentId = target.type === ChannelType.GuildCategory ? target.id : target.parent_id;
  const group = tree.find((g) => (g.category?.id ?? null) === (parentId ?? null));
  if (!group) return [];
  const siblings = group.channels.filter((c) => c.id !== dragged.id);
  let idx = target.type === ChannelType.GuildCategory ? 0 : siblings.findIndex((c) => c.id === target.id) + (pos === 'after' ? 1 : 0);
  if (idx < 0) idx = siblings.length;
  siblings.splice(idx, 0, dragged);
  const oldParent = tree.find((g) => g.category?.id === dragged.parent_id)?.category ?? undefined;
  const parentChanged = (dragged.parent_id ?? null) !== (parentId ?? null);
  siblings.forEach((c, i) => {
    if (c.id === dragged.id) {
      if (parentChanged || c.position !== i) {
        updates.push({
          id: c.id,
          position: i,
          ...(parentChanged ? { parent_id: parentId ?? null, lock_permissions: !!parentId && sameOverwrites(dragged, oldParent) } : {}),
        });
      }
    } else if (c.position !== i) updates.push({ id: c.id, position: i });
  });
  return updates;
}

function GuildHeader({ guildId }: { guildId: string }) {
  const guild = useData((s) => s.guilds[guildId]);
  const me = useData((s) => s.me);
  const perms = useGuildPermissions(guildId);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  if (!guild) return null;

  const openMenu = (e: MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const firstText = Object.values(useData.getState().channels[guildId] ?? {}).find((c) => c.type === ChannelType.GuildText);
    setOpen(true);
    useOverlay.getState().openMenu(r.left + 10, r.bottom + 4, [
      {
        label: 'Leute einladen',
        icon: <UserPlus size={18} />,
        disabled: !has(perms, P.CREATE_INSTANT_INVITE) || !firstText,
        onClick: () => firstText && openModal({ type: 'invite', guildId, channelId: firstText.id }),
      },
      { label: 'Servereinstellungen', icon: <Settings size={18} />, disabled: !has(perms, P.MANAGE_GUILD), onClick: () => openModal({ type: 'guildSettings', guildId }) },
      { label: 'Kanal erstellen', icon: <PlusCircle size={18} />, disabled: !has(perms, P.MANAGE_CHANNELS), onClick: () => openModal({ type: 'createChannel', guildId }) },
      {
        label: 'Kategorie erstellen',
        icon: <FolderPlus size={18} />,
        disabled: !has(perms, P.MANAGE_CHANNELS),
        onClick: () => openModal({ type: 'createChannel', guildId, category: true }),
      },
      ...(guild.owner_id !== me?.id
        ? [{ separator: true } as const, { label: 'Server verlassen', icon: <LogOut size={18} />, danger: true, onClick: () => confirmLeaveGuild(guildId, navigate) }]
        : []),
    ]);
    const unsub = useOverlay.subscribe((s) => {
      if (!s.menu) {
        setOpen(false);
        unsub();
      }
    });
  };

  return (
    <button
      onClick={openMenu}
      data-testid="guild-header"
      className={cn(
        'relative z-[2] flex h-12 w-full shrink-0 items-center justify-between px-4 text-left shadow-[0_1px_0_rgb(4_4_5/0.2),0_1.5px_0_rgb(6_6_7/0.05),0_2px_0_rgb(4_4_5/0.05)] transition-colors hover:bg-hover',
        open && 'bg-hover',
      )}
    >
      <h2 className="truncate text-base font-semibold text-header">{guild.name}</h2>
      {open ? <X size={18} className="shrink-0 text-icon" /> : <ChevronDown size={18} className="shrink-0 text-icon" />}
    </button>
  );
}

const ChannelItem = memo(function ChannelItem({ channel, selected }: { channel: Channel; selected: boolean }) {
  const navigate = useNavigate();
  const perms = useChannelPermissions(channel);
  const drag = useContext(DragCtx)!;
  const canManage = has(perms, P.MANAGE_CHANNELS);
  const canInvite = has(perms, P.CREATE_INSTANT_INVITE);
  const voice = channel.type === ChannelType.GuildVoice;
  const Icon = voice ? Volume2 : Hash;
  const dropHere = drag.target?.id === channel.id && drag.dragging && drag.dragging.type !== ChannelType.GuildCategory ? drag.target.pos : null;

  const open = () => {
    if (voice) toast('Sprachkanäle werden in Phase 4 freigeschaltet.');
    else {
      navigate(`/channels/${channel.guild_id}/${channel.id}`);
      showChat();
    }
  };
  const menu = (e: MouseEvent) => {
    e.preventDefault();
    useOverlay.getState().openMenu(e.clientX, e.clientY, [
      { label: 'Einladen', disabled: !canInvite, onClick: () => openModal({ type: 'invite', guildId: channel.guild_id!, channelId: channel.id }) },
      { label: 'Link kopieren', onClick: () => copyText(`${location.origin}/channels/${channel.guild_id}/${channel.id}`) },
      { separator: true },
      { label: 'Kanal bearbeiten', disabled: !canManage, onClick: () => openModal({ type: 'channelSettings', channelId: channel.id }) },
      { label: 'Kanal löschen', danger: true, disabled: !canManage, onClick: () => confirmDeleteChannel(channel.id, navigate) },
      { separator: true },
      { label: 'Kanal-ID kopieren', hint: 'ID', onClick: () => copyText(channel.id) },
    ]);
  };
  const onDragOver = (e: DragEvent) => {
    if (!drag.dragging || drag.dragging.type === ChannelType.GuildCategory) return;
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    drag.setTarget({ id: channel.id, pos: e.clientY < r.top + r.height / 2 ? 'before' : 'after' });
  };

  return (
    <li className="relative px-2 py-px" onDragOver={onDragOver} onDrop={(e) => (e.preventDefault(), drag.drop())}>
      {dropHere && <div className={cn('absolute left-2 right-2 z-10 h-0.5 rounded bg-online', dropHere === 'before' ? 'top-0' : 'bottom-0')} />}
      <div
        role="link"
        tabIndex={0}
        aria-current={selected ? 'page' : undefined}
        data-testid={`channel-${channel.name}`}
        draggable={drag.enabled && canManage}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', channel.id);
          drag.setDragging(channel);
        }}
        onDragEnd={() => drag.setDragging(null)}
        onClick={open}
        onKeyDown={(e) => e.key === 'Enter' && open()}
        onContextMenu={menu}
        className={cn(
          'group flex h-[34px] cursor-pointer items-center gap-1.5 rounded px-2 transition-colors duration-75',
          selected ? 'bg-selected text-header' : 'text-muted hover:bg-hover hover:text-icon-hover',
          drag.dragging?.id === channel.id && 'opacity-40',
        )}
      >
        <span className="relative shrink-0">
          <Icon size={20} className={selected ? 'text-header-2' : 'text-icon-muted'} />
          {isPrivate(channel) && <Lock size={9} strokeWidth={3} className="absolute -right-0.5 -top-0.5 rounded-sm bg-sidebar text-icon-muted" />}
        </span>
        <span className={cn('flex-1 truncate text-base font-medium leading-5', selected && 'text-header')}>{channel.name}</span>
        <span className={cn('flex items-center gap-1', !selected && 'hidden group-hover:flex')}>
          {canInvite && (
            <Tooltip text="Einladung erstellen">
              <button
                aria-label="Einladung erstellen"
                onClick={(e) => (e.stopPropagation(), openModal({ type: 'invite', guildId: channel.guild_id!, channelId: channel.id }))}
                className="flex text-icon hover:text-icon-hover"
              >
                <UserPlus size={16} />
              </button>
            </Tooltip>
          )}
          {canManage && (
            <Tooltip text="Kanal bearbeiten">
              <button
                aria-label="Kanal bearbeiten"
                onClick={(e) => (e.stopPropagation(), openModal({ type: 'channelSettings', channelId: channel.id }))}
                className="flex text-icon hover:text-icon-hover"
              >
                <Settings size={16} />
              </button>
            </Tooltip>
          )}
        </span>
      </div>
    </li>
  );
});

function CategorySection({ group, selectedId, guildId }: { group: CategoryGroup; selectedId?: string; guildId: string }) {
  const collapsed = useUi((s) => (group.category ? !!s.collapsedCategories[group.category.id] : false));
  const toggle = useUi((s) => s.toggleCategory);
  const navigate = useNavigate();
  const drag = useContext(DragCtx)!;
  const perms = useChannelPermissions(group.category ?? undefined);
  const guildPerms = useGuildPermissions(guildId);
  const cat = group.category;
  const canManage = has(cat ? perms : guildPerms, P.MANAGE_CHANNELS);
  const visible = collapsed ? group.channels.filter((c) => c.id === selectedId) : group.channels;
  if (!cat && group.channels.length === 0) return null;

  const dropState = cat && drag.target?.id === cat.id && drag.dragging ? drag.target.pos : null;
  const onDragOver = (e: DragEvent) => {
    if (!cat || !drag.dragging) return;
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    const pos: DropPos = drag.dragging.type === ChannelType.GuildCategory ? (e.clientY < r.top + r.height / 2 ? 'before' : 'after') : 'inside';
    drag.setTarget({ id: cat.id, pos });
  };
  const menu = (e: MouseEvent) => {
    if (!cat) return;
    e.preventDefault();
    useOverlay.getState().openMenu(e.clientX, e.clientY, [
      { label: 'Kategorie einklappen', checked: collapsed, onClick: () => toggle(cat.id) },
      { separator: true },
      { label: 'Kategorie bearbeiten', disabled: !canManage, onClick: () => openModal({ type: 'channelSettings', channelId: cat.id }) },
      { label: 'Kategorie löschen', danger: true, disabled: !canManage, onClick: () => confirmDeleteChannel(cat.id, navigate) },
      { separator: true },
      { label: 'Kategorie-ID kopieren', hint: 'ID', onClick: () => copyText(cat.id) },
    ]);
  };

  return (
    <li className={cn(cat ? 'pt-4' : 'pt-2', drag.dragging?.id === cat?.id && 'opacity-40')}>
      {cat && (
        <div
          className="relative"
          onDragOver={onDragOver}
          onDrop={(e) => (e.preventDefault(), drag.drop())}
          draggable={drag.enabled && canManage}
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', cat.id);
            drag.setDragging(cat);
          }}
          onDragEnd={() => drag.setDragging(null)}
        >
          {dropState && dropState !== 'inside' && (
            <div className={cn('absolute left-2 right-2 h-0.5 rounded bg-online', dropState === 'before' ? '-top-2' : '-bottom-1')} />
          )}
          <div
            onContextMenu={menu}
            className={cn('group flex h-6 items-center pl-0.5 pr-2', dropState === 'inside' && 'rounded bg-online/20')}
            data-testid={`category-${cat.name}`}
          >
            <button
              onClick={() => toggle(cat.id)}
              aria-expanded={!collapsed}
              className="flex min-w-0 flex-1 items-center text-muted hover:text-icon-hover"
            >
              <ChevronDown size={12} strokeWidth={3} className={cn('mr-0.5 shrink-0 transition-transform duration-100', collapsed && '-rotate-90')} />
              <span className="truncate text-xs font-semibold uppercase tracking-wide">{cat.name}</span>
            </button>
            {canManage && (
              <Tooltip text="Kanal erstellen">
                <button
                  aria-label="Kanal erstellen"
                  onClick={() => openModal({ type: 'createChannel', guildId, parentId: cat.id })}
                  className="flex text-icon hover:text-icon-hover"
                >
                  <PlusIconSmall />
                </button>
              </Tooltip>
            )}
          </div>
        </div>
      )}
      <ul>
        {visible.map((c) => (
          <ChannelItem key={c.id} channel={c} selected={c.id === selectedId} />
        ))}
      </ul>
    </li>
  );
}

function PlusIconSmall() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
      <path fill="currentColor" d="M13 6a1 1 0 1 0-2 0v5H6a1 1 0 1 0 0 2h5v5a1 1 0 1 0 2 0v-5h5a1 1 0 1 0 0-2h-5V6Z" />
    </svg>
  );
}

export function ChannelSidebar({ guildId }: { guildId: string }) {
  const { channelId } = useParams();
  const tree = useChannelTree(guildId);
  const perms = useGuildPermissions(guildId);
  const [dragging, setDragging] = useState<Channel | null>(null);
  const [target, setTarget] = useState<DragState['target']>(null);

  const drop = async () => {
    const dragged = dragging;
    const t = target;
    setDragging(null);
    setTarget(null);
    if (!dragged || !t || t.id === dragged.id) return;
    const updates = computeMove(tree, dragged, t.id, t.pos);
    if (!updates.length) return;
    const s = useData.getState();
    const before = s.channels[guildId];
    // Optimistic update; the gateway confirms with CHANNEL_UPDATE events.
    for (const u of updates) {
      const c = before?.[u.id];
      if (c) s.upsertChannel({ ...c, position: u.position, ...(u.parent_id !== undefined ? { parent_id: u.parent_id } : {}) });
    }
    try {
      await http.patch(`/guilds/${guildId}/channels`, updates);
    } catch (err) {
      reportError(err);
      const fresh = await http.get<GuildPayload>(`/guilds/${guildId}`).catch(() => null);
      if (fresh) useData.getState().upsertGuild(fresh);
    }
  };

  const ctx: DragState = {
    dragging,
    target,
    setDragging: (c) => {
      setDragging(c);
      if (!c) setTarget(null);
    },
    setTarget,
    drop,
    enabled: has(perms, P.MANAGE_CHANNELS),
  };

  const sidebarMenu = (e: MouseEvent) => {
    if (e.target !== e.currentTarget || !has(perms, P.MANAGE_CHANNELS)) return;
    e.preventDefault();
    useOverlay.getState().openMenu(e.clientX, e.clientY, [
      { label: 'Kanal erstellen', onClick: () => openModal({ type: 'createChannel', guildId }) },
      { label: 'Kategorie erstellen', onClick: () => openModal({ type: 'createChannel', guildId, category: true }) },
    ]);
  };

  return (
    <div className="flex w-60 shrink-0 flex-col bg-sidebar max-md:w-auto max-md:min-w-0 max-md:flex-1">
      <GuildHeader guildId={guildId} />
      <DragCtx.Provider value={ctx}>
        <nav aria-label="Kanäle" className="scroller-thin flex-1 pb-4" onContextMenu={sidebarMenu}>
          <ul onContextMenu={sidebarMenu}>
            {tree.map((g) => (
              <CategorySection key={g.category?.id ?? 'root'} group={g} selectedId={channelId} guildId={guildId} />
            ))}
          </ul>
        </nav>
      </DragCtx.Provider>
      <UserPanel />
    </div>
  );
}

