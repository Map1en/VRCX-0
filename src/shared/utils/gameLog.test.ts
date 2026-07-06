import { describe, expect, it } from 'vitest';

import {
    compareGameLogRows,
    gameLogSearchFilter,
    parseInventoryFromUrl,
    parsePrintFromUrl
} from './gameLog';

describe('gameLog utilities', () => {
    it('filters and orders log rows by user-facing searchable fields', () => {
        expect(
            gameLogSearchFilter(
                {
                    type: 'Location',
                    worldName: 'The Great Pug',
                    location: 'wrld_pug:123'
                },
                'pug'
            )
        ).toBe(true);
        expect(
            gameLogSearchFilter(
                {
                    type: 'VideoPlay',
                    displayName: 'DJ',
                    videoName: 'Opening',
                    videoUrl: 'https://example.test/song'
                },
                'song'
            )
        ).toBe(true);
        expect(
            gameLogSearchFilter(
                {
                    type: 'OnPlayerJoined',
                    displayName: 'Someone'
                },
                'missing'
            )
        ).toBe(false);

        expect(
            [
                { created_at: '2024-01-01T10:00:00.000Z', rowId: 1, uid: 'a' },
                { created_at: '2024-01-01T10:00:00.000Z', rowId: 2, uid: 'b' },
                { created_at: '2024-01-01T11:00:00.000Z', rowId: 1, uid: 'c' }
            ].sort(compareGameLogRows)
        ).toEqual([
            { created_at: '2024-01-01T11:00:00.000Z', rowId: 1, uid: 'c' },
            { created_at: '2024-01-01T10:00:00.000Z', rowId: 2, uid: 'b' },
            { created_at: '2024-01-01T10:00:00.000Z', rowId: 1, uid: 'a' }
        ]);
    });

    it('parses inventory and print ids only from expected API paths', () => {
        expect(
            parseInventoryFromUrl(
                'https://api.vrchat.cloud/api/1/user/usr_032383a7-748c-4fb2-94e4-bcb928e5de6b/inventory/inv_75781d65-92fe-4a80-a1ff-27ee6e843b08'
            )
        ).toEqual({
            userId: 'usr_032383a7-748c-4fb2-94e4-bcb928e5de6b',
            inventoryId: 'inv_75781d65-92fe-4a80-a1ff-27ee6e843b08'
        });
        expect(
            parsePrintFromUrl(
                'https://api.vrchat.cloud/api/1/prints/prnt_75781d65-92fe-4a80-a1ff-27ee6e843b08'
            )
        ).toBe('prnt_75781d65-92fe-4a80-a1ff-27ee6e843b08');

        expect(parseInventoryFromUrl('not a url')).toBeNull();
        expect(
            parsePrintFromUrl('https://api.vrchat.cloud/api/1/files/file_abc')
        ).toBeNull();
    });
});
