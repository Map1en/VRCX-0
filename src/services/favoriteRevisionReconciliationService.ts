import { useFavoriteRevisionStore } from '@/state/favoriteRevisionStore';

export async function reconcilePendingFavoriteRevision(
    refreshFavorites: (options: { silent: boolean }) => Promise<boolean>
): Promise<void> {
    const revisionStore = useFavoriteRevisionStore.getState();
    const pending = revisionStore.getPending();
    if (
        (!pending.remote && !pending.unknown) ||
        pending.revision <= revisionStore.lastAttemptedRevision
    ) {
        return;
    }

    revisionStore.markAttempted(pending.revision);
    if (await refreshFavorites({ silent: true })) {
        useFavoriteRevisionStore.getState().acknowledge(pending.revision);
    }
}
