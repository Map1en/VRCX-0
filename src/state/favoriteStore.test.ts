import { beforeEach, describe, expect, it } from 'vitest';

import type { LocalFavoriteGroup } from '@/domain/favorites/types';

import { useFavoriteStore } from './favoriteStore';

function group(
    id: number,
    name: string,
    kind: LocalFavoriteGroup['kind'] = 'friend'
): LocalFavoriteGroup {
    return { id, kind, name, shared: false };
}

describe('favoriteStore', () => {
    beforeEach(() => {
        useFavoriteStore.getState().resetFavorites();
    });

    it('deduplicates local favorites and preserves newest-first group ordering', () => {
        const store = useFavoriteStore.getState();
        store.createLocalFavoriteGroup(group(7, 'VIP'));

        for (const entityId of ['usr_a', 'usr_b', 'usr_a']) {
            store.addLocalFavorite({ kind: 'friend', groupId: 7, entityId });
        }

        expect(useFavoriteStore.getState()).toMatchObject({
            localFriendFavorites: { 7: ['usr_a', 'usr_b'] },
            localFriendFavoriteGroups: [group(7, 'VIP')],
            localFriendFavoritesList: ['usr_a', 'usr_b']
        });
    });

    it('ignores favorites added to a group the store does not know', () => {
        const store = useFavoriteStore.getState();

        store.addLocalFavorite({
            kind: 'friend',
            groupId: 9,
            entityId: 'usr_a'
        });

        expect(useFavoriteStore.getState()).toMatchObject({
            localFriendFavorites: {},
            localFriendFavoriteGroups: [],
            localFriendFavoritesList: []
        });
    });

    it('renames and deletes local favorite groups without losing unrelated groups', () => {
        const store = useFavoriteStore.getState();
        store.createLocalFavoriteGroup(group(1, 'Old', 'avatar'));
        store.createLocalFavoriteGroup(group(2, 'Keep', 'avatar'));
        store.addLocalFavorite({
            kind: 'avatar',
            groupId: 1,
            entityId: 'avtr_1',
            entity: { name: 'Avatar' }
        });

        store.renameLocalFavoriteGroup({
            kind: 'avatar',
            groupId: 1,
            name: 'New'
        });
        store.deleteLocalFavoriteGroup({ kind: 'avatar', groupId: 2 });

        expect(useFavoriteStore.getState()).toMatchObject({
            localAvatarFavorites: { 1: ['avtr_1'] },
            localAvatarFavoriteGroups: [group(1, 'New', 'avatar')],
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
            useFavoriteStore.getState().remoteFavoritesByObjectId.usr_a
        ).toMatchObject({
            id: 'fvrt_record_1'
        });

        store.removeRemoteFavorite('usr_a');

        expect(useFavoriteStore.getState().remoteFavoritesById).toEqual({});
        expect(useFavoriteStore.getState().remoteFavoritesByObjectId).toEqual(
            {}
        );
        expect(useFavoriteStore.getState()).toMatchObject({
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

    it('normalizes dirty local favorite snapshot maps, groups and lists', () => {
        const store = useFavoriteStore.getState();

        store.setFavoritesSnapshot({
            localAvatarFavorites: {
                3: ['avtr_1', false, undefined]
            },
            localAvatarFavoriteGroups: [
                group(3, 'Avatars', 'avatar'),
                null,
                'Bad'
            ],
            localAvatarFavoritesList: ['avtr_1', false, undefined],
            localFriendFavorites: {
                4: ['usr_1', 123, '']
            },
            localFriendFavoriteGroups: [group(4, 'Friends'), undefined],
            localFriendFavoritesList: ['usr_1', 123, '']
        });

        expect(useFavoriteStore.getState()).toMatchObject({
            localAvatarFavorites: { 3: ['avtr_1', 'false'] },
            localAvatarFavoriteGroups: [group(3, 'Avatars', 'avatar')],
            localAvatarFavoritesList: ['avtr_1', 'false'],
            localFriendFavorites: { 4: ['usr_1', '123'] },
            localFriendFavoriteGroups: [group(4, 'Friends')],
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
        store.createLocalFavoriteGroup(group(1, 'Friends'));
        store.addLocalFavorite({
            kind: 'friend',
            groupId: 1,
            entityId: 'usr_1'
        });

        store.setLocalFavoritesForKind('avatar', {
            localFavorites: { 2: ['avtr_1'] },
            localFavoriteGroups: [group(2, 'Avatars', 'avatar')]
        });

        expect(useFavoriteStore.getState()).toMatchObject({
            localFriendFavorites: { 1: ['usr_1'] },
            localAvatarFavorites: { 2: ['avtr_1'] },
            localAvatarFavoriteGroups: [group(2, 'Avatars', 'avatar')],
            localAvatarFavoritesList: ['avtr_1'],
            favoriteWorldIds: ['wrld_remote']
        });
    });

    it('keeps the local group order across create, rename and delete', () => {
        const store = useFavoriteStore.getState();
        store.setLocalFavoritesForKind('friend', {
            localFavorites: {},
            localFavoriteGroups: [
                group(1, 'Zebra'),
                group(2, 'Alpha'),
                group(3, 'Mid')
            ]
        });

        store.createLocalFavoriteGroup(group(4, 'Beta'));
        store.renameLocalFavoriteGroup({
            kind: 'friend',
            groupId: 2,
            name: 'Omega'
        });
        store.deleteLocalFavoriteGroup({ kind: 'friend', groupId: 3 });

        expect(
            useFavoriteStore
                .getState()
                .localFriendFavoriteGroups.map((localGroup) => localGroup.name)
        ).toEqual(['Zebra', 'Omega', 'Beta']);
        expect(useFavoriteStore.getState().localFriendFavorites).toEqual({
            1: [],
            2: [],
            4: []
        });
    });

    it('ignores invalid local favorite action kinds', () => {
        const store = useFavoriteStore.getState();
        store.createLocalFavoriteGroup(group(1, 'Friends'));
        store.addLocalFavorite({
            kind: 'friend',
            groupId: 1,
            entityId: 'usr_1'
        });
        const invalidAction: unknown = {
            kind: 'invalid',
            groupId: 1,
            entityId: 'usr_2'
        };
        store.addLocalFavorite(
            invalidAction as Parameters<typeof store.addLocalFavorite>[0]
        );

        expect(useFavoriteStore.getState().localFriendFavorites).toEqual({
            1: ['usr_1']
        });
        expect(useFavoriteStore.getState().localAvatarFavorites).toEqual({});
    });
});
