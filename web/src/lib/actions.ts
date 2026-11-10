import type { NavigateFunction } from 'react-router';
import { ApiError, http } from '../api/client';
import { useData } from '../stores/data';
import { openModal, toast } from '../stores/overlay';

export function reportError(err: unknown) {
  toast(err instanceof ApiError ? err.text() ?? 'Fehler' : 'Etwas ist schiefgelaufen.', 'error');
}

export function confirmLeaveGuild(guildId: string, navigate: NavigateFunction) {
  const guild = useData.getState().guilds[guildId];
  if (!guild) return;
  openModal({
    type: 'confirm',
    title: `„${guild.name}“ verlassen`,
    body: `Willst du ${guild.name} wirklich verlassen? Du kannst nur mit einer neuen Einladung wieder beitreten.`,
    confirm: 'Server verlassen',
    danger: true,
    onConfirm: async () => {
      await http.delete(`/users/@me/guilds/${guildId}`);
      useData.getState().removeGuild(guildId);
      if (location.pathname.includes(guildId)) navigate('/channels/@me');
    },
  });
}

export function confirmDeleteChannel(channelId: string, navigate: NavigateFunction) {
  const s = useData.getState();
  const guildId = s.channelGuild[channelId];
  const channel = guildId ? s.channels[guildId]?.[channelId] : undefined;
  if (!channel) return;
  const isCategory = channel.type === 4;
  openModal({
    type: 'confirm',
    title: isCategory ? 'Kategorie löschen' : 'Kanal löschen',
    body: `Bist du sicher, dass du ${isCategory ? 'die Kategorie' : 'den Kanal'} „${channel.name}“ löschen willst? Das kann nicht rückgängig gemacht werden.`,
    confirm: isCategory ? 'Kategorie löschen' : 'Kanal löschen',
    danger: true,
    onConfirm: async () => {
      await http.delete(`/channels/${channelId}`);
      useData.getState().removeChannel(channel);
      if (location.pathname.endsWith(channelId)) navigate(`/channels/${guildId}`);
    },
  });
}
