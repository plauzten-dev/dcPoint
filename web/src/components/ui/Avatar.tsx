import { memo, useId } from 'react';
import type { Status, User } from '../../api/types';
import { avatarUrl, defaultAvatarColor } from '../../lib/cdn';
import { LogoMark } from './Logo';

export const statusColor: Record<Status, string> = {
  online: 'var(--color-online)',
  idle: 'var(--color-idle)',
  dnd: 'var(--color-dnd)',
  invisible: 'var(--color-offline)',
  offline: 'var(--color-offline)',
};

export const statusLabel: Record<Status, string> = {
  online: 'Online',
  idle: 'Abwesend',
  dnd: 'Bitte nicht stören',
  invisible: 'Unsichtbar',
  offline: 'Offline',
};

/** Status glyph: online = dot, idle = moon, dnd = bar, offline/invisible = ring. */
export function StatusIcon({ status, size = 10 }: { status: Status; size?: number }) {
  const id = useId();
  const color = statusColor[status];
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" aria-label={statusLabel[status]}>
      <mask id={id}>
        <rect width="10" height="10" fill="white" />
        {status === 'idle' && <circle cx="2.5" cy="2.5" r="3.75" fill="black" />}
        {status === 'dnd' && <rect x="2.5" y="4" width="5" height="2" rx="1" fill="black" />}
        {(status === 'offline' || status === 'invisible') && <circle cx="5" cy="5" r="2.5" fill="black" />}
      </mask>
      <circle cx="5" cy="5" r="5" fill={color} mask={`url(#${id})`} />
    </svg>
  );
}

interface AvatarProps {
  user: Pick<User, 'id' | 'avatar' | 'username'>;
  size?: number;
  status?: Status | null;
  /** CSS color behind the status badge (matches the surface the avatar sits on). */
  ring?: string;
}

export const Avatar = memo(function Avatar({ user, size = 32, status, ring = 'var(--sidebar)' }: AvatarProps) {
  const url = avatarUrl(user, size <= 40 ? 64 : 256);
  const badge = Math.max(10, Math.round(size * 0.3125));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      {url ? (
        <img src={url} alt="" width={size} height={size} loading="lazy" decoding="async" className="size-full rounded-full object-cover" draggable={false} />
      ) : (
        <div className="flex size-full items-center justify-center rounded-full text-white" style={{ background: defaultAvatarColor(user.id) }}>
          <LogoMark size={Math.round(size * 0.6)} className="[--logo-dot:transparent]" />
        </div>
      )}
      {status && (
        <span
          className="absolute flex items-center justify-center rounded-full"
          style={{ right: -badge / 4, bottom: -badge / 4, padding: Math.max(2, badge / 5), background: ring }}
        >
          <StatusIcon status={status} size={badge} />
        </span>
      )}
    </div>
  );
});
