import { beforeEach, describe, expect, it } from 'vitest';

import { useFavoriteRevisionStore } from './favoriteRevisionStore';

describe('favoriteRevisionStore', () => {
    beforeEach(() => {
        useFavoriteRevisionStore.setState({
            revision: 0,
            lastAttemptedRevision: 0,
            pendingRemote: false,
            pendingUnknown: false
        });
    });

    it('increments revision on every bump regardless of change shape', () => {
        const store = useFavoriteRevisionStore.getState();

        store.bumpRevision({ kind: 'world', remote: false });
        store.bumpRevision({ kind: 'friend', remote: true });

        expect(useFavoriteRevisionStore.getState().revision).toBe(2);
    });

    it('accumulates the remote flag across multiple bumps until consumed', () => {
        const store = useFavoriteRevisionStore.getState();

        store.bumpRevision({ kind: 'world', remote: false });
        store.bumpRevision({ kind: 'avatar', remote: true });

        expect(useFavoriteRevisionStore.getState().pendingRemote).toBe(true);
    });

    it('accumulates the unknown flag across multiple bumps until consumed', () => {
        const store = useFavoriteRevisionStore.getState();

        store.bumpRevision({ kind: 'friend', remote: false });
        store.bumpRevision({ kind: 'unknown', remote: false });

        expect(useFavoriteRevisionStore.getState().pendingUnknown).toBe(true);
    });

    it('does not set pending flags for a known kind with remote false', () => {
        const store = useFavoriteRevisionStore.getState();

        store.bumpRevision({ kind: 'avatar', remote: false });

        expect(useFavoriteRevisionStore.getState()).toMatchObject({
            pendingRemote: false,
            pendingUnknown: false
        });
    });

    it('acknowledges only the exact revision that completed', () => {
        const store = useFavoriteRevisionStore.getState();
        store.bumpRevision({ kind: 'unknown', remote: true });
        const pending = useFavoriteRevisionStore.getState().getPending();

        store.bumpRevision({ kind: 'avatar', remote: true });
        useFavoriteRevisionStore.getState().acknowledge(pending.revision);

        expect(useFavoriteRevisionStore.getState()).toMatchObject({
            revision: 2,
            pendingRemote: true,
            pendingUnknown: true
        });
    });

    it('clears pending flags after the exact revision is acknowledged', () => {
        const store = useFavoriteRevisionStore.getState();
        store.bumpRevision({ kind: 'unknown', remote: true });
        const pending = useFavoriteRevisionStore.getState().getPending();

        useFavoriteRevisionStore.getState().acknowledge(pending.revision);

        expect(useFavoriteRevisionStore.getState()).toMatchObject({
            pendingRemote: false,
            pendingUnknown: false
        });
    });

    it('tracks attempts without consuming pending changes', () => {
        const store = useFavoriteRevisionStore.getState();
        store.bumpRevision({ kind: 'world', remote: true });

        useFavoriteRevisionStore.getState().markAttempted(1);

        expect(useFavoriteRevisionStore.getState()).toMatchObject({
            lastAttemptedRevision: 1,
            pendingRemote: true
        });
    });

    it('invalidates stale acknowledgements at the auth boundary', () => {
        const store = useFavoriteRevisionStore.getState();
        store.bumpRevision({ kind: 'world', remote: true });
        const oldPending = useFavoriteRevisionStore.getState().getPending();

        useFavoriteRevisionStore.getState().reset();
        useFavoriteRevisionStore
            .getState()
            .bumpRevision({ kind: 'avatar', remote: true });
        useFavoriteRevisionStore.getState().acknowledge(oldPending.revision);

        expect(useFavoriteRevisionStore.getState()).toMatchObject({
            revision: 3,
            lastAttemptedRevision: 2,
            pendingRemote: true,
            pendingUnknown: false
        });
    });
});
