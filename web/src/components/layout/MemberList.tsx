import { memo, useMemo, useRef, useState, type MouseEvent } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Member, Presence, Role } from '../../api/types';
import { colorToHex, displayName } from '../../lib/cdn';
import { cn } from '../../lib/cn';
import { copyText } from '../../lib/format';
import { useMembers } from '../../lib/hooks';
import { useData } from '../../stores/data';
import { useOverlay } from '../../stores/overlay';
import { ProfileCard } from '../ProfileCard';
import { Avatar } from '../ui/Avatar';
import { Popout } from '../ui/Popout';

type Row = { kind: 'header'; key: string; label: string; count: number } | { kind: 'member'; key: string; member: Member; online: boolean };

const collator = new Intl.Collator('de', { sensitivity: 'base' });

/** Groups members like the original: hoisted roles first, then online, then offline. */
export function groupMembers(members: Member[], roles: Record<string, Role>, presences: Record<string, Presence>): Row[] {
  const hoisted = Object.values(roles)
    .filter((r) => r.hoist)
    .sort((a, b) => b.position - a.position);
  const groups = new Map<string, Member[]>();
  const offline: Member[] = [];
  const online: Member[] = [];
  for (const m of members) {
    if (!presences[m.user.id]) {
      offline.push(m);
      continue;
    }
    const role = hoisted.find((r) => m.roles.includes(r.id));
    if (role) groups.set(role.id, [...(groups.get(role.id) ?? []), m]);
    else online.push(m);
  }
  const byName = (a: Member, b: Member) => collator.compare(displayName(a.user, a.nick), displayName(b.user, b.nick));
  const rows: Row[] = [];
  const push = (key: string, label: string, list: Member[], isOnline: boolean) => {
    if (!list.length) return;
    rows.push({ kind: 'header', key: `h-${key}`, label, count: list.length });
    for (const m of list.sort(byName)) rows.push({ kind: 'member', key: m.user.id, member: m, online: isOnline });
  };
  for (const r of hoisted) push(r.id, r.name, groups.get(r.id) ?? [], true);
  push('online', 'Online', online, true);
  push('offline', 'Offline', offline, false);
  return rows;
}

function topColor(member: Member, roles: Record<string, Role>): string | undefined {
  let best: Role | undefined;
  for (const id of member.roles) {
    const r = roles[id];
    if (r && r.color && (!best || r.position > best.position)) best = r;
  }
  return best ? colorToHex(best.color) : undefined;
}

const MemberRow = memo(function MemberRow({ member, online, guildId, onOpen }: { member: Member; online: boolean; guildId: string; onOpen: (m: Member, r: DOMRect) => void }) {
  const presence = useData((s) => s.presences[member.user.id]);
  const roles = useData((s) => s.roles[guildId]);
  const owner = useData((s) => s.guilds[guildId]?.owner_id === member.user.id);
  const color = roles ? topColor(member, roles) : undefined;
  const menu = (e: MouseEvent) => {
    e.preventDefault();
    useOverlay.getState().openMenu(e.clientX, e.clientY, [
      { label: 'Profil', onClick: () => onOpen(member, (e.target as HTMLElement).closest('button')!.getBoundingClientRect()) },
      { label: 'Erwähnen', disabled: true },
      { separator: true },
      { label: 'Benutzer-ID kopieren', hint: 'ID', onClick: () => copyText(member.user.id) },
    ]);
  };
  return (
    <button
      onClick={(e) => onOpen(member, e.currentTarget.getBoundingClientRect())}
      onContextMenu={menu}
      data-testid={`member-${member.user.username}`}
      className={cn('group ml-2 flex h-[42px] w-[calc(100%-16px)] items-center gap-3 rounded px-2 text-left hover:bg-hover', !online && 'opacity-30 hover:opacity-100')}
    >
      <Avatar user={member.user} size={32} status={online ? presence?.status ?? 'online' : null} ring="var(--sidebar)" />
      <span className="min-w-0 flex-1 leading-tight">
        <span className="flex items-center gap-1">
          <span className="truncate text-base font-medium text-muted group-hover:text-header-2" style={color ? { color } : undefined}>
            {displayName(member.user, member.nick)}
          </span>
          {owner && (
            <svg width="14" height="14" viewBox="0 0 24 24" className="shrink-0 text-idle" aria-label="Servereigentümer">
              <path fill="currentColor" d="M5 18h14l1.5-9-4.5 3.5L12 6l-4 6.5L3.5 9z" />
            </svg>
          )}
        </span>
        {online && presence?.custom_status?.text && <span className="block truncate text-xs text-muted">{presence.custom_status.text}</span>}
      </span>
    </button>
  );
});

export function MemberList({ guildId }: { guildId: string }) {
  const { data: members, isPending } = useMembers(guildId);
  const roles = useData((s) => s.roles[guildId]);
  const presences = useData((s) => s.presences);
  const rows = useMemo(() => (members && roles ? groupMembers(members, roles, presences) : []), [members, roles, presences]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [profile, setProfile] = useState<{ member: Member; rect: DOMRect } | null>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => (rows[i].kind === 'header' ? 40 : 44),
    getItemKey: (i) => rows[i].key,
    overscan: 12,
  });
  const presence = profile ? presences[profile.member.user.id] : undefined;
  const memberRoles = profile && roles ? profile.member.roles.map((id) => roles[id]).filter(Boolean).sort((a, b) => b.position - a.position) : [];

  return (
    <aside aria-label="Mitglieder" className="flex w-60 shrink-0 flex-col bg-sidebar max-md:w-full">
      <div ref={scrollRef} className="scroller-thin flex-1 pb-5">
        {isPending ? (
          <div className="space-y-3 px-4 pt-6">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="flex items-center gap-3" style={{ opacity: 1 - i * 0.1 }}>
                <div className="size-8 rounded-full bg-hover" />
                <div className="h-3 rounded bg-hover" style={{ width: 60 + ((i * 37) % 80) }} />
              </div>
            ))}
          </div>
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((v) => {
              const row = rows[v.index];
              return (
                <div key={v.key} style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${v.start}px)`, height: v.size }}>
                  {row.kind === 'header' ? (
                    <h3 className="truncate px-4 pb-1 pt-6 text-xs font-semibold uppercase tracking-wide text-muted">
                      {row.label} — {row.count}
                    </h3>
                  ) : (
                    <div className="pt-0.5">
                      <MemberRow member={row.member} online={row.online} guildId={guildId} onOpen={(member, rect) => setProfile({ member, rect })} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      {profile && (
        <Popout anchor={profile.rect} placement="left" onClose={() => setProfile(null)} className="w-[300px] overflow-hidden">
          <ProfileCard
            user={profile.member.user}
            member={profile.member}
            status={presence?.status ?? 'offline'}
            customStatus={presence?.custom_status}
            roles={memberRoles}
          />
        </Popout>
      )}
    </aside>
  );
}
