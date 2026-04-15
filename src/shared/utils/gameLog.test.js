import { describe, expect, it } from 'vitest';

import {
    buildGameLogSessions,
    compareGameLogRows,
    gameLogSearchFilter,
    parseInventoryFromUrl,
    parsePrintFromUrl
} from './gameLog.js';

describe('gameLog utilities', () => {
    it('builds newest-first sessions, removes duplicate events, and collapses repeated video plays', () => {
        const result = buildGameLogSessions([
            {
                id: 1,
                created_at: '2024-01-01T10:00:00.000Z',
                location: 'wrld_old:1',
                worldId: 'wrld_old',
                worldName: 'Old World',
                time: 60
            },
            {
                id: 2,
                created_at: '2024-01-01T11:00:00.000Z',
                location: 'wrld_new:1',
                worldId: 'wrld_new',
                worldName: 'New World'
            }
        ], [
            {
                type: 'OnPlayerJoined',
                created_at: '2024-01-01T10:00:01.000Z',
                location: 'wrld_old:1',
                userId: 'usr_a',
                displayName: 'A'
            },
            {
                type: 'OnPlayerJoined',
                created_at: '2024-01-01T10:00:01.000Z',
                location: 'wrld_old:1',
                userId: 'usr_a',
                displayName: 'A'
            },
            {
                type: 'VideoPlay',
                created_at: '2024-01-01T11:00:01.000Z',
                location: 'wrld_new:1',
                videoUrl: 'https://video.example.test/a',
                videoName: 'Clip'
            },
            {
                type: 'VideoPlay',
                created_at: '2024-01-01T11:00:02.000Z',
                location: 'wrld_new:1',
                videoUrl: 'https://video.example.test/a',
                videoName: 'Clip'
            }
        ]);

        expect(result.segments.map((segment) => segment.worldId)).toEqual([
            'wrld_new',
            'wrld_old'
        ]);
        expect(result.segments[0].events).toEqual([
            expect.objectContaining({
                type: 'VideoPlay',
                videoUrl: 'https://video.example.test/a',
                playCount: 2
            })
        ]);
        expect(result.segments[1].events).toEqual([
            expect.objectContaining({
                type: 'OnPlayerJoined',
                userId: 'usr_a'
            })
        ]);
    });

    it('groups burst joins near the session start and drops matching start leaves', () => {
        const result = buildGameLogSessions([
            {
                id: 1,
                created_at: '2024-01-01T10:00:00.000Z',
                location: 'wrld_session:1',
                worldId: 'wrld_session',
                worldName: 'Session World'
            }
        ], [
            ...Array.from({ length: 5 }, (_, index) => ({
                type: 'OnPlayerJoined',
                created_at: `2024-01-01T10:00:0${index}.000Z`,
                location: 'wrld_session:1',
                userId: `usr_${index}`,
                displayName: `User ${index}`,
                isFriend: index % 2 === 0,
                isFavorite: false
            })),
            {
                type: 'OnPlayerLeft',
                created_at: '2024-01-01T10:00:02.000Z',
                location: 'wrld_session:1',
                userId: 'usr_0',
                displayName: 'User 0'
            }
        ]);

        expect(result.segments[0].events).toEqual([
            {
                type: 'JoinGroup',
                created_at: '2024-01-01T10:00:00.000Z',
                count: 5,
                members: expect.arrayContaining([
                    expect.objectContaining({
                        userId: 'usr_0',
                        displayName: 'User 0',
                        isFriend: true
                    }),
                    expect.objectContaining({
                        userId: 'usr_4',
                        displayName: 'User 4'
                    })
                ])
            }
        ]);
    });

    it('filters and orders log rows by user-facing searchable fields', () => {
        expect(gameLogSearchFilter({
            type: 'Location',
            worldName: 'The Great Pug',
            location: 'wrld_pug:123'
        }, 'pug')).toBe(true);
        expect(gameLogSearchFilter({
            type: 'VideoPlay',
            displayName: 'DJ',
            videoName: 'Opening',
            videoUrl: 'https://example.test/song'
        }, 'song')).toBe(true);
        expect(gameLogSearchFilter({
            type: 'OnPlayerJoined',
            displayName: 'Someone'
        }, 'missing')).toBe(false);

        expect([
            { created_at: '2024-01-01T10:00:00.000Z', rowId: 1, uid: 'a' },
            { created_at: '2024-01-01T10:00:00.000Z', rowId: 2, uid: 'b' },
            { created_at: '2024-01-01T11:00:00.000Z', rowId: 1, uid: 'c' }
        ].sort(compareGameLogRows)).toEqual([
            { created_at: '2024-01-01T11:00:00.000Z', rowId: 1, uid: 'c' },
            { created_at: '2024-01-01T10:00:00.000Z', rowId: 2, uid: 'b' },
            { created_at: '2024-01-01T10:00:00.000Z', rowId: 1, uid: 'a' }
        ]);
    });

    it('parses inventory and print ids only from expected API paths', () => {
        expect(parseInventoryFromUrl(
            'https://api.vrchat.cloud/api/1/user/usr_032383a7-748c-4fb2-94e4-bcb928e5de6b/inventory/inv_75781d65-92fe-4a80-a1ff-27ee6e843b08'
        )).toEqual({
            userId: 'usr_032383a7-748c-4fb2-94e4-bcb928e5de6b',
            inventoryId: 'inv_75781d65-92fe-4a80-a1ff-27ee6e843b08'
        });
        expect(parsePrintFromUrl(
            'https://api.vrchat.cloud/api/1/prints/prnt_75781d65-92fe-4a80-a1ff-27ee6e843b08'
        )).toBe('prnt_75781d65-92fe-4a80-a1ff-27ee6e843b08');

        expect(parseInventoryFromUrl('not a url')).toBeNull();
        expect(parsePrintFromUrl('https://api.vrchat.cloud/api/1/files/file_abc')).toBeNull();
    });
});
