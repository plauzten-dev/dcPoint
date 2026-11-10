import type { CustomStatus, Member, Role, Status, User } from '../api/types';
import { bannerUrl, colorToHex, defaultAvatarColor, displayName } from '../lib/cdn';
import { formatDate } from '../lib/format';
import { Avatar, statusLabel } from './ui/Avatar';
import { Tooltip } from './ui/Tooltip';

interface Props {
  user: User;
  status?: Status | null;
  customStatus?: CustomStatus | null;
  member?: Member;
  roles?: Role[];
  compact?: boolean;
}

/** Profile header used by popouts (banner, avatar, names, bio, roles). */
export function ProfileCard({ user, status, customStatus, member, roles, compact }: Props) {
  const banner = bannerUrl(user);
  const bannerColor = user.accent_color !== null ? colorToHex(user.accent_color) : defaultAvatarColor(user.id);
  return (
    <div className="select-text">
      <div className="relative">
        <div
          className="h-[60px] w-full rounded-t-lg bg-cover bg-center"
          style={banner ? { backgroundImage: `url(${banner})`, height: 105 } : { background: bannerColor }}
        />
        <div className="absolute left-4 rounded-full bg-floating p-1.5" style={{ top: banner ? 60 : 16 }}>
          <Tooltip text={status ? statusLabel[status] : undefined} placement="top">
            <Avatar user={user} size={80} status={status ?? undefined} ring="var(--floating)" />
          </Tooltip>
        </div>
      </div>
      <div className="px-4 pb-3 pt-[52px]">
        <div className="text-xl font-bold leading-6 text-header">{displayName(user, member?.nick)}</div>
        <div className="text-sm text-header-2">
          {user.username}
          {user.pronouns && <span className="text-muted"> • {user.pronouns}</span>}
        </div>
        {customStatus?.text && (
          <div className="mt-2 text-sm text-text">
            {customStatus.emoji && <span className="mr-1">{customStatus.emoji}</span>}
            {customStatus.text}
          </div>
        )}
        {!compact && (
          <div className="mt-3 rounded-lg bg-sidebar p-3">
            {user.bio && (
              <section className="mb-3">
                <h3 className="mb-1.5 text-xs font-bold uppercase text-header">Über mich</h3>
                <p className="whitespace-pre-wrap break-words text-sm text-text">{user.bio}</p>
              </section>
            )}
            <section>
              <h3 className="mb-1.5 text-xs font-bold uppercase text-header">Mitglied seit</h3>
              <div className="flex items-center gap-2 text-sm text-text">
                <span>{formatDate(user.created_at)}</span>
                {member && (
                  <>
                    <span className="size-1 rounded-full bg-icon-muted" />
                    <span>{formatDate(member.joined_at)} (Server)</span>
                  </>
                )}
              </div>
            </section>
            {roles && roles.length > 0 && (
              <section className="mt-3">
                <h3 className="mb-1.5 text-xs font-bold uppercase text-header">Rollen</h3>
                <div className="flex flex-wrap gap-1">
                  {roles.map((r) => (
                    <span key={r.id} className="flex items-center gap-1 rounded bg-chat px-1.5 py-0.5 text-xs font-medium text-text">
                      <span className="size-3 rounded-full" style={{ background: r.color ? colorToHex(r.color) : '#80848e' }} />
                      {r.name}
                    </span>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
