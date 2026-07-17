import { beforeEach, describe, expect, it } from 'vitest';

import { useFavoriteStore } from './favoriteStore';

describe('favoriteStore', () => {
    beforeEach(() => {
        useFavoriteStore.getState().resetFavorites();
    });

    it('deduplicates local favorites and preserves newest-first group ordering', () => {
        const store = useFavoriteStore.getState();

        store.addLocalFavorite({
            kind: 'friend',
            groupName: 'VIP',
            entityId: 'usr_a'
        });
        store.addLocalFavorite({
            kind: 'friend',
            groupName: 'VIP',
            entityId: 'usr_b'
        });
        store.addLocalFavorite({
            kind: 'friend',
            groupName: 'VIP',
            entityId: 'usr_a'
        });

        expect(useFavoriteStore.getState()).toMatchObject({
            localFriendFavorites: {
                VIP: ['usr_a', 'usr_b']
            },
            localFriendFavoriteGroups: ['VIP'],
            localFriendFavoritesList: ['usr_a', 'usr_b']
        });
    });

    it('keeps local entity details until the entity is removed from every group', () => {
        const store = useFavoriteStore.getState();
        const world = {
            name: 'Test World'
        };

        store.addLocalFavorite({
            kind: 'world',
            groupName: 'A',
            entityId: 'wrld_1',
            entity: world
        });
        store.addLocalFavorite({
            kind: 'world',
            groupName: 'B',
            entityId: 'wrld_1',
            entity: world
        });

        store.removeLocalFavorite({
            kind: 'world',
            groupName: 'A',
            entityId: 'wrld_1'
        });

        expect(useFavoriteStore.getState()).toMatchObject({
            localWorldFavorites: {
                A: [],
                B: ['wrld_1']
            },
            localWorldFavoritesList: ['wrld_1'],
            localWorldDetailsById: {
                wrld_1: {
                    id: 'wrld_1',
                    name: 'Test World'
                }
            }
        });

        store.removeLocalFavorite({
            kind: 'world',
            groupName: 'B',
            entityId: 'wrld_1'
        });

        expect(useFavoriteStore.getState()).toMatchObject({
            localWorldFavorites: {
                A: [],
                B: []
            },
            localWorldFavoritesList: [],
            localWorldDetailsById: {}
        });
    });

    it('renames and deletes local favorite groups without losing unrelated groups', () => {
        const store = useFavoriteStore.getState();

        store.createLocalFavoriteGroup({
            kind: 'avatar',
            groupName: 'Old'
        });
        store.createLocalFavoriteGroup({
            kind: 'avatar',
            groupName: 'Keep'
        });
        store.addLocalFavorite({
            kind: 'avatar',
            groupName: 'Old',
            entityId: 'avtr_1',
            entity: { name: 'Avatar' }
        });

        store.renameLocalFavoriteGroup({
            kind: 'avatar',
            groupName: 'Old',
            newGroupName: 'New'
        });
        store.deleteLocalFavoriteGroup({
            kind: 'avatar',
            groupName: 'Keep'
        });

        expect(useFavoriteStore.getState()).toMatchObject({
            localAvatarFavorites: {
                New: ['avtr_1']
            },
            localAvatarFavoriteGroups: ['New'],
            localAvatarFavoritesList: ['avtr_1']
        });
    });

    it('indexes remote favorites by favorite object id and updates group counts', () => {
        const store = useFavoriteStore.getState();

        store.setFavoritesSnapshot({
            remoteFavoritesById: {
                fvrt_record_1: {
                    id: 'fvrt_record_1',
                    type: 'friend',
                    favoriteId: 'usr_a',
                    tags: ['group_0'],
                    $groupKey: 'friend:group_0'
                }
            },
            favoriteFriendGroups: [
                {
                    key: 'friend:group_0',
                    count: 0
                }
            ]
        });

        expect(useFavoriteStore.getState()).toMatchObject({
            favoriteFriendIds: ['usr_a'],
            groupedFavoriteFriendIdsByGroupKey: {
                'friend:group_0': ['usr_a']
            },
            favoriteFriendGroups: [
                {
                    key: 'friend:group_0',
                    count: 1
                }
            ]
        });
        expect(
            useFavoriteStore.getState().getRemoteFavoriteByObjectId('usr_a')
        ).toMatchObject({
            id: 'fvrt_record_1'
        });

        store.removeRemoteFavorite('usr_a');

        expect(useFavoriteStore.getState()).toMatchObject({
            remoteFavoritesById: {},
            remoteFavoritesByObjectId: {},
            favoriteFriendIds: [],
            favoriteFriendGroups: [
                {
                    key: 'friend:group_0',
                    count: 0
                }
            ]
        });
    });

    it('prefers backend-normalized friend ids and groups from favorite snapshots', () => {
        const store = useFavoriteStore.getState();

        store.setFavoritesSnapshot({
            remoteFavoritesById: {
                fvrt_record_1: {
                    id: 'fvrt_record_1',
                    type: 'friend',
                    favoriteId: 'fvrt_shadow_id',
                    tags: ['group_0'],
                    $groupKey: 'friend:group_0'
                }
            },
            favoriteFriendIds: ['usr_sender'],
            groupedFavoriteFriendIdsByGroupKey: {
                'friend:group_0': ['usr_sender']
            },
            favoriteFriendGroups: [
                {
                    key: 'friend:group_0',
                    count: 0
                }
            ]
        });

        expect(useFavoriteStore.getState()).toMatchObject({
            favoriteFriendIds: ['usr_sender'],
            groupedFavoriteFriendIdsByGroupKey: {
                'friend:group_0': ['usr_sender']
            },
            favoriteFriendGroups: [
                {
                    key: 'friend:group_0',
                    count: 1
                }
            ]
        });
    });

    it('normalizes dirty local favorite snapshot maps and lists', () => {
        const store = useFavoriteStore.getState();

        store.setFavoritesSnapshot({
            localWorldFavorites: {
                Worlds: ['wrld_1', 42, '', null],
                '  ': ['wrld_blank'],
                Broken: 'wrld_not_array'
            },
            localWorldFavoriteGroups: ['Worlds', '', 12],
            localWorldFavoritesList: ['wrld_1', 42, ''],
            localAvatarFavorites: {
                Avatars: ['avtr_1', false, undefined]
            },
            localAvatarFavoriteGroups: ['Avatars', null],
            localAvatarFavoritesList: ['avtr_1', false, undefined],
            localFriendFavorites: {
                Friends: ['usr_1', 123, '']
            },
            localFriendFavoriteGroups: ['Friends', undefined],
            localFriendFavoritesList: ['usr_1', 123, '']
        });

        expect(useFavoriteStore.getState()).toMatchObject({
            localWorldFavorites: {
                Worlds: ['wrld_1', '42'],
                Broken: []
            },
            localWorldFavoriteGroups: ['Worlds', '12'],
            localWorldFavoritesList: ['wrld_1', '42'],
            localAvatarFavorites: {
                Avatars: ['avtr_1', 'false']
            },
            localAvatarFavoriteGroups: ['Avatars'],
            localAvatarFavoritesList: ['avtr_1', 'false'],
            localFriendFavorites: {
                Friends: ['usr_1', '123']
            },
            localFriendFavoriteGroups: ['Friends'],
            localFriendFavoritesList: ['usr_1', '123']
        });
    });

    it('setLocalFavoritesForKind only replaces the targeted kind local slice', () => {
        const store = useFavoriteStore.getState();
        store.setFavoritesSnapshot({
            remoteFavoritesById: {
                fvrt_record_1: {
                    id: 'fvrt_record_1',
                    type: 'world',
                    favoriteId: 'wrld_remote',
                    tags: ['group_0'],
                    $groupKey: 'world:group_0'
                }
            }
        });
        store.addLocalFavorite({
            kind: 'friend',
            groupName: 'Friends',
            entityId: 'usr_1'
        });

        store.setLocalFavoritesForKind('world', {
            localFavorites: { Worlds: ['wrld_1'] },
            localFavoriteGroups: ['Worlds']
        });

        expect(useFavoriteStore.getState()).toMatchObject({
            localWorldFavorites: { Worlds: ['wrld_1'] },
            localWorldFavoriteGroups: ['Worlds'],
            localWorldFavoritesList: ['wrld_1'],
            localFriendFavorites: { Friends: ['usr_1'] },
            localAvatarFavorites: {},
            favoriteWorldIds: ['wrld_remote']
        });
    });

    it('setLocalFavoritesForKind sorts the union of explicit groups and map keys', () => {
        const store = useFavoriteStore.getState();

        store.setLocalFavoritesForKind('avatar', {
            localFavorites: { Zebra: ['avtr_1'] },
            localFavoriteGroups: ['Alpha', 'Zebra']
        });

        expect(useFavoriteStore.getState().localAvatarFavoriteGroups).toEqual([
            'Alpha',
            'Zebra'
        ]);
    });

    it('setLocalFavoritesForKind normalizes illegal input without throwing', () => {
        const store = useFavoriteStore.getState();

        expect(() =>
            store.setLocalFavoritesForKind('friend', {
                localFavorites: 'not-an-object',
                localFavoriteGroups: 'not-an-array'
            })
        ).not.toThrow();

        expect(useFavoriteStore.getState()).toMatchObject({
            localFriendFavorites: {},
            localFriendFavoriteGroups: [],
            localFriendFavoritesList: []
        });
    });

    it('ignores invalid local favorite action kinds', () => {
        const store = useFavoriteStore.getState();

        store.addLocalFavorite({
            kind: 'friend',
            groupName: 'Friends',
            entityId: 'usr_1'
        });
        const invalidAction: unknown = {
            kind: 'invalid',
            groupName: 'Friends',
            entityId: 'usr_2'
        };
        store.addLocalFavorite(
            invalidAction as Parameters<typeof store.addLocalFavorite>[0]
        );

        expect(useFavoriteStore.getState()).toMatchObject({
            localFriendFavorites: {
                Friends: ['usr_1']
            },
            localWorldFavorites: {},
            localAvatarFavorites: {}
        });
    });
});
