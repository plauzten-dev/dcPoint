import { useEffect } from 'react';
import type { NavigateFunction } from 'react-router';
import { ChannelType } from '../api/types';
import { useData } from '../stores/data';
import { openModal, useOverlay } from '../stores/overlay';
import { useUi } from '../stores/ui';
import { orderedChannels } from './hooks';
import { guildPath } from './navigation';

export const SHORTCUTS: Array<{ keys: string[]; label: string }> = [
  { keys: ['Strg', 'K'], label: 'Quick Switcher öffnen' },
  { keys: ['Alt', '↑'], label: 'Vorheriger Kanal' },
  { keys: ['Alt', '↓'], label: 'Nächster Kanal' },
  { keys: ['Strg', 'Alt', '↑'], label: 'Vorheriger Server' },
  { keys: ['Strg', 'Alt', '↓'], label: 'Nächster Server' },
  { keys: ['Strg', 'Umschalt', 'M'], label: 'Stummschaltung umschalten' },
  { keys: ['Strg', 'Umschalt', 'D'], label: 'Ein-/Ausgabe umschalten' },
  { keys: ['Strg', 'Umschalt', 'N'], label: 'Server erstellen oder beitreten' },
  { keys: ['Strg', 'U'], label: 'Mitgliederliste umschalten' },
  { keys: ['Strg', ','], label: 'Benutzereinstellungen öffnen' },
  { keys: ['Strg', '/'], label: 'Tastaturkürzel anzeigen' },
  { keys: ['Esc'], label: 'Modal/Popout schließen, Kanal als gelesen markieren (ab Phase 2)' },
];

function currentIds(): { guildId?: string; channelId?: string } {
  const m = location.pathname.match(/\/channels\/([^/]+)(?:\/([^/]+))?/);
  return { guildId: m?.[1], channelId: m?.[2] };
}

export function useGlobalShortcuts(navigate: NavigateFunction) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      const { guildId, channelId } = currentIds();

      if (mod && !e.shiftKey && !e.altKey && key === 'k') {
        e.preventDefault();
        openModal({ type: 'quickSwitcher' });
      } else if (e.altKey && !mod && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && guildId && guildId !== '@me') {
        e.preventDefault();
        const list = orderedChannels(guildId).filter((c) => c.type === ChannelType.GuildText);
        if (!list.length) return;
        const idx = list.findIndex((c) => c.id === channelId);
        const next = list[(idx + (e.key === 'ArrowUp' ? -1 : 1) + list.length) % list.length];
        navigate(`/channels/${guildId}/${next.id}`);
      } else if (e.altKey && mod && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        const order = ['@me', ...useData.getState().guildOrder];
        const idx = Math.max(0, order.indexOf(guildId ?? '@me'));
        const next = order[(idx + (e.key === 'ArrowUp' ? -1 : 1) + order.length) % order.length];
        navigate(next === '@me' ? '/channels/@me' : guildPath(next));
      } else if (mod && e.shiftKey && key === 'm') {
        e.preventDefault();
        useUi.getState().toggleMute();
      } else if (mod && e.shiftKey && key === 'd') {
        e.preventDefault();
        useUi.getState().toggleDeafen();
      } else if (mod && e.shiftKey && key === 'n') {
        e.preventDefault();
        openModal({ type: 'createGuild' });
      } else if (mod && !e.shiftKey && key === 'u') {
        e.preventDefault();
        useUi.getState().toggleMemberList();
      } else if (mod && e.key === ',') {
        e.preventDefault();
        openModal({ type: 'userSettings' });
      } else if (mod && e.key === '/') {
        e.preventDefault();
        openModal({ type: 'userSettings', section: 'keybinds' });
      } else if (e.key === 'Escape' && useOverlay.getState().modals.length) {
        e.preventDefault();
        useOverlay.getState().closeModal();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);
}
