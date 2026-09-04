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
    (set) => ({
        ...initialState,
        replaceSnapshot(snapshot) {
            const byUserId: Record<string, FriendLocationTimeEntry> = {};
            for (const entry of snapshot) {
                const userId = entry.userId.trim();
                if (!userId) {
                    continue;
                }
                const sinceMs = Number(entry.sinceMs);
                byUserId[userId] = {
                    location: entry.location.trim(),
                    source: entry.source,
                    sinceMs:
                        Number.isFinite(sinceMs) && sinceMs > 0 ? sinceMs : null
                };
            }
            set({ byUserId });
        },
        reset() {
            set(initialState);
        }
    })
);
