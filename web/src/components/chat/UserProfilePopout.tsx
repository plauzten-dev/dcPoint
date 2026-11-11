import { useQuery } from '@tanstack/react-query';
import { http } from '../../api/client';
import type { User } from '../../api/types';
import { useMembers } from '../../lib/hooks';
import { useData } from '../../stores/data';
import { ProfileCard } from '../ProfileCard';
import { Popout } from '../ui/Popout';

export function UserProfilePopout({ userId, guildId, anchor, onClose }: { userId: string; guildId: string; anchor: DOMRect; onClose: () => void }) {
  const { data: members } = useMembers(guildId);
  const member = members?.find((m) => m.user.id === userId);
  const presence = useData((s) => s.presences[userId]);
  const roles = useData((s) => s.roles[guildId]);
  const fetched = useQuery({ queryKey: ['user', userId], queryFn: () => http.get<User>(`/users/${userId}`), enabled: !member });
  const user = member?.user ?? fetched.data;
  if (!user) return null;
  const memberRoles = member && roles ? member.roles.map((id) => roles[id]).filter(Boolean).sort((a, b) => b.position - a.position) : [];
  return (
    <Popout anchor={anchor} placement="right" onClose={onClose} className="w-[300px] overflow-hidden">
      <ProfileCard user={user} member={member} status={presence?.status ?? 'offline'} customStatus={presence?.custom_status} roles={memberRoles} />
    </Popout>
  );
}
