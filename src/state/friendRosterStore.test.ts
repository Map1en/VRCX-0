import { beforeEach, describe, expect, it } from 'vitest';

import { useFriendRosterStore } from './friendRosterStore';

describe('friendRosterStore', () => {
    beforeEach(() => {
        useFriendRosterStore.getState().resetRoster();
    });

    it('retains unchanged profile references when a presence field changes', () => {
        const store = useFriendRosterStore.getState();
        store.applyFriendPatch({
            userId: 'usr_shared',
            patch: {
                state: 'online',
                tags: ['system_trust_basic'],
                bioLinks: ['https://example.com'],
                badges: [{ badgeId: 'badge_one' }],
                currentAvatarTags: ['avatar_tag'],
                $location: { worldId: 'wrld_one' },
                externalMetadata: { nested: ['preserved'] }
            }
        });
        const previous = useFriendRosterStore.getState().friendsById.usr_shared;
        store.applyFriendPatch({
            userId: 'usr_shared',
            patch: { statusDescription: 'new status' },
            stateBucketAuthority: 'preserve'
        });
        const next = useFriendRosterStore.getState().friendsById.usr_shared;
        expect(next).not.toBe(previous);
        expect(next.statusDescription).toBe('new status');
        expect(next.state).toBe('online');
        expect(next.tags).toBe(previous.tags);
        expect(next.bioLinks).toBe(previous.bioLinks);
        expect(next.badges).toBe(previous.badges);
        expect(next.currentAvatarTags).toBe(previous.currentAvatarTags);
        expect(next.$location).toBe(previous.$location);
        expect(next.externalMetadata).toBe(previous.externalMetadata);
    });

    it('preserves open nested fields and reuses equal patch data', () => {
        const store = useFriendRosterStore.getState();
        const patch = {
            bioLinks: ['https://example.com'],
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
        expect(next.bioLinks).toBe(
            previousState.friendsById.usr_extra.bioLinks
        );
    });

    it('moves from loading to ready and orders friends within state buckets', () => {
        const store = useFriendRosterStore.getState();

        store.setRosterLoading('usr_current', 'loading friends');
        expect(useFriendRosterStore.getState()).toMatchObject({
            currentUserId: 'usr_current',
            loadStatus: 'running',
            detail: 'loading friends',
            friendsById: {}
        });

        store.applyFriendPatches(
            [
                {
                    userId: ' usr_b ',
                    patch: {
                        state: 'online',
                        id: 'usr_b',
                        displayName: 'Bravo',
                        friendNumber: 2,
                        platform: 'standalonewindows',
                        tags: ['system_trust_basic']
                    }
                },
                {
                    userId: 'usr_a',
                    patch: {
                        state: 'online',
                        id: 'usr_a',
                        displayName: 'Alpha',
                        friendNumber: 1,
                        tags: []
                    }
                },
                {
                    userId: 'usr_c',
                    patch: {
                        state: 'active',
                        id: 'usr_c',
                        displayName: 'Charlie',
                        tags: ['system_trust_known']
                    }
                },
                {
                    userId: 'usr_d',
                    patch: {
                        state: 'offline',
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
            $platform: 'standalonewindows'
        });
    });

    it('creates a ready fallback entry when a patch arrives before bootstrap', () => {
        useFriendRosterStore.getState().applyFriendPatch({
            userId: 'usr_new',
            patch: {
                state: 'online',
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
                    state: 'online'
                }
            }
        });
    });

    it('returns the same state reference for a no-op patch on an unchanged friend', () => {
        const store = useFriendRosterStore.getState();
        store.applyFriendPatch({
            userId: 'usr_stable',
            patch: {
                state: 'online',
                id: 'usr_stable',
                displayName: 'Stable Friend'
            }
        });

        const stateBefore = useFriendRosterStore.getState();
        store.applyFriendPatch({
            userId: 'usr_stable',
            patch: {
                state: 'online',
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
                patch: {
                    state: 'online',
                    id: 'usr_stable',
                    displayName: 'Stable Friend'
                }
            }
        ]);

        const stateBefore = useFriendRosterStore.getState();
        store.applyFriendPatches([
            {
                userId: 'usr_stable',
                patch: {
                    state: 'online',
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

    it('seeds a running roster from current-user buckets and cached friend log rows', () => {
        const store = useFriendRosterStore.getState();

        store.setRosterSeedSnapshot({
            currentUserId: 'usr_current',
            friendsById: {
                usr_offline: {
                    id: 'usr_offline',
                    displayName: 'Offline Cache',
                    trustLevel: 'Known User',
                    friendNumber: 2,
                    state: 'offline'
                },
                usr_online: {
                    id: 'usr_online',
                    displayName: 'Online Cache',
                    trustLevel: 'Trusted User',
                    friendNumber: 1,
                    state: 'online'
                },
                usr_active: {
                    id: 'usr_active',
                    displayName: 'usr_active',
                    state: 'active'
                }
            },
            detail: 'seeded friends'
        });

        const state = useFriendRosterStore.getState();

        expect(state.loadStatus).toBe('running');
        expect(state.detail).toBe('seeded friends');
        expect(state.onlineIds).toEqual(['usr_online']);
        expect(state.activeIds).toEqual(['usr_active']);
        expect(state.offlineIds).toEqual(['usr_offline']);
        expect(state.orderedFriendIds).toEqual([
            'usr_online',
            'usr_active',
            'usr_offline'
        ]);
        expect(state.friendsById.usr_online).toMatchObject({
            id: 'usr_online',
            displayName: 'Online Cache',
            state: 'online',
            friendNumber: 1,
            $trustLevel: 'Trusted User'
        });
    });

    it('preserves bucket membership for location-only friend patches', () => {
        const store = useFriendRosterStore.getState();
        store.applyFriendPatch({
            userId: 'usr_friend',
            patch: {
                id: 'usr_friend',
                displayName: 'Friend',
                state: 'online',
                location: 'wrld_old:1'
            }
        });

        store.applyFriendPatch({
            userId: 'usr_friend',
            patch: {
                state: 'offline',
                id: 'usr_friend',
                location: 'wrld_new:2'
            },
            stateBucketAuthority: 'preserve'
        });

        expect(useFriendRosterStore.getState()).toMatchObject({
            onlineIds: ['usr_friend'],
            offlineIds: [],
            friendsById: {
                usr_friend: {
                    state: 'online',
                    location: 'wrld_new:2'
                }
            }
        });
    });

    it('removes friends and rebuilds bucket ordering', () => {
        const store = useFriendRosterStore.getState();

        store.applyFriendPatches([
            {
                userId: 'usr_a',
                patch: { state: 'online', id: 'usr_a', displayName: 'Alpha' }
            },
            {
                userId: 'usr_b',
                patch: { state: 'active', id: 'usr_b', displayName: 'Bravo' }
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
});
