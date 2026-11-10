import { API_BASE } from '../api/client';
import type { User } from '../api/types';

const DEFAULT_COLORS = ['#6c5cf6', '#3ba55c', '#ed4245', '#faa61a', '#eb459e', '#00a8fc'];

export function avatarUrl(user: Pick<User, 'id' | 'avatar'>, size = 128): string | null {
  return user.avatar ? `${API_BASE}/cdn/avatars/${user.id}/${user.avatar}?size=${size}` : null;
}

export function bannerUrl(user: Pick<User, 'id' | 'banner'>): string | null {
  return user.banner ? `${API_BASE}/cdn/banners/${user.id}/${user.banner}` : null;
}

export function guildIconUrl(guild: { id: string; icon: string | null }): string | null {
  return guild.icon ? `${API_BASE}/cdn/icons/${guild.id}/${guild.icon}` : null;
}

/** Deterministic fallback avatar color per user. */
export function defaultAvatarColor(id: string): string {
  let h = 0;
  for (let i = id.length - 6; i < id.length; i++) h = (h * 31 + id.charCodeAt(Math.max(0, i))) >>> 0;
  return DEFAULT_COLORS[h % DEFAULT_COLORS.length];
}

/** Initials shown for guilds without icon ("Mein Cooler Server" -> "MCS"). */
export function guildAcronym(name: string): string {
  return name
    .replace(/'s /g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => [...w][0])
    .join('')
    .slice(0, 5);
}

export function displayName(user: Pick<User, 'username' | 'display_name'>, nick?: string | null): string {
  return nick || user.display_name || user.username;
}

export function colorToHex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}
