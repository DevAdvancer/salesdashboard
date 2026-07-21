import { create } from 'zustand';

interface PageLoaderState {
  progress: number;
  isVisible: boolean;
  isOverlay: boolean;
  start: (options?: { overlay?: boolean }) => void;
  setProgress: (progress: number) => void;
  finish: () => void;
  reset: () => void;
}

export const usePageLoader = create<PageLoaderState>((set) => ({
  progress: 0,
  isVisible: false,
  isOverlay: false,
  start: (options) =>
    set({
      progress: 0,
      isVisible: true,
      isOverlay: options?.overlay ?? false,
    }),
  setProgress: (progress) =>
    set((state) => ({
      // Only allow progress to increase, never decrease, unless reset
      progress: Math.max(state.progress, Math.min(100, progress)),
    })),
  finish: () => set({ progress: 100 }),
  reset: () => set({ progress: 0, isVisible: false, isOverlay: false }),
}));
