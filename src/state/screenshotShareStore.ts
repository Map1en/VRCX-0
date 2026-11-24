import { create } from 'zustand';

import type { ScreenshotShareTarget } from '@/platform/tauri/bindings';

type ScreenshotShareStoreState = {
    targets: ScreenshotShareTarget[];
    loaded: boolean;
    sending: boolean;
    setSending(sending: boolean): void;
    setLoadedTargets(targets: ScreenshotShareTarget[]): void;
    upsertTarget(saved: ScreenshotShareTarget): void;
    removeTarget(id: string): void;
    markInvalid(id: string): void;
};

export const useScreenshotShareStore = create<ScreenshotShareStoreState>(
    (set, get) => ({
        targets: [],
        loaded: false,
        sending: false,
        setSending(sending) {
            set({ sending });
        },
        setLoadedTargets(targets) {
            set({ targets, loaded: true });
        },
        upsertTarget(saved) {
            const exists = get().targets.some(
                (target) => target.id === saved.id
            );
            set({
                targets: exists
                    ? get().targets.map((target) =>
                          target.id === saved.id ? saved : target
                      )
                    : [...get().targets, saved]
            });
        },
        removeTarget(id) {
            set({
                targets: get().targets.filter((target) => target.id !== id)
            });
        },
        markInvalid(id) {
            set({
                targets: get().targets.map((target) =>
                    target.id === id ? { ...target, invalid: true } : target
                )
            });
        }
    })
);
