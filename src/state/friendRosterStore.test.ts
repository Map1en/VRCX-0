import { beforeEach, describe, expect, it } from 'vitest';

import { useFriendRosterStore } from './friendRosterStore';

describe('friendRosterStore', () => {
    beforeEach(() => {
        useFriendRosterStore.getState().resetRoster();
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
                    stateBucket: 'online',
                    patch: {
                        id: 'usr_b',
                        displayName: 'Bravo',
                        friendNumber: 2,
                        platform: 'standalonewindows',
                        tags: ['system_trust_basic']
                    }
                },
                {
                    userId: 'usr_a',
                    stateBucket: 'online',
                    patch: {
                        id: 'usr_a',
                        displayName: 'Alpha',
                        friendNumber: 1,
                        tags: []
                    }
                },
                {
                    userId: 'usr_c',
                    stateBucket: 'active',
                    patch: {
                        id: 'usr_c',
                        displayName: 'Charlie',
                        tags: ['system_trust_known']
                    }
                },
                {
                    userId: 'usr_d',
                    stateBucket: 'offline',
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
            $platform: 'standalonewindows'
        });
    });

    it('creates a ready fallback entry when a patch arrives before bootstrap', () => {
        useFriendRosterStore.getState().applyFriendPatch({
            userId: 'usr_new',
            patch: {
                displayName: 'New Friend'
            },
            stateBucket: 'online'
        });

        expect(useFriendRosterStore.getState()).toMatchObject({
            loadStatus: 'ready',
            onlineIds: ['usr_new'],
            orderedFriendIds: ['usr_new'],
            friendsById: {
                usr_new: {
                    id: 'usr_new',
                    displayName: 'New Friend',
                    stateBucket: 'online'
                }
            }
        });
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
                    stateBucket: 'offline'
                },
                usr_online: {
                    id: 'usr_online',
                    displayName: 'Online Cache',
                    trustLevel: 'Trusted User',
                    friendNumber: 1,
                    stateBucket: 'online'
                },
                usr_active: {
                    id: 'usr_active',
                    displayName: 'usr_active',
                    stateBucket: 'active'
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
            stateBucket: 'online',
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
            },
            stateBucket: 'online'
        });

        store.applyFriendPatch({
            userId: 'usr_friend',
            patch: {
                id: 'usr_friend',
                location: 'wrld_new:2'
            },
            stateBucket: 'offline',
            stateBucketAuthority: 'preserve'
        });

        expect(useFriendRosterStore.getState()).toMatchObject({
            onlineIds: ['usr_friend'],
            offlineIds: [],
            friendsById: {
                usr_friend: {
                    state: 'online',
                    stateBucket: 'online',
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
                stateBucket: 'online',
                patch: { id: 'usr_a', displayName: 'Alpha' }
            },
            {
                userId: 'usr_b',
                stateBucket: 'active',
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
});
