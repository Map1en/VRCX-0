import { create } from 'zustand';

import type { FriendLocationTime } from '@/platform/tauri/bindings';

export type FriendLocationTimeEntry = Omit<FriendLocationTime, 'userId'>;

type FriendLocationTimeState = {
    byUserId: Record<string, FriendLocationTimeEntry>;
    replaceSnapshot(snapshot: readonly FriendLocationTime[]): void;
    reset(): void;
};

const initialState = {
    byUserId: {}
};

export const useFriendLocationTimeStore = create<FriendLocationTimeState>(
    (set, get) => ({
        ...initialState,
        replaceSnapshot(snapshot) {
            const previousByUserId = get().byUserId;
            const byUserId: Record<string, FriendLocationTimeEntry> = {};
            let changed = false;
            for (const entry of snapshot) {
                const userId = entry.userId.trim();
                if (!userId) {
                    continue;
                }
                const parsedSinceMs = Number(entry.sinceMs);
                const location = entry.location.trim();
                const sinceMs =
                    Number.isFinite(parsedSinceMs) && parsedSinceMs > 0
                        ? parsedSinceMs
                        : null;
                const previous = previousByUserId[userId];
                if (
                    previous &&
                    previous.location === location &&
                    previous.source === entry.source &&
                    previous.sinceMs === sinceMs
                ) {
                    byUserId[userId] = previous;
                    continue;
                }
                changed = true;
                byUserId[userId] = { location, source: entry.source, sinceMs };
            }
            if (
                !changed &&
                Object.keys(byUserId).length ===
                    Object.keys(previousByUserId).length
            ) {
                return;
            }
            set({ byUserId });
        },
        reset() {
            set(initialState);
        }
    })
);
