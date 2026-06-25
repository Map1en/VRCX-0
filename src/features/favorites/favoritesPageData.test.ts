import { describe, expect, it } from 'vitest';

import { buildFavoriteRemoteItemsByGroup } from './favoritesPageData';

function buildWorldItems({
    cachedWorldDetail,
    remoteWorldDetail
}: {
    cachedWorldDetail?: Record<string, unknown>;
    remoteWorldDetail?: Record<string, unknown>;
}) {
    return buildFavoriteRemoteItemsByGroup({
        kind: 'world',
        remoteGroups: [
            {
                key: 'world:group_0',
                label: 'Worlds'
            }
        ],
        groupedFavoriteFriendIdsByGroupKey: {},
        friendsById: {},
        favoritesSortIndex: {},
        sortValue: 'date',
        remoteFavoritesById: {
            fvrt_world_1: {
                id: 'fvrt_world_1',
                type: 'world',
                favoriteId: 'wrld_favorite',
                $groupKey: 'world:group_0'
            }
        },
        remoteEntityDetailsData: remoteWorldDetail
            ? {
                  wrld_favorite: {
                      id: 'wrld_favorite',
                      ...remoteWorldDetail
                  }
              }
            : {},
        remoteEntityDetailsStatus: 'ready',
        localWorldDetailsById: cachedWorldDetail
            ? {
                  wrld_favorite: {
                      id: 'wrld_favorite',
                      ...cachedWorldDetail
                  }
              }
            : {},
        remoteGroupLabelByKey: {
            'world:group_0': 'Worlds'
        },
        t: (key: string) => key
    })['world:group_0'];
}

describe('favorites page data helpers', () => {
    it('uses cached private world details when remote details are missing', () => {
        const items = buildWorldItems({
            cachedWorldDetail: {
                name: 'Cached Private World',
                authorName: 'Maple',
                releaseStatus: 'private'
            }
        });

        expect(items).toEqual([
            expect.objectContaining({
                id: 'wrld_favorite',
                title: 'Cached Private World',
                seedData: expect.objectContaining({
                    releaseStatus: 'private'
                }),
                isPrivate: true,
                isUnavailable: false
            })
        ]);
    });

    it('uses cached public world details when remote details are missing', () => {
        const items = buildWorldItems({
            cachedWorldDetail: {
                name: 'Cached Public World',
                authorName: 'Cedar',
                releaseStatus: 'public'
            }
        });

        expect(items).toEqual([
            expect.objectContaining({
                id: 'wrld_favorite',
                title: 'Cached Public World',
                isPrivate: false,
                isUnavailable: false
            })
        ]);
    });

    it('keeps remote-missing worlds unavailable when the cache only has an id shell', () => {
        const items = buildWorldItems({
            cachedWorldDetail: {}
        });

        expect(items).toEqual([
            expect.objectContaining({
                id: 'wrld_favorite',
                title: 'view.favorites.empty.world_fallback',
                seedData: null,
                isPrivate: false,
                isUnavailable: true
            })
        ]);
    });

    it('prefers remote world details over stale cached details', () => {
        const items = buildWorldItems({
            cachedWorldDetail: {
                name: 'Cached Private World',
                releaseStatus: 'private'
            },
            remoteWorldDetail: {
                name: 'Fresh Public World',
                authorName: 'Juniper',
                releaseStatus: 'public'
            }
        });

        expect(items).toEqual([
            expect.objectContaining({
                id: 'wrld_favorite',
                title: 'Fresh Public World',
                seedData: expect.objectContaining({
                    releaseStatus: 'public'
                }),
                isPrivate: false,
                isUnavailable: false
            })
        ]);
    });
});
