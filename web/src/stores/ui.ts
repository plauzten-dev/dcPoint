import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Theme = 'dark' | 'light';

interface UiState {
  theme: Theme;
  memberListOpen: boolean;
  collapsedCategories: Record<string, true>;
  lastChannel: Record<string, string>;
  muted: boolean;
  deafened: boolean;
  setTheme(t: Theme): void;
  toggleMemberList(): void;
  toggleCategory(id: string): void;
  setLastChannel(guildId: string, channelId: string): void;
  toggleMute(): void;
  toggleDeafen(): void;
}

export const useUi = create<UiState>()(
  persist(
    (set) => ({
      theme: 'dark',
      memberListOpen: true,
      collapsedCategories: {},
      lastChannel: {},
      muted: false,
      deafened: false,
      setTheme: (theme) => {
        document.documentElement.className = `theme-${theme}`;
        set({ theme });
      },
      toggleMemberList: () => set((s) => ({ memberListOpen: !s.memberListOpen })),
      toggleCategory: (id) =>
        set((s) => {
          const next = { ...s.collapsedCategories };
          if (next[id]) delete next[id];
          else next[id] = true;
          return { collapsedCategories: next };
        }),
      setLastChannel: (guildId, channelId) =>
        set((s) => (s.lastChannel[guildId] === channelId ? {} : { lastChannel: { ...s.lastChannel, [guildId]: channelId } })),
      // Undeafening restores the previous mute state, like the original.
      toggleMute: () => set((s) => (s.deafened ? { deafened: false, muted: false } : { muted: !s.muted })),
      toggleDeafen: () => set((s) => ({ deafened: !s.deafened })),
    }),
    { name: 'dcpoint-ui', version: 1 },
  ),
);
