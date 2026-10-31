import { replaceEqualDeep } from '@tanstack/react-query';
import { create } from 'zustand';

import type {
    FriendMutualStats,
    FriendStatsById
} from '@/domain/friends/friendStats';

type FriendStatsState = {
    ownerUserId: string | null;
    byUserId: FriendStatsById;
    replaceStats(ownerUserId: string, byUserId: FriendStatsById): void;
    applyMutualStats(
        ownerUserId: string,
        mutualById: Record<string, FriendMutualStats>
    ): void;
    markSeen(
        ownerUserId: string,
        userIds: readonly string[],
        seenAt: string
    ): void;
    reset(): void;
};

export const useFriendStatsStore = create<FriendStatsState>((set) => ({
    ownerUserId: null,
    byUserId: {},
    replaceStats(ownerUserId, byUserId) {
        set((state) => ({
            ownerUserId,
            byUserId: replaceEqualDeep(
                state.ownerUserId === ownerUserId ? state.byUserId : {},
                byUserId
            )
        }));
    },
    applyMutualStats(ownerUserId, mutualById) {
        set((state) => {
            const previous =
                state.ownerUserId === ownerUserId ? state.byUserId : {};
            const next: FriendStatsById = { ...previous };
            for (const [userId, mutual] of Object.entries(mutualById)) {
                next[userId] = { ...previous[userId], ...mutual };
            }
            return {
                ownerUserId,
                byUserId: replaceEqualDeep(previous, next)
            };
        });
    },
    markSeen(ownerUserId, userIds, seenAt) {
        set((state) => {
            if (state.ownerUserId !== ownerUserId) {
                return state;
            }
            const seenAtMs = Date.parse(seenAt);
            if (Number.isNaN(seenAtMs)) {
                return state;
            }
            let next: FriendStatsById | null = null;
            for (const userId of userIds) {
                const stats = state.byUserId[userId];
                if (
                    !stats ||
                    (stats.lastSeen && Date.parse(stats.lastSeen) >= seenAtMs)
                ) {
                    continue;
                }
                next ??= { ...state.byUserId };
                next[userId] = { ...stats, lastSeen: seenAt };
            }
            return next ? { byUserId: next } : state;
        });
    },
    reset() {
        set({ ownerUserId: null, byUserId: {} });
    }
}));
