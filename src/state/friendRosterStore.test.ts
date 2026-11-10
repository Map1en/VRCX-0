import { beforeEach, describe, expect, it } from 'vitest';

import type { PresenceEntry } from '@/platform/tauri/bindings';
import { onlinePresence } from '@/test/presenceFixtures';

import { useFriendRosterStore } from './friendRosterStore';

const offline = (rev: number): PresenceEntry => ({
    rev,
    view: { kind: 'offline' }
});
const active = (rev: number): PresenceEntry => ({
    rev,
    view: { kind: 'active', platform: 'web' }
});
const online = (rev: number, tag = 'wrld_a:1'): PresenceEntry => ({
    rev,
    view: onlinePresence(tag)
});

describe('friendRosterStore', () => {
    beforeEach(() => {
        useFriendRosterStore.getState().resetRoster();
    });

    it('retains unchanged profile references when a presence field changes', () => {
        const store = useFriendRosterStore.getState();
        store.applyFriendPatch({
            userId: 'usr_shared',
            presence: online(1),
            patch: {
                tags: ['system_trust_basic'],
                badges: [{ badgeId: 'badge_one' }],
                $location: { worldId: 'wrld_one' },
                externalMetadata: { nested: ['preserved'] }
            }
        });
        const previous = useFriendRosterStore.getState().friendsById.usr_shared;
        store.applyFriendPatch({
            userId: 'usr_shared',
            patch: { statusDescription: 'new status' }
        });
        const next = useFriendRosterStore.getState().friendsById.usr_shared;
        expect(next).not.toBe(previous);
        expect(next.statusDescription).toBe('new status');
        expect(next.$presence).toBe(previous.$presence);
        expect(next.tags).toBe(previous.tags);
        expect(next.badges).toBe(previous.badges);
        expect(next.$location).toBe(previous.$location);
        expect(next.externalMetadata).toBe(previous.externalMetadata);
    });

    it('preserves open nested fields and reuses equal patch data', () => {
        const store = useFriendRosterStore.getState();
        const patch = {
            externalMetadata: { nested: { value: 'before' }, unchanged: [1, 2] }
        };
        store.applyFriendPatch({ userId: 'usr_extra', patch });
        const previousState = useFriendRosterStore.getState();
        store.applyFriendPatches([
            { userId: 'usr_extra', patch: structuredClone(patch) }
        ]);
        expect(useFriendRosterStore.getState()).toBe(previousState);
        store.applyFriendPatch({
            userId: 'usr_extra',
            patch: {
                externalMetadata: {
                    nested: null,
                    unchanged: [1, 2],
                    added: true
                }
            }
        });
        const next = useFriendRosterStore.getState().friendsById.usr_extra;
        expect(next.externalMetadata).toEqual({
            nested: null,
            unchanged: [1, 2],
            added: true
        });
        expect(previousState.friendsById.usr_extra.externalMetadata).toEqual(
            patch.externalMetadata
        );
    });

    it('moves from loading to ready and orders friends within state buckets', () => {
        const store = useFriendRosterStore.getState();

        store.setRosterLoading('usr_current', 'loading friends');
        expect(useFriendRosterStore.getState()).toMatchObject({
            currentUserId: 'usr_current',
            loadStatus: 'running',
            detail: 'loading friends'
        });
        expect(useFriendRosterStore.getState().friendsById).toEqual({});

        store.applyFriendPatches(
            [
                {
                    userId: ' usr_b ',
                    presence: {
                        rev: 1,
                        view: onlinePresence('wrld_a:1', 'android')
                    },
                    patch: {
                        id: 'usr_b',
                        displayName: 'Bravo',
                        friendNumber: 2,
                        tags: ['system_trust_basic']
                    }
                },
                {
                    userId: 'usr_a',
                    presence: online(1),
                    patch: {
                        id: 'usr_a',
                        displayName: 'Alpha',
                        friendNumber: 1,
                        tags: []
                    }
                },
                {
                    userId: 'usr_c',
                    presence: active(1),
                    patch: {
                        id: 'usr_c',
                        displayName: 'Charlie',
                        tags: ['system_trust_known']
                    }
                },
                {
                    userId: 'usr_d',
                    presence: offline(1),
                    patch: {
                        id: 'usr_d',
                        displayName: 'Delta',
                        tags: []
                    }
                }
            ],
            'patch applied'
        );

        const state = useFriendRosterStore.getState();

        expect(state.loadStatus).toBe('running');
        expect(state.detail).toBe('patch applied');
        expect(state.onlineIds).toEqual(['usr_a', 'usr_b']);
        expect(state.activeIds).toEqual(['usr_c']);
        expect(state.offlineIds).toEqual(['usr_d']);
        expect(state.orderedFriendIds).toEqual([
            'usr_a',
            'usr_b',
            'usr_c',
            'usr_d'
        ]);
        expect(state.friendsById.usr_b).toMatchObject({
            id: 'usr_b',
            displayName: 'Bravo',
            friendNumber: 2,
            $trustClass: 'x-tag-basic',
            $platform: 'android'
        });
    });

    it('takes the backend friend number from a later patch', () => {
        const store = useFriendRosterStore.getState();
        store.applyFriendPatch({
            userId: 'usr_new',
            presence: online(1),
            patch: { id: 'usr_new', displayName: 'New', $friendNumber: 0 }
        });
        store.applyFriendPatch({
            userId: 'usr_new',
            presence: online(2),
            patch: { id: 'usr_new', displayName: 'New', $friendNumber: 42 }
        });

        expect(
            useFriendRosterStore.getState().friendsById.usr_new
        ).toMatchObject({ friendNumber: 42, $friendNumber: 42 });
    });

    it('creates a ready fallback entry when a patch arrives before bootstrap', () => {
        useFriendRosterStore.getState().applyFriendPatch({
            userId: 'usr_new',
            presence: online(1),
            patch: {
                displayName: 'New Friend'
            }
        });

        expect(useFriendRosterStore.getState()).toMatchObject({
            loadStatus: 'ready',
            onlineIds: ['usr_new'],
            orderedFriendIds: ['usr_new'],
            friendsById: {
                usr_new: {
                    id: 'usr_new',
                    displayName: 'New Friend',
                    $presence: online(1).view
                }
            }
        });
    });

    it('returns the same state reference for a no-op patch on an unchanged friend', () => {
        const store = useFriendRosterStore.getState();
        store.applyFriendPatch({
            userId: 'usr_stable',
            presence: online(1),
            patch: {
                id: 'usr_stable',
                displayName: 'Stable Friend'
            }
        });

        const stateBefore = useFriendRosterStore.getState();
        store.applyFriendPatch({
            userId: 'usr_stable',
            presence: online(1),
            patch: {
                id: 'usr_stable',
                displayName: 'Stable Friend'
            }
        });
        const stateAfter = useFriendRosterStore.getState();

        expect(stateAfter).toBe(stateBefore);
        expect(stateAfter.friendsById.usr_stable).toBe(
            stateBefore.friendsById.usr_stable
        );
    });

    it('returns the same state reference for a no-op patch batch', () => {
        const store = useFriendRosterStore.getState();
        store.applyFriendPatches([
            {
                userId: 'usr_stable',
                presence: online(1),
                patch: {
                    id: 'usr_stable',
                    displayName: 'Stable Friend'
                }
            }
        ]);

        const stateBefore = useFriendRosterStore.getState();
        store.applyFriendPatches([
            {
                userId: 'usr_stable',
                presence: online(1),
                patch: {
                    id: 'usr_stable',
                    displayName: 'Stable Friend'
                }
            }
        ]);
        const stateAfter = useFriendRosterStore.getState();

        expect(stateAfter).toBe(stateBefore);
        expect(stateAfter.friendsById.usr_stable).toBe(
            stateBefore.friendsById.usr_stable
        );
    });

    it('keeps the section for profile-only friend patches', () => {
        const store = useFriendRosterStore.getState();
        store.applyFriendPatch({
            userId: 'usr_friend',
            presence: online(1),
            patch: { id: 'usr_friend', displayName: 'Friend' }
        });

        store.applyFriendPatch({
            userId: 'usr_friend',
            patch: { id: 'usr_friend', statusDescription: 'afk' }
        });

        expect(useFriendRosterStore.getState()).toMatchObject({
            onlineIds: ['usr_friend'],
            offlineIds: [],
            friendsById: {
                usr_friend: {
                    statusDescription: 'afk',
                    $presence: online(1).view
                }
            }
        });
    });

    it('moves a friend between sections when its presence changes', () => {
        const store = useFriendRosterStore.getState();
        store.applyFriendPatch({
            userId: 'usr_friend',
            presence: online(1),
            patch: { id: 'usr_friend' }
        });
        store.applyFriendPatch({
            userId: 'usr_friend',
            presence: offline(2),
            patch: {}
        });

        expect(useFriendRosterStore.getState()).toMatchObject({
            onlineIds: [],
            offlineIds: ['usr_friend']
        });
    });

    it('removes friends and rebuilds bucket ordering', () => {
        const store = useFriendRosterStore.getState();

        store.applyFriendPatches([
            {
                userId: 'usr_a',
                presence: online(1),
                patch: { id: 'usr_a', displayName: 'Alpha' }
            },
            {
                userId: 'usr_b',
                presence: active(1),
                patch: { id: 'usr_b', displayName: 'Bravo' }
            }
        ]);
        store.removeFriend(' usr_a ', 'removed');

        expect(useFriendRosterStore.getState()).toMatchObject({
            detail: 'removed',
            onlineIds: [],
            activeIds: ['usr_b'],
            orderedFriendIds: ['usr_b']
        });
    });

    it('keeps the newest presence revision within a generation', () => {
        const store = useFriendRosterStore.getState();
        store.applyFriendPatches([
            {
                userId: 'usr_a',
                patch: {},
                presence: active(5),
                generation: 1
            }
        ]);
        store.applyFriendPatches([
            {
                userId: 'usr_a',
                patch: {},
                presence: offline(4),
                generation: 1
            }
        ]);

        const state = useFriendRosterStore.getState();
        expect(state.presenceRevById.usr_a).toBe(5);
        expect(state.friendsById.usr_a.$presence).toEqual(active(5).view);
        expect(state.friendsById.usr_a.$presence).toEqual(active(5).view);
    });

    it('accepts presence from a newer generation even with a lower revision', () => {
        const store = useFriendRosterStore.getState();
        store.applyFriendPatches([
            {
                userId: 'usr_a',
                patch: {},
                presence: active(9),
                generation: 1
            }
        ]);
        store.applyFriendPatches([
            {
                userId: 'usr_a',
                patch: {},
                presence: offline(1),
                generation: 2
            }
        ]);

        const state = useFriendRosterStore.getState();
        expect(state.presenceRevById.usr_a).toBe(1);
        expect(state.friendsById.usr_a.$presence).toEqual(offline(1).view);
        expect(state.presenceGeneration).toBe(2);
    });

    it('keeps newer patched friends when a same-generation snapshot is older', () => {
        const store = useFriendRosterStore.getState();
        store.applyFriendPatches([
            {
                userId: 'usr_a',
                patch: { id: 'usr_a' },
                presence: active(9),
                generation: 2
            }
        ]);
        store.setRosterSnapshot({
            currentUserId: 'usr_self',
            friendsById: {
                usr_a: { id: 'usr_a' },
                usr_b: { id: 'usr_b' }
            },
            presenceById: { usr_a: offline(3), usr_b: offline(3) },
            generation: 2
        });

        const state = useFriendRosterStore.getState();
        expect(state.friendsById.usr_a.$presence).toEqual(active(9).view);
        expect(state.presenceRevById.usr_a).toBe(9);
        expect(state.friendsById.usr_a.$presence).toEqual(active(9).view);
        expect(state.presenceRevById.usr_b).toBe(3);
        expect(state.friendsById.usr_b.$presence).toEqual(offline(3).view);
        expect(state.activeIds).toEqual(['usr_a']);
        expect(state.offlineIds).toEqual(['usr_b']);
    });

    it('replaces presence from a snapshot of a new generation', () => {
        const store = useFriendRosterStore.getState();
        store.applyFriendPatches([
            {
                userId: 'usr_a',
                patch: { id: 'usr_a' },
                presence: active(9),
                generation: 2
            }
        ]);
        store.setRosterSnapshot({
            currentUserId: 'usr_self',
            friendsById: { usr_a: { id: 'usr_a' } },
            presenceById: { usr_a: offline(0) },
            generation: 3
        });

        const state = useFriendRosterStore.getState();
        expect(state.friendsById.usr_a.$presence).toEqual(offline(0).view);
        expect(state.presenceRevById.usr_a).toBe(0);
        expect(state.friendsById.usr_a.$presence).toEqual(offline(0).view);
        expect(state.presenceGeneration).toBe(3);
    });

    it('ignores a snapshot from an older generation', () => {
        const store = useFriendRosterStore.getState();
        store.applyFriendPatches([
            {
                userId: 'usr_a',
                patch: { id: 'usr_a' },
                presence: active(9),
                generation: 3
            }
        ]);
        store.setRosterSnapshot({
            currentUserId: 'usr_self',
            friendsById: { usr_a: { id: 'usr_a' } },
            presenceById: { usr_a: offline(0) },
            generation: 2
        });

        const state = useFriendRosterStore.getState();
        expect(state.presenceRevById.usr_a).toBe(9);
        expect(state.friendsById.usr_a.$presence).toEqual(active(9).view);
        expect(state.presenceGeneration).toBe(3);
    });

    it('leaves presence untouched for local annotation patches', () => {
        const store = useFriendRosterStore.getState();
        store.applyFriendPatches([
            {
                userId: 'usr_a',
                patch: {},
                presence: active(5),
                generation: 1
            }
        ]);
        store.applyFriendPatch({
            userId: 'usr_a',
            patch: { memo: 'note' }
        });

        const state = useFriendRosterStore.getState();
        expect(state.presenceRevById.usr_a).toBe(5);
        expect(state.friendsById.usr_a.$presence).toEqual(active(5).view);
        expect(state.friendsById.usr_a.memo).toBe('note');
    });

    it('exposes the current presence view on each friend record', () => {
        const store = useFriendRosterStore.getState();
        store.applyFriendPatches([
            {
                userId: 'usr_a',
                patch: { id: 'usr_a' },
                presence: active(5),
                generation: 1
            }
        ]);
        expect(
            useFriendRosterStore.getState().friendsById.usr_a.$presence
        ).toEqual(active(5).view);

        store.setRosterSnapshot({
            currentUserId: 'usr_self',
            friendsById: { usr_b: { id: 'usr_b' } },
            presenceById: { usr_b: offline(1) },
            generation: 2
        });
        expect(
            useFriendRosterStore.getState().friendsById.usr_b.$presence
        ).toEqual(offline(1).view);
    });
});
