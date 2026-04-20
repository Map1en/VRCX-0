import { describe, expect, it } from 'vitest';

import {
    buildChartRows,
    buildDetailGroups,
    filterDetailGroups,
    getLocalDayBounds
} from './instanceActivityRows.js';

function iso(value) {
    return new Date(value).toISOString();
}

describe('instanceActivityRows', () => {
    it('normalizes current-user chart rows, clips them to the selected local day, and sorts by join time', () => {
        const selectedDate = '2024-01-02';
        const { startMs } = getLocalDayBounds(selectedDate);
        const currentUserId = 'usr_self';

        const rows = buildChartRows(
            [
                {
                    id: 'late',
                    user_id: currentUserId,
                    display_name: 'Self',
                    location: 'wrld_late:2',
                    created_at: iso(startMs + 5 * 60 * 60 * 1000),
                    time: 60 * 60 * 1000
                },
                {
                    id: 'other-user',
                    user_id: 'usr_other',
                    display_name: 'Other',
                    location: 'wrld_other:1',
                    created_at: iso(startMs + 2 * 60 * 60 * 1000),
                    time: 60 * 60 * 1000
                },
                {
                    id: 'traveling',
                    user_id: currentUserId,
                    display_name: 'Self',
                    location: 'traveling:traveling',
                    created_at: iso(startMs + 3 * 60 * 60 * 1000),
                    time: 60 * 60 * 1000
                },
                {
                    id: 'cross-midnight',
                    user_id: currentUserId,
                    display_name: 'Self',
                    location: 'wrld_known:1',
                    created_at: iso(startMs + 2 * 60 * 60 * 1000),
                    time: 4 * 60 * 60 * 1000
                }
            ],
            selectedDate,
            currentUserId,
            {
                wrld_known: { name: 'Known World' }
            }
        );

        expect(rows).toHaveLength(2);
        expect(rows.map((row) => row.id)).toEqual(['cross-midnight', 'late']);
        expect(rows[0]).toMatchObject({
            worldId: 'wrld_known',
            worldName: 'Known World',
            worldResolvedFromCache: true,
            visibleStartMs: startMs,
            visibleDurationMs: 2 * 60 * 60 * 1000
        });
        expect(rows[1]).toMatchObject({
            worldId: 'wrld_late',
            worldName: '',
            visibleStartMs: startMs + 4 * 60 * 60 * 1000,
            visibleDurationMs: 60 * 60 * 1000
        });
    });

    it('groups instance details by current-user overlap and preserves friend markers', () => {
        const { startMs } = getLocalDayBounds('2024-01-02');
        const currentUserId = 'usr_self';
        const location = 'wrld_group:1';
        const rawRows = [
            {
                id: 'self-1',
                user_id: currentUserId,
                display_name: 'Self',
                location,
                created_at: iso(startMs + 60 * 60 * 1000),
                time: 60 * 60 * 1000
            },
            {
                id: 'friend-1',
                user_id: 'usr_friend',
                display_name: 'Friend',
                location,
                created_at: iso(startMs + 45 * 60 * 1000),
                time: 30 * 60 * 1000
            },
            {
                id: 'self-2',
                user_id: currentUserId,
                display_name: 'Self',
                location,
                created_at: iso(startMs + 4 * 60 * 60 * 1000),
                time: 60 * 60 * 1000
            },
            {
                id: 'favorite-1',
                user_id: 'usr_favorite',
                display_name: 'Favorite',
                location,
                created_at: iso(startMs + 3.5 * 60 * 60 * 1000),
                time: 15 * 60 * 1000
            }
        ];

        const groups = buildDetailGroups(
            rawRows,
            rawRows.filter((row) => row.user_id === currentUserId),
            currentUserId,
            new Set(['usr_friend']),
            new Set(['usr_favorite'])
        );

        expect(groups).toHaveLength(2);
        expect(groups.map((group) => group.map((entry) => entry.id))).toEqual([
            ['self-1', 'friend-1'],
            ['self-2', 'favorite-1']
        ]);
        expect(
            groups[0].find((entry) => entry.userId === 'usr_friend')
        ).toMatchObject({
            isFriend: true,
            isFavorite: false
        });
        expect(
            groups[1].find((entry) => entry.userId === 'usr_favorite')
        ).toMatchObject({
            isFriend: true,
            isFavorite: true
        });
        expect(
            groups.flat().filter((entry) => entry.userId === currentUserId)
        ).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    isCurrentUser: true,
                    isFriend: false,
                    isFavorite: false
                })
            ])
        );
    });

    it('filters detail groups according to visibility toggles', () => {
        const soloGroup = [{ id: 'solo', isFriend: false }];
        const noFriendGroup = [
            { id: 'self', isFriend: false },
            { id: 'stranger', isFriend: false }
        ];
        const friendGroup = [
            { id: 'self', isFriend: false },
            { id: 'friend', isFriend: true }
        ];
        const groups = [soloGroup, noFriendGroup, friendGroup];

        expect(
            filterDetailGroups(groups, {
                isDetailVisible: false,
                isSoloInstanceVisible: true,
                isNoFriendInstanceVisible: true
            })
        ).toEqual([]);
        expect(
            filterDetailGroups(groups, {
                isDetailVisible: true,
                isSoloInstanceVisible: false,
                isNoFriendInstanceVisible: true
            })
        ).toEqual([noFriendGroup, friendGroup]);
        expect(
            filterDetailGroups(groups, {
                isDetailVisible: true,
                isSoloInstanceVisible: true,
                isNoFriendInstanceVisible: false
            })
        ).toEqual([soloGroup, friendGroup]);
    });
});
