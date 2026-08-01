import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useFavoriteRevisionStore } from '@/state/favoriteRevisionStore';

import { reconcilePendingFavoriteRevision } from './favoriteRevisionReconciliationService';

describe('favoriteRevisionReconciliationService', () => {
    beforeEach(() => {
        useFavoriteRevisionStore.setState({
            revision: 0,
            lastAttemptedRevision: 0,
            pendingRemote: false,
            pendingUnknown: false
        });
    });

    it('retains an event that arrives while an earlier revision refreshes', async () => {
        let finishRefresh: (refreshed: boolean) => void = () => undefined;
        const refreshFavorites = vi.fn(
            () =>
                new Promise<boolean>((resolve) => {
                    finishRefresh = resolve;
                })
        );
        useFavoriteRevisionStore
            .getState()
            .bumpRevision({ kind: 'world', remote: true });

        const reconciliation =
            reconcilePendingFavoriteRevision(refreshFavorites);
        useFavoriteRevisionStore
            .getState()
            .bumpRevision({ kind: 'avatar', remote: true });
        finishRefresh(true);
        await reconciliation;

        expect(useFavoriteRevisionStore.getState()).toMatchObject({
            revision: 2,
            lastAttemptedRevision: 1,
            pendingRemote: true
        });

        await reconcilePendingFavoriteRevision(vi.fn().mockResolvedValue(true));

        expect(useFavoriteRevisionStore.getState()).toMatchObject({
            lastAttemptedRevision: 2,
            pendingRemote: false,
            pendingUnknown: false
        });
    });

    it('keeps a failed revision pending without retrying it immediately', async () => {
        const refreshFavorites = vi.fn().mockResolvedValue(false);
        useFavoriteRevisionStore
            .getState()
            .bumpRevision({ kind: 'unknown', remote: false });

        await reconcilePendingFavoriteRevision(refreshFavorites);
        await reconcilePendingFavoriteRevision(refreshFavorites);

        expect(refreshFavorites).toHaveBeenCalledTimes(1);
        expect(useFavoriteRevisionStore.getState()).toMatchObject({
            lastAttemptedRevision: 1,
            pendingUnknown: true
        });
    });
});
