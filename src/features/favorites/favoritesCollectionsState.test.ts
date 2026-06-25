import { describe, expect, it } from 'vitest';

import {
    buildFavoriteAvatarTags,
    buildFavoriteFriendFactIds,
    selectFavoritesCollectionsState
} from './favoritesCollectionsState';

describe('favorites collections state helpers', () => {
    it('builds unique friend fact ids from remote and local groups', () => {
        expect(
            buildFavoriteFriendFactIds({
                kind: 'friend',
                groupedFavoriteFriendIdsByGroupKey: {
                    'friend:group_0': ['usr_a', 'usr_b', ''],
                    'friend:group_1': ['usr_a', 42]
                },
                localFriendFavorites: {
                    Local: ['usr_c', 'usr_b', null]
                }
            })
        ).toEqual(['usr_a', 'usr_b', '42', 'usr_c']);

        expect(
            buildFavoriteFriendFactIds({
                kind: 'world',
                groupedFavoriteFriendIdsByGroupKey: {
                    'friend:group_0': ['usr_a']
                }
            })
        ).toEqual([]);
    });

    it('builds unique avatar tags only for avatar collections', () => {
        expect(
            buildFavoriteAvatarTags({
                kind: 'avatar',
                remoteFavoritesById: {
                    one: { type: 'avatar', tags: ['author_tag_foo'] },
                    two: { type: 'avatar', tags: ['author_tag_foo'] },
                    three: { type: 'world', tags: ['author_tag_world'] },
                    four: { type: 'avatar', tags: ['  '] }
                }
            })
        ).toEqual(['author_tag_foo']);

        expect(
            buildFavoriteAvatarTags({
                kind: 'friend',
                remoteFavoritesById: {
                    one: { type: 'avatar', tags: ['author_tag_foo'] }
                }
            })
        ).toEqual([]);
    });

    it('selects only the favorite state needed for the active kind', () => {
        const state = {
            loadStatus: 'ready',
            detail: '',
            favoritesSortOrder: ['fav_1'],
            remoteFavoritesById: { fav_1: { favoriteId: 'wrld_1' } },
            favoriteFriendGroups: [{ key: 'friend:group_0' }],
            favoriteWorldGroups: [{ key: 'world:group_0' }],
            favoriteAvatarGroups: [{ key: 'avatar:group_0' }],
            groupedFavoriteFriendIdsByGroupKey: {
                'friend:group_0': ['usr_a']
            },
            localWorldFavorites: { Worlds: ['wrld_1'] },
            localAvatarFavorites: { Avatars: ['avtr_1'] },
            localFriendFavorites: { Friends: ['usr_a'] },
            localWorldFavoriteGroups: ['Worlds'],
            localAvatarFavoriteGroups: ['Avatars'],
            localFriendFavoriteGroups: ['Friends'],
            localWorldDetailsById: { wrld_1: { name: 'World' } },
            localAvatarDetailsById: { avtr_1: { name: 'Avatar' } },
            favoriteWorldIds: ['wrld_1'],
            favoriteAvatarIds: ['avtr_1']
        };

        expect(selectFavoritesCollectionsState('friend')(state)).toMatchObject({
            favoriteFriendGroups: [{ key: 'friend:group_0' }],
            favoriteWorldGroups: [],
            favoriteAvatarGroups: [],
            remoteFavoritesById: {},
            localFriendFavorites: { Friends: ['usr_a'] },
            localWorldFavorites: {},
            localAvatarFavorites: {}
        });
        expect(selectFavoritesCollectionsState('world')(state)).toMatchObject({
            favoriteFriendGroups: [],
            favoriteWorldGroups: [{ key: 'world:group_0' }],
            remoteFavoritesById: { fav_1: { favoriteId: 'wrld_1' } },
            localWorldDetailsById: { wrld_1: { name: 'World' } },
            localAvatarDetailsById: {}
        });
    });
});
