import { describe, expect, it } from 'vitest';

import {
    buildFavoriteExportCsv,
    FAVORITES_EXPORT_ALL_VALUE,
    FAVORITES_EXPORT_NONE_VALUE,
    getFavoriteExportFieldOptions
} from './favoritesExport.js';

describe('favorite export helpers', () => {
    it('keeps export select sentinel values stable', () => {
        expect(FAVORITES_EXPORT_ALL_VALUE).toBe('__all__');
        expect(FAVORITES_EXPORT_NONE_VALUE).toBe('__none__');
    });

    it('returns friend export fields for friends and entity fields for worlds or avatars', () => {
        expect(getFavoriteExportFieldOptions('friend').map((option) => option.value)).toEqual([
            'id',
            'name',
            'status',
            'group',
            'source'
        ]);
        expect(getFavoriteExportFieldOptions('world').map((option) => option.value)).toEqual([
            'id',
            'name',
            'author',
            'thumbnail',
            'group',
            'source'
        ]);
    });

    it('exports favorite friends with user-facing labels and CSV escaping', () => {
        expect(
            buildFavoriteExportCsv(
                [
                    {
                        id: 'usr_1',
                        title: 'Maple, Test',
                        statusLabel: 'online',
                        groupLabel: 'Best Friends',
                        source: 'remote'
                    }
                ],
                'friend',
                ['name', 'status', 'group']
            )
        ).toBe('Name,Status,Group\n"Maple, Test",online,Best Friends');
    });

    it('exports worlds and avatars using author and thumbnail fields', () => {
        expect(
            buildFavoriteExportCsv(
                [
                    {
                        id: 'wrld_1',
                        title: 'Hangout',
                        subtitle: 'World Author',
                        imageUrl: 'https://example.test/thumb.png',
                        groupKey: 'worlds1',
                        source: 'local'
                    }
                ],
                'world'
            )
        ).toBe(
            'ID,Name,Author,Thumbnail,Group,Source\nwrld_1,Hangout,World Author,https://example.test/thumb.png,worlds1,local'
        );
    });
});
