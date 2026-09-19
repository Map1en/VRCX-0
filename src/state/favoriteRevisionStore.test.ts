import { beforeEach, describe, expect, it } from 'vitest';

import { useFavoriteRevisionStore } from './favoriteRevisionStore';

describe('favoriteRevisionStore', () => {
    beforeEach(() => {
        useFavoriteRevisionStore.setState({
            revision: 0,
            localWorldRevision: 0,
            worldDetailsRevision: 0,
            remoteDetailsRevisionByKind: {
                avatar: 0,
                world: 0
            },
            lastAttemptedRevision: 0,
            pendingRemote: false,
            pendingUnknown: false
        });
    });

    it('increments revision on every bump regardless of change shape', () => {
        const store = useFavoriteRevisionStore.getState();

        store.bumpRevision({
            kind: 'world',
            local: true,
            remote: false,
            requiresRefresh: true
        });
        store.bumpRevision({
            kind: 'friend',
            local: false,
            remote: true,
            requiresRefresh: true
        });

        expect(useFavoriteRevisionStore.getState().revision).toBe(2);
    });

    it('increments the local world revision only for matching local changes', () => {
        const store = useFavoriteRevisionStore.getState();

        store.bumpRevision({
            kind: 'world',
            local: true,
            remote: false,
            requiresRefresh: true
        });
        store.bumpRevision({
            kind: 'world',
            local: false,
            remote: true,
            requiresRefresh: true
        });
        store.bumpRevision({
            kind: 'avatar',
            local: true,
            remote: false,
            requiresRefresh: true
        });
        store.bumpRevision({
            kind: 'unknown',
            local: true,
            remote: false,
            requiresRefresh: true
        });

        expect(useFavoriteRevisionStore.getState().localWorldRevision).toBe(2);
    });

    it('invalidates favorite world details independently', () => {
        useFavoriteRevisionStore.getState().bumpWorldDetailsRevision();

        expect(useFavoriteRevisionStore.getState()).toMatchObject({
            revision: 0,
            localWorldRevision: 0,
            worldDetailsRevision: 1,
            pendingRemote: false
        });
    });

    it('invalidates both local world data and remote details for a mixed change', () => {
        useFavoriteRevisionStore.getState().bumpRevision({
            kind: 'world',
            local: true,
            remote: true,
            requiresRefresh: true
        });

        expect(useFavoriteRevisionStore.getState()).toMatchObject({
            localWorldRevision: 1,
            remoteDetailsRevisionByKind: {
                avatar: 0,
                world: 1
            },
            pendingRemote: true
        });
    });

    it('accumulates the remote flag across multiple bumps until consumed', () => {
        const store = useFavoriteRevisionStore.getState();

        store.bumpRevision({
            kind: 'world',
            local: true,
            remote: false,
            requiresRefresh: true
        });
        store.bumpRevision({
            kind: 'avatar',
            local: false,
            remote: true,
            requiresRefresh: true
        });

        expect(useFavoriteRevisionStore.getState().pendingRemote).toBe(true);
    });

    it('accumulates the unknown flag across multiple bumps until consumed', () => {
        const store = useFavoriteRevisionStore.getState();

        store.bumpRevision({
            kind: 'friend',
            local: true,
            remote: false,
            requiresRefresh: true
        });
        store.bumpRevision({
            kind: 'unknown',
            local: true,
            remote: false,
            requiresRefresh: true
        });

        expect(useFavoriteRevisionStore.getState().pendingUnknown).toBe(true);
    });

    it('does not set pending flags for a known kind with remote false', () => {
        const store = useFavoriteRevisionStore.getState();

        store.bumpRevision({
            kind: 'avatar',
            local: true,
            remote: false,
            requiresRefresh: true
        });

        expect(useFavoriteRevisionStore.getState()).toMatchObject({
            pendingRemote: false,
            pendingUnknown: false
        });
    });

    it('invalidates remote details only for the affected kind', () => {
        const store = useFavoriteRevisionStore.getState();

        store.bumpRevision({
            kind: 'world',
            local: false,
            remote: true,
            requiresRefresh: false
        });

        expect(
            useFavoriteRevisionStore.getState().remoteDetailsRevisionByKind
        ).toEqual({
            avatar: 0,
            world: 1
        });
    });

    it('invalidates both remote detail kinds for an unknown remote change', () => {
        const store = useFavoriteRevisionStore.getState();

        store.bumpRevision({
            kind: 'unknown',
            local: false,
            remote: true,
            requiresRefresh: false
        });

        expect(
            useFavoriteRevisionStore.getState().remoteDetailsRevisionByKind
        ).toEqual({
            avatar: 1,
            world: 1
        });
    });

    it('acknowledges only the exact revision that completed', () => {
        const store = useFavoriteRevisionStore.getState();
        store.bumpRevision({
            kind: 'unknown',
            local: false,
            remote: true,
            requiresRefresh: true
        });
        const pending = useFavoriteRevisionStore.getState().getPending();

        store.bumpRevision({
            kind: 'avatar',
            local: false,
            remote: true,
            requiresRefresh: true
        });
        useFavoriteRevisionStore.getState().acknowledge(pending.revision);

        expect(useFavoriteRevisionStore.getState()).toMatchObject({
            revision: 2,
            pendingRemote: true,
            pendingUnknown: true
        });
    });

    it('clears pending flags after the exact revision is acknowledged', () => {
        const store = useFavoriteRevisionStore.getState();
        store.bumpRevision({
            kind: 'unknown',
            local: false,
            remote: true,
            requiresRefresh: true
        });
        const pending = useFavoriteRevisionStore.getState().getPending();

        useFavoriteRevisionStore.getState().acknowledge(pending.revision);

        expect(useFavoriteRevisionStore.getState()).toMatchObject({
            pendingRemote: false,
            pendingUnknown: false
        });
    });

    it('tracks attempts without consuming pending changes', () => {
        const store = useFavoriteRevisionStore.getState();
        store.bumpRevision({
            kind: 'world',
            local: false,
            remote: true,
            requiresRefresh: true
        });

        useFavoriteRevisionStore.getState().markAttempted(1);

        expect(useFavoriteRevisionStore.getState()).toMatchObject({
            lastAttemptedRevision: 1,
            pendingRemote: true
        });
    });

    it('invalidates stale acknowledgements at the auth boundary', () => {
        const store = useFavoriteRevisionStore.getState();
        store.bumpRevision({
            kind: 'world',
            local: false,
            remote: true,
            requiresRefresh: true
        });
        const oldPending = useFavoriteRevisionStore.getState().getPending();

        useFavoriteRevisionStore.getState().reset();
        useFavoriteRevisionStore.getState().bumpRevision({
            kind: 'avatar',
            local: false,
            remote: true,
            requiresRefresh: true
        });
        useFavoriteRevisionStore.getState().acknowledge(oldPending.revision);

        expect(useFavoriteRevisionStore.getState()).toMatchObject({
            revision: 3,
            lastAttemptedRevision: 2,
            pendingRemote: true,
            pendingUnknown: false
        });
    });

    it('does not schedule refresh work for an exact event delta', () => {
        useFavoriteRevisionStore.getState().bumpRevision({
            kind: 'unknown',
            local: false,
            remote: true,
            requiresRefresh: false
        });

        expect(useFavoriteRevisionStore.getState()).toMatchObject({
            revision: 1,
            localWorldRevision: 0,
            pendingRemote: false,
            pendingUnknown: false
        });
    });
});
