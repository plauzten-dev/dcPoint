import type { ReactNode } from 'react';
import { create } from 'zustand';

export interface MenuItem {
  label: string;
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
  hint?: string;
  checked?: boolean;
  separator?: false;
}
export type MenuEntry = MenuItem | { separator: true };

export type ModalSpec =
  | { type: 'createGuild' }
  | { type: 'createChannel'; guildId: string; parentId?: string | null; category?: boolean }
  | { type: 'invite'; guildId: string; channelId: string }
  | { type: 'confirm'; title: string; body: ReactNode; confirm: string; danger?: boolean; onConfirm: () => Promise<void> | void }
  | { type: 'customStatus' }
  | { type: 'quickSwitcher' }
  | { type: 'userSettings'; section?: string }
  | { type: 'guildSettings'; guildId: string; section?: string }
  | { type: 'channelSettings'; channelId: string };

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error' | 'success';
}

interface OverlayState {
  modals: Array<{ id: number; spec: ModalSpec }>;
  menu: { x: number; y: number; items: MenuEntry[] } | null;
  toasts: Toast[];
  openModal(spec: ModalSpec): void;
  closeModal(id?: number): void;
  openMenu(x: number, y: number, items: MenuEntry[]): void;
  closeMenu(): void;
  toast(text: string, kind?: Toast['kind']): void;
}

let nextId = 1;

export const useOverlay = create<OverlayState>()((set, get) => ({
  modals: [],
  menu: null,
  toasts: [],
  openModal: (spec) => {
    // Singleton modals toggle instead of stacking.
    const existing = get().modals.find((m) => m.spec.type === spec.type && (spec.type === 'quickSwitcher' || spec.type === 'userSettings'));
    if (existing) return set((s) => ({ modals: s.modals.filter((m) => m.id !== existing.id) }));
    set((s) => ({ modals: [...s.modals, { id: nextId++, spec }], menu: null }));
  },
  closeModal: (id) => set((s) => ({ modals: id === undefined ? s.modals.slice(0, -1) : s.modals.filter((m) => m.id !== id) })),
  openMenu: (x, y, items) => set({ menu: { x, y, items } }),
  closeMenu: () => set({ menu: null }),
  toast: (text, kind = 'info') => {
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts, { id, text, kind }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 3500);
  },
}));

export const openModal = (spec: ModalSpec) => useOverlay.getState().openModal(spec);
export const toast = (text: string, kind?: Toast['kind']) => useOverlay.getState().toast(text, kind);
