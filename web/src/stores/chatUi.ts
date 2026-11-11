import { create } from 'zustand';
import type { Message } from '../api/types';

interface ChatUiState {
  replyTo: Message | null;
  replyMention: boolean;
  editingId: string | null;
  setReply(m: Message | null): void;
  toggleReplyMention(): void;
  setEditing(id: string | null): void;
  reset(): void;
}

/** Transient composer state; kept outside React context so rows only re-render when they are affected. */
export const useChatUi = create<ChatUiState>()((set) => ({
  replyTo: null,
  replyMention: true,
  editingId: null,
  setReply: (replyTo) => set({ replyTo, replyMention: true, editingId: null }),
  toggleReplyMention: () => set((s) => ({ replyMention: !s.replyMention })),
  setEditing: (editingId) => set({ editingId }),
  reset: () => set({ replyTo: null, editingId: null, replyMention: true }),
}));
