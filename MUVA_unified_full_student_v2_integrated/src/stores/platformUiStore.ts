import { create } from 'zustand';

import type { ToastMessage, ToastTone } from '../types/platform';

interface ComingSoonFeature {
  title: string;
  description: string;
}

interface PlatformUiState {
  environmentOpen: boolean;
  comingSoon: ComingSoonFeature | null;
  toasts: ToastMessage[];
  openEnvironment: () => void;
  closeEnvironment: () => void;
  showComingSoon: (title: string, description?: string) => void;
  closeComingSoon: () => void;
  showToast: (message: string, tone?: ToastTone) => void;
  dismissToast: (toastId: string) => void;
}

let toastSequence = 0;

export const usePlatformUiStore = create<PlatformUiState>((set, get) => ({
  environmentOpen: false,
  comingSoon: null,
  toasts: [],
  openEnvironment: () => set({ environmentOpen: true }),
  closeEnvironment: () => set({ environmentOpen: false }),
  showComingSoon: (title, description = '该功能正在建设中，后续版本开放。') => set({
    comingSoon: { title, description },
  }),
  closeComingSoon: () => set({ comingSoon: null }),
  showToast: (message, tone = 'info') => {
    toastSequence += 1;
    const id = `toast-${Date.now()}-${toastSequence}`;
    set((state) => ({ toasts: [...state.toasts, { id, message, tone }] }));
    window.setTimeout(() => get().dismissToast(id), 3_600);
  },
  dismissToast: (toastId) => set((state) => ({
    toasts: state.toasts.filter((toast) => toast.id !== toastId),
  })),
}));
