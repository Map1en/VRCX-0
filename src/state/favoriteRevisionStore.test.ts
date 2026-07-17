import { beforeEach, describe, expect, it } from 'vitest';

import { useFavoriteRevisionStore } from './favoriteRevisionStore';

describe('favoriteRevisionStore', () => {
    beforeEach(() => {
        useFavoriteRevisionStore.setState({
            revision: 0,
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

    it('consumePending returns the accumulated flags and clears them', () => {
        const store = useFavoriteRevisionStore.getState();
        store.bumpRevision({ kind: 'unknown', remote: true });

        const pending = store.consumePending();

        expect(pending).toEqual({ remote: true, unknown: true });
        expect(useFavoriteRevisionStore.getState()).toMatchObject({
            pendingRemote: false,
            pendingUnknown: false
        });
    });

    it('consumePending returns false flags when nothing is pending', () => {
        const store = useFavoriteRevisionStore.getState();

        const pending = store.consumePending();

        expect(pending).toEqual({ remote: false, unknown: false });
    });
});
