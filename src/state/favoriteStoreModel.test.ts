import { describe, expect, it } from 'vitest';

import {
    buildRemoteFavoriteCollections,
    cloneFavoriteLimits,
    normalizeFavoriteGroupMap,
    normalizeFavoriteRecordMap,
    recomputeGroupCountsFromMap
} from './favoriteStoreModel';

describe('favoriteStoreModel', () => {
    it('normalizes dirty group and favorite maps without leaking invalid entries', () => {
        expect(
            normalizeFavoriteGroupMap({
                Friends: ['usr_1', 123, '', null],
                '  ': ['usr_blank'],
                Broken: 'usr_not_array'
            })
        ).toEqual({
            Friends: ['usr_1', '123'],
            Broken: []
        });

        expect(
            normalizeFavoriteRecordMap({
                fvrt_1: {
                    id: 'fvrt_1',
                    favoriteId: 'usr_1'
                },
                empty: null,
                ' ': {
                    id: 'fvrt_blank'
                }
            })
        ).toEqual({
            fvrt_1: {
                id: 'fvrt_1',
                favoriteId: 'usr_1'
            }
        });
    });

    it('builds remote indexes and preserves previous sort order for live ids', () => {
        const collections = buildRemoteFavoriteCollections(
            {
                fvrt_friend: {
                    id: 'fvrt_friend',
                    type: 'friend',
                    favoriteId: 'usr_friend',
                    $groupKey: 'friend:group_0'
                },
                fvrt_world: {
                    id: 'fvrt_world',
                    type: 'world',
                    favoriteId: 'wrld_world',
                    $groupKey: 'world:group_0'
                },
                fvrt_avatar: {
                    id: 'fvrt_avatar',
                    type: 'avatar',
                    favoriteId: 'avtr_avatar',
                    $groupKey: 'avatar:group_0'
                }
            },
            ['wrld_world', 'missing', 'usr_friend']
        );

        expect(collections).toMatchObject({
            favoriteFriendIds: ['usr_friend'],
            favoriteWorldIds: ['wrld_world'],
            favoriteAvatarIds: ['avtr_avatar'],
            groupedFavoriteFriendIdsByGroupKey: {
                'friend:group_0': ['usr_friend']
            },
            favoritesSortOrder: ['wrld_world', 'usr_friend', 'avtr_avatar']
        });
        expect(collections.remoteFavoritesByObjectId.usr_friend).toMatchObject({
            id: 'fvrt_friend'
        });
    });

    it('merges favorite limits and recomputes group counts from backend groups', () => {
        expect(
            cloneFavoriteLimits({
                maxFavoriteGroups: { friend: 10 },
                maxFavoritesPerGroup: { avatar: 99 }
            })
        ).toMatchObject({
            maxFavoriteGroups: {
                friend: 10,
                world: 4
            },
            maxFavoritesPerGroup: {
                avatar: 99,
                friend: 150
            }
        });

        expect(
            recomputeGroupCountsFromMap(
                [{ key: 'friend:group_0' }, { key: 'friend:group_1' }],
                {
                    'friend:group_0': ['usr_a', 'usr_b']
                }
            )
        ).toEqual([
            { key: 'friend:group_0', count: 2 },
            { key: 'friend:group_1', count: 0 }
        ]);
    });
});
