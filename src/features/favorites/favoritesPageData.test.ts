import { describe, expect, it } from 'vitest';

import { buildFavoriteRemoteItemsByGroup } from './favoritesPageData';

describe('favorites page data helpers', () => {
    it('keeps cached private world details visible when remote details are unavailable', () => {
        const itemsByGroup = buildFavoriteRemoteItemsByGroup({
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
                    favoriteId: 'wrld_private',
                    $groupKey: 'world:group_0'
                }
            },
            remoteEntityDetailsData: {},
            remoteEntityDetailsStatus: 'ready',
            localWorldDetailsById: {
                wrld_private: {
                    id: 'wrld_private',
                    name: 'Cached Private World',
                    authorName: 'Maple',
                    releaseStatus: 'private'
                }
            },
            remoteGroupLabelByKey: {
                'world:group_0': 'Worlds'
            },
            t: (key: string) => key
        });

        expect(itemsByGroup['world:group_0']).toEqual([
            expect.objectContaining({
                id: 'wrld_private',
                title: 'Cached Private World',
                seedData: expect.objectContaining({
                    releaseStatus: 'private'
                }),
                isPrivate: true,
                isUnavailable: true
            })
        ]);
    });
});
