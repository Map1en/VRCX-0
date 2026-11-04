import { create } from 'zustand';

import {
    commands,
    type ScreenshotShareTarget,
    type ScreenshotShareTargetInput
} from '@/platform/tauri/bindings';

type ScreenshotShareStoreState = {
    targets: ScreenshotShareTarget[];
    loaded: boolean;
    sending: boolean;
    setSending(sending: boolean): void;
    load(): Promise<ScreenshotShareTarget[]>;
    save(input: ScreenshotShareTargetInput): Promise<ScreenshotShareTarget>;
    remove(id: string): Promise<void>;
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
        async load() {
            const targets = await commands.appGetScreenshotShareTargets();
            set({ targets, loaded: true });
            return targets;
        },
        async save(input) {
            const saved = await commands.appSaveScreenshotShareTarget(input);
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
            return saved;
        },
        async remove(id) {
            await commands.appDeleteScreenshotShareTarget(id);
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
