import { describe, expect, it } from 'vitest';

import {
    buildFavoriteCollectionFriendIdSet,
    buildFavoriteCollectionSidebarVirtualRows
} from './favoriteCollectionSidebarRows';

const t = (key: string) => key;

describe('favoriteCollectionSidebarRows', () => {
    it('builds a de-duplicated friend id set from remote and local favorite groups', () => {
        expect(
            Array.from(
                buildFavoriteCollectionFriendIdSet({
                    sourceGroupKeys: [' group_a ', 'local:Best', '', 'missing'],
                    groupedFavoriteFriendIdsByGroupKey: {
                        group_a: [' usr_1 ', 'usr_2', '']
                    },
                    localFriendFavorites: {
                        Best: ['usr_2', 'usr_3']
                    }
                })
            )
        ).toEqual(['usr_1', 'usr_2', 'usr_3']);
    });

    it('builds favorite collection rows with same-instance grouping and empty state', () => {
        const rows = buildFavoriteCollectionSidebarVirtualRows({
            activeRows: [{ id: 'usr_active' }],
            currentUserId: 'usr_me',
            emptyText: 'No favorites',
            loadStatus: 'ready',
            offlineRows: [{ id: 'usr_offline' }],
            onlineRows: [{ id: 'usr_me' }],
            openGroups: {
                sameInstance: true,
                online: true,
                active: false,
                offline: true
            },
            rowsLength: 3,
            sameInstanceGroups: [
                {
                    location: 'wrld_live:1',
                    rows: [{ id: 'usr_same' }]
                }
            ],
            t
        });

        expect(rows.map((row) => row.key)).toEqual([
            'section:sameInstance',
            'instance:wrld_live:1:0',
            'friend:favoriteCollection:sameInstance:wrld_live:1:0:usr_same',
            'section:online',
            'friend:favoriteCollection:online:usr_me',
            'section:active',
            'section:offline',
            'friend:favoriteCollection:offline:usr_offline',
            'footer'
        ]);
        expect(rows[4]).toMatchObject({
            isCurrentUser: true
        });
        expect(rows[2]).toMatchObject({
            isGroupByInstance: true
        });

        expect(
            buildFavoriteCollectionSidebarVirtualRows({
                activeRows: [],
                currentUserId: '',
                emptyText: 'No favorites',
                loadStatus: 'ready',
                offlineRows: [],
                onlineRows: [],
                openGroups: {
                    online: true,
                    active: true,
                    offline: true
                },
                rowsLength: 0,
                sameInstanceGroups: [],
                t
            }).map((row) => row.key)
        ).toContain('message:empty-favorite-collection');
    });
});
