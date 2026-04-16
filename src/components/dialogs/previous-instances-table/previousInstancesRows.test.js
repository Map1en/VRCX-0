import { describe, expect, it } from 'vitest';

import {
    normalizeInfoChartRows,
    normalizePlayerRows,
    playerDisplayName,
    playerUserId,
    rowLocationObject,
    rowSearchText
} from './previousInstancesRows.js';

describe('previousInstancesRows', () => {
    it('normalizes player maps and sorts by duration descending', () => {
        const players = new Map([
            ['short', { user_id: 'usr_short', time: 1000 }],
            ['long', { user_id: 'usr_long', time: 3000 }]
        ]);

        expect(normalizePlayerRows(players).map((row) => row.user_id)).toEqual([
            'usr_long',
            'usr_short'
        ]);
        expect(normalizePlayerRows(null)).toEqual([]);
    });

    it('does not reorder array inputs when sorting player rows for display', () => {
        const players = [
            { user_id: 'usr_short', time: 1000 },
            { user_id: 'usr_long', time: 3000 }
        ];

        expect(normalizePlayerRows(players).map((row) => row.user_id)).toEqual([
            'usr_long',
            'usr_short'
        ]);
        expect(players.map((row) => row.user_id)).toEqual([
            'usr_short',
            'usr_long'
        ]);
    });

    it('reads player display names and ids from both camelCase and snake_case fields', () => {
        expect(playerDisplayName({ displayName: 'Camel' })).toBe('Camel');
        expect(playerDisplayName({ display_name: 'Snake' })).toBe('Snake');
        expect(playerUserId({ userId: 'usr_camel' })).toBe('usr_camel');
        expect(playerUserId({ user_id: 'usr_snake' })).toBe('usr_snake');
    });

    it('merges parsed locations with explicit location metadata', () => {
        const location = rowLocationObject({
            location: 'wrld_base:1',
            worldName: 'Base World',
            owner_user_id: 'usr_owner',
            $location: {
                tag: 'wrld_override:2',
                worldName: 'Override World',
                groupName: 'Group',
                ownerUserId: 'usr_location_owner'
            }
        });

        expect(location).toMatchObject({
            tag: 'wrld_override:2',
            location: 'wrld_override:2',
            worldId: 'wrld_override',
            worldName: 'Override World',
            groupName: 'Group',
            ownerUserId: 'usr_location_owner',
            userId: 'usr_location_owner'
        });
    });

    it('normalizes chart rows and keeps current-user relationship markers neutral', () => {
        const rows = normalizeInfoChartRows(
            [
                {
                    user_id: 'usr_self',
                    display_name: 'Self',
                    created_at: '2024-01-02T02:00:00.000Z',
                    time: 60 * 60 * 1000
                },
                {
                    userId: 'usr_friend',
                    displayName: 'Friend',
                    createdAt: '2024-01-02T03:00:00.000Z',
                    time: 30 * 60 * 1000
                },
                {
                    userId: 'usr_favorite',
                    displayName: 'Favorite',
                    createdAt: '2024-01-02T04:00:00.000Z',
                    time: 15 * 60 * 1000
                },
                {
                    displayName: 'Missing id',
                    createdAt: '2024-01-02T05:00:00.000Z',
                    time: 15 * 60 * 1000
                }
            ],
            'usr_self',
            { usr_friend: true },
            new Set(['usr_favorite'])
        );

        expect(rows).toHaveLength(3);
        expect(rows[0]).toMatchObject({
            userId: 'usr_self',
            displayName: 'Self',
            durationMs: 60 * 60 * 1000,
            isFriend: null,
            isFavorite: null
        });
        expect(rows[1]).toMatchObject({
            userId: 'usr_friend',
            displayName: 'Friend',
            isFriend: true,
            isFavorite: false
        });
        expect(rows[2]).toMatchObject({
            userId: 'usr_favorite',
            displayName: 'Favorite',
            isFriend: false,
            isFavorite: true
        });
        expect(rows[0].joinMs).toBe(
            new Date('2024-01-02T01:00:00.000Z').getTime()
        );
    });

    it('builds lower-case search text from instance fields', () => {
        expect(
            rowSearchText({
                created_at: '2024-01-02',
                location: 'WRLD_Base:1',
                worldName: 'Test World',
                groupName: 'Raid Group',
                $location: { tag: 'WRLD_Override:2' }
            })
        ).toContain('test world');
        expect(
            rowSearchText({
                location: 'WRLD_Base:1',
                worldName: 'Test World',
                groupName: 'Raid Group'
            })
        ).toBe('wrld_base:1 test world raid group');
    });
});
