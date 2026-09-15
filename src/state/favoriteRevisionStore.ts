import { create } from 'zustand';

import type { FavoriteChangeScope } from '@/platform/tauri/bindings';

interface FavoritePendingRevision {
    revision: number;
    remote: boolean;
    unknown: boolean;
}

interface FavoriteRevisionStoreState {
    revision: number;
    localWorldRevision: number;
    remoteDetailsRevisionByKind: Record<'avatar' | 'world', number>;
    lastAttemptedRevision: number;
    pendingRemote: boolean;
    pendingUnknown: boolean;
    bumpRevision(change: {
        kind: FavoriteChangeScope;
        local: boolean;
        remote: boolean;
        requiresRefresh: boolean;
    }): void;
    getPending(): FavoritePendingRevision;
    markAttempted(revision: number): void;
    acknowledge(revision: number): void;
    reset(): void;
}

const initialState = {
    revision: 0,
    localWorldRevision: 0,
    remoteDetailsRevisionByKind: {
        avatar: 0,
        world: 0
    },
    lastAttemptedRevision: 0,
    pendingRemote: false,
    pendingUnknown: false
};

export const useFavoriteRevisionStore = create<FavoriteRevisionStoreState>(
    (set, get) => ({
        ...initialState,
        bumpRevision({ kind, local, remote, requiresRefresh }) {
            set((state) => ({
                revision: state.revision + 1,
                localWorldRevision:
                    requiresRefresh &&
                    local &&
                    (kind === 'world' || kind === 'unknown')
                        ? state.localWorldRevision + 1
                        : state.localWorldRevision,
                remoteDetailsRevisionByKind: {
                    avatar:
                        remote && (kind === 'avatar' || kind === 'unknown')
                            ? state.remoteDetailsRevisionByKind.avatar + 1
                            : state.remoteDetailsRevisionByKind.avatar,
                    world:
                        remote && (kind === 'world' || kind === 'unknown')
                            ? state.remoteDetailsRevisionByKind.world + 1
                            : state.remoteDetailsRevisionByKind.world
                },
                pendingRemote:
                    state.pendingRemote || (requiresRefresh && remote),
                pendingUnknown:
                    state.pendingUnknown ||
                    (requiresRefresh && kind === 'unknown')
            }));
        },
        getPending() {
            const { revision, pendingRemote, pendingUnknown } = get();
            return {
                revision,
                remote: pendingRemote,
                unknown: pendingUnknown
            };
        },
        markAttempted(revision) {
            set((state) => ({
                lastAttemptedRevision: Math.max(
                    state.lastAttemptedRevision,
                    revision
                )
            }));
        },
        acknowledge(revision) {
            set((state) =>
                state.revision === revision
                    ? {
                          pendingRemote: false,
                          pendingUnknown: false
                      }
                    : state
            );
        },
        reset() {
            set((state) => {
                const revision = state.revision + 1;
                return {
                    revision,
                    localWorldRevision: state.localWorldRevision + 1,
                    remoteDetailsRevisionByKind: {
                        avatar: state.remoteDetailsRevisionByKind.avatar + 1,
                        world: state.remoteDetailsRevisionByKind.world + 1
                    },
                    lastAttemptedRevision: revision,
                    pendingRemote: false,
                    pendingUnknown: false
                };
            });
        }
    })
);
