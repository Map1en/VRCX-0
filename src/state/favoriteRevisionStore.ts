import { create } from 'zustand';

export type FavoriteRevisionKind = 'friend' | 'world' | 'avatar' | 'unknown';

interface FavoritePendingRevision {
    remote: boolean;
    unknown: boolean;
}

interface FavoriteRevisionStoreState {
    revision: number;
    pendingRemote: boolean;
    pendingUnknown: boolean;
    bumpRevision(change: { kind: FavoriteRevisionKind; remote: boolean }): void;
    consumePending(): FavoritePendingRevision;
}

export const useFavoriteRevisionStore = create<FavoriteRevisionStoreState>(
    (set, get) => ({
        revision: 0,
        pendingRemote: false,
        pendingUnknown: false,
        bumpRevision({ kind, remote }) {
            set((state) => ({
                revision: state.revision + 1,
                pendingRemote: state.pendingRemote || remote,
                pendingUnknown: state.pendingUnknown || kind === 'unknown'
            }));
        },
        consumePending() {
            const { pendingRemote, pendingUnknown } = get();
            set({ pendingRemote: false, pendingUnknown: false });
            return { remote: pendingRemote, unknown: pendingUnknown };
        }
    })
);

export type { FavoritePendingRevision };
