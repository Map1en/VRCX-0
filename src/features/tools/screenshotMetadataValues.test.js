import { describe, expect, it } from 'vitest';

import {
    buildScreenshotSearchRow,
    DEFAULT_SCREENSHOT_SEARCH_SORT,
    formatScreenshotBytes,
    formatScreenshotDateTime,
    getDroppedScreenshotPath,
    getFileNameFromPath,
    normalizeDroppedFilePath,
    normalizeScreenshotMetadata,
    SCREENSHOT_METADATA_SEARCH_TYPES,
    sortScreenshotRowsByNewest,
    sortScreenshotSearchRows
} from './screenshotMetadataValues.js';

describe('screenshotMetadataValues', () => {
    it('reads a dropped screenshot path from files, file URLs, or plain text', () => {
        expect(getDroppedScreenshotPath({
            dataTransfer: {
                files: [{ path: 'D:\\VRChat\\Photos\\shot.png' }],
                getData: () => ''
            }
        })).toBe('D:\\VRChat\\Photos\\shot.png');

        expect(normalizeDroppedFilePath('\n file:///C:/Users/Alice/Pictures/VRChat%20Shot.png\n')).toBe(
            'C:/Users/Alice/Pictures/VRChat Shot.png'
        );

        expect(getDroppedScreenshotPath({
            dataTransfer: {
                files: [],
                getData: (type) => type === 'text/plain' ? 'D:\\VRChat\\fallback.png' : ''
            }
        })).toBe('D:\\VRChat\\fallback.png');
    });

    it('normalizes screenshot metadata so the page can render stable details', () => {
        const metadata = normalizeScreenshotMetadata(
            {
                sourceFile: 'D:\\VRChat\\VRChat_1920x1080_2026-04-15_22-10-05.123.png',
                world: { id: 'wrld_1', name: 'Great World' },
                author: { id: 'usr_author', displayName: 'Author' },
                players: [{ id: 'usr_ava', displayName: 'Ava' }],
                timestamp: '2026-04-16T01:02:03.000Z'
            },
            {
                filePath: 'D:\\VRChat\\renamed.png',
                resolution: '1920x1080',
                fileSizeBytes: 1536,
                previousFilePath: 'prev.png',
                nextFilePath: 'next.png'
            }
        );

        expect(metadata).toMatchObject({
            filePath: 'D:\\VRChat\\renamed.png',
            fileName: 'renamed.png',
            previousFilePath: 'prev.png',
            nextFilePath: 'next.png',
            resolution: '1920x1080',
            fileSizeBytes: 1536,
            world: { id: 'wrld_1', name: 'Great World' },
            author: { id: 'usr_author', displayName: 'Author' },
            players: [{ id: 'usr_ava', displayName: 'Ava' }]
        });
        expect(metadata.dateTime.toISOString()).toBe('2026-04-16T01:02:03.000Z');
    });

    it('falls back to the VRChat filename date when metadata has no timestamp', () => {
        const metadata = normalizeScreenshotMetadata(
            {
                sourceFile: 'D:\\VRChat\\VRChat_2026-04-15_22-10-05.123_1920x1080.png'
            },
            {}
        );

        expect(metadata.fileName).toBe('VRChat_2026-04-15_22-10-05.123_1920x1080.png');
        expect(metadata.dateTime).toBeInstanceOf(Date);
        expect(metadata.dateTime.getFullYear()).toBe(2026);
        expect(metadata.dateTime.getMonth()).toBe(3);
        expect(metadata.dateTime.getDate()).toBe(15);
    });

    it('builds search rows with visible match text for player name and id searches', () => {
        const normalized = normalizeScreenshotMetadata(
            {
                sourceFile: 'shot.png',
                world: { name: 'Great World' },
                author: { displayName: 'Author' },
                players: [
                    { id: 'usr_ava', displayName: 'Ava Star' },
                    { id: 'usr_ben', displayName: 'Ben' }
                ],
                timestamp: '2026-04-16T01:02:03.000Z'
            },
            { resolution: '1920x1080' }
        );

        expect(buildScreenshotSearchRow(normalized, SCREENSHOT_METADATA_SEARCH_TYPES[0], 'ava')).toMatchObject({
            filePath: 'shot.png',
            world: 'Great World',
            author: 'Author',
            playerCount: 2,
            resolution: '1920x1080',
            match: 'Ava Star'
        });
        expect(buildScreenshotSearchRow(normalized, SCREENSHOT_METADATA_SEARCH_TYPES[1], 'usr_ben')).toMatchObject({
            match: 'Ben'
        });
    });

    it('sorts screenshot search rows by the selected column and keeps newest-first tie breaks', () => {
        const rows = [
            { filePath: 'old', world: 'zeta', playerCount: 3, dateTime: new Date('2026-04-01T00:00:00Z') },
            { filePath: 'new', world: 'alpha', playerCount: 1, dateTime: new Date('2026-04-03T00:00:00Z') },
            { filePath: 'middle', world: 'alpha', playerCount: 2, dateTime: new Date('2026-04-02T00:00:00Z') }
        ];

        expect(sortScreenshotSearchRows(rows, DEFAULT_SCREENSHOT_SEARCH_SORT).map((row) => row.filePath)).toEqual([
            'new',
            'middle',
            'old'
        ]);
        expect(sortScreenshotSearchRows(rows, { key: 'world', asc: true }).map((row) => row.filePath)).toEqual([
            'new',
            'middle',
            'old'
        ]);
        expect(sortScreenshotRowsByNewest([null, ...rows]).map((row) => row.filePath)).toEqual([
            'new',
            'middle',
            'old'
        ]);
    });

    it('formats screenshot file details without exposing invalid values', () => {
        expect(getFileNameFromPath('D:\\VRChat\\shot.png')).toBe('shot.png');
        expect(formatScreenshotBytes(0)).toBe('');
        expect(formatScreenshotBytes(512)).toBe('512 B');
        expect(formatScreenshotBytes(1536)).toBe('1.5 KB');
        expect(formatScreenshotDateTime(null)).toBe('—');
        expect(formatScreenshotDateTime('invalid')).toBe('—');
    });
});
