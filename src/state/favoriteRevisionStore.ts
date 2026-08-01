import { create } from 'zustand';

export type FavoriteRevisionKind = 'friend' | 'world' | 'avatar' | 'unknown';

interface FavoritePendingRevision {
    revision: number;
    remote: boolean;
    unknown: boolean;
}

interface FavoriteRevisionStoreState {
    revision: number;
    lastAttemptedRevision: number;
    pendingRemote: boolean;
    pendingUnknown: boolean;
    bumpRevision(change: { kind: FavoriteRevisionKind; remote: boolean }): void;
    getPending(): FavoritePendingRevision;
    markAttempted(revision: number): void;
    acknowledge(revision: number): void;
    reset(): void;
}

const initialState = {
    revision: 0,
    lastAttemptedRevision: 0,
    pendingRemote: false,
    pendingUnknown: false
};

export const useFavoriteRevisionStore = create<FavoriteRevisionStoreState>(
    (set, get) => ({
        ...initialState,
        bumpRevision({ kind, remote }) {
            set((state) => ({
                revision: state.revision + 1,
                pendingRemote: state.pendingRemote || remote,
                pendingUnknown: state.pendingUnknown || kind === 'unknown'
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
                    lastAttemptedRevision: revision,
                    pendingRemote: false,
                    pendingUnknown: false
                };
            });
        }
    })
);

export type { FavoritePendingRevision };
