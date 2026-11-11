import { create } from 'zustand';

const TYPING_MS = 10_000;

interface TypingState {
  /** channelId -> userId -> expiry timestamp (ms) */
  typing: Record<string, Record<string, number>>;
  start(channelId: string, userId: string): void;
  stop(channelId: string, userId: string): void;
}

export const useTyping = create<TypingState>()((set) => ({
  typing: {},
  start: (channelId, userId) => {
    const until = Date.now() + TYPING_MS;
    set((s) => ({ typing: { ...s.typing, [channelId]: { ...s.typing[channelId], [userId]: until } } }));
    setTimeout(() => {
      set((s) => {
        if ((s.typing[channelId]?.[userId] ?? 0) > Date.now()) return {};
        const { [userId]: _, ...rest } = s.typing[channelId] ?? {};
        return { typing: { ...s.typing, [channelId]: rest } };
      });
    }, TYPING_MS + 50);
  },
  stop: (channelId, userId) =>
    set((s) => {
      if (!s.typing[channelId]?.[userId]) return {};
      const { [userId]: _, ...rest } = s.typing[channelId];
      return { typing: { ...s.typing, [channelId]: rest } };
    }),
}));
