import { describe, expect, it } from 'vitest';

import { formatScreenshotDateTime } from '@/lib/dateTime';
import { resolveScreenshotCapturedTime } from '@/shared/utils/screenshot';

import {
    DEFAULT_SCREENSHOT_SEARCH_SORT,
    EMPTY_SCREENSHOT_SEARCH,
    formatScreenshotBytes,
    getGalleryFolderPathSet,
    getFileNameFromPath,
    normalizeGalleryScrollPositions,
    normalizeGalleryScrollTop,
    hasScreenshotSearch,
    libraryImageSearchRow,
    normalizeScreenshotMetadata,
    parseScreenshotFilterParam,
    resolveGalleryFolder,
    resolvePathAfterScreenshotDelete,
    SCREENSHOT_FAVORITES_FOLDER,
    screenshotFilterFromScope,
    screenshotScopeFromFilter,
    serializeGalleryScrollPositions,
    sortScreenshotSearchRows
} from './screenshotMetadataValues';

describe('screenshotMetadataValues', () => {
    it('normalizes screenshot metadata so the page can render stable details', () => {
        const metadata = normalizeScreenshotMetadata(
            {
                sourceFile:
                    'D:\\VRChat\\VRChat_1920x1080_2026-04-15_22-10-05.123.png',
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
                previousFolderPath: 'previous-folder',
                nextFilePath: 'next.png',
                nextFolderPath: 'next-folder'
            }
        );

        expect(metadata).toMatchObject({
            filePath: 'D:\\VRChat\\renamed.png',
            fileName: 'renamed.png',
            previousFilePath: 'prev.png',
            previousFolderPath: 'previous-folder',
            nextFilePath: 'next.png',
            nextFolderPath: 'next-folder',
            resolution: '1920x1080',
            fileSizeBytes: 1536,
            world: { id: 'wrld_1', name: 'Great World' },
            author: { id: 'usr_author', displayName: 'Author' },
            players: [{ id: 'usr_ava', displayName: 'Ava' }]
        });
        expect(metadata.dateTime!.toISOString()).toBe(
            '2026-04-16T01:02:03.000Z'
        );
    });

    it('falls back to the VRChat filename date when metadata has no timestamp', () => {
        const metadata = normalizeScreenshotMetadata(
            {
                sourceFile:
                    'D:\\VRChat\\VRChat_2026-04-15_22-10-05.123_1920x1080.png'
            },
            {}
        );

        expect(metadata.fileName).toBe(
            'VRChat_2026-04-15_22-10-05.123_1920x1080.png'
        );
        expect(metadata.dateTime).toBeInstanceOf(Date);
        expect(metadata.dateTime!.getFullYear()).toBe(2026);
        expect(metadata.dateTime!.getMonth()).toBe(3);
        expect(metadata.dateTime!.getDate()).toBe(15);
    });

    it('sorts screenshot search rows by the selected column and keeps newest-first tie breaks', () => {
        const rows = [
            {
                filePath: 'old',
                world: 'zeta',
                playerCount: 3,
                dateTime: new Date('2026-04-01T00:00:00Z')
            },
            {
                filePath: 'new',
                world: 'alpha',
                playerCount: 1,
                dateTime: new Date('2026-04-03T00:00:00Z')
            },
            {
                filePath: 'middle',
                world: 'alpha',
                playerCount: 2,
                dateTime: new Date('2026-04-02T00:00:00Z')
            }
        ];

        expect(
            sortScreenshotSearchRows(rows, DEFAULT_SCREENSHOT_SEARCH_SORT).map(
                (row) => row.filePath
            )
        ).toEqual(['new', 'middle', 'old']);
        expect(
            sortScreenshotSearchRows(rows, { key: 'world', asc: true }).map(
                (row) => row.filePath
            )
        ).toEqual(['new', 'middle', 'old']);
    });

    it('formats screenshot file details without exposing invalid values', () => {
        expect(getFileNameFromPath('D:\\VRChat\\shot.png')).toBe('shot.png');
        expect(formatScreenshotBytes(0)).toBe('');
        expect(formatScreenshotBytes(512)).toBe('512 B');
        expect(formatScreenshotBytes(1536)).toBe('1.5 KB');
        expect(formatScreenshotDateTime(null)).toBe('—');
        expect(formatScreenshotDateTime('invalid')).toBe('—');
    });

    it('normalizes gallery scroll positions for persistence', () => {
        expect(normalizeGalleryScrollTop(-12)).toBe(0);
        expect(normalizeGalleryScrollTop(12.6)).toBe(13);
        expect(normalizeGalleryScrollTop(Number.POSITIVE_INFINITY)).toBe(0);

        const positions = normalizeGalleryScrollPositions({
            'D:\\A': 12.2,
            'D:\\B': -10,
            '': 99
        });

        expect(Array.from(positions.entries())).toEqual([
            ['D:\\A', 12],
            ['D:\\B', 0]
        ]);
        expect(
            serializeGalleryScrollPositions(
                new Map([
                    ['', 1],
                    ['D:\\A', 4.7]
                ])
            )
        ).toEqual({ 'D:\\A': 5 });
    });

    it('resolves gallery folders from preferences, latest folders, and root fallback', () => {
        const folderTree = {
            rootPath: 'D:\\Root',
            folders: [
                {
                    path: 'D:\\Old',
                    parentPath: 'D:\\Root',
                    name: 'Old',
                    imageCount: 2,
                    totalImageCount: 2,
                    latestModifiedAt: 10
                },
                {
                    path: 'D:\\New',
                    parentPath: 'D:\\Root',
                    name: 'New',
                    imageCount: 1,
                    totalImageCount: 1,
                    latestModifiedAt: 20
                },
                {
                    path: 'D:\\Empty',
                    parentPath: 'D:\\Root',
                    name: 'Empty',
                    imageCount: 0,
                    totalImageCount: 0,
                    latestModifiedAt: 99
                }
            ]
        };

        expect(
            resolveGalleryFolder(folderTree, ['D:\\Missing', 'D:\\Old'])
        ).toBe('D:\\Old');
        expect(resolveGalleryFolder(folderTree, '')).toBe('D:\\New');
        expect(getGalleryFolderPathSet(folderTree)).toEqual(
            new Set(['D:\\Old', 'D:\\New', 'D:\\Empty'])
        );
        expect(
            resolveGalleryFolder({ rootPath: 'D:\\Root', folders: [] }, '')
        ).toBe('D:\\Root');
    });

    it('keeps the favorites view selected even though it is not a real folder', () => {
        expect(
            resolveGalleryFolder({ rootPath: 'D:\\Root', folders: [] }, [
                SCREENSHOT_FAVORITES_FOLDER,
                'D:\\Root'
            ])
        ).toBe(SCREENSHOT_FAVORITES_FOLDER);
    });
});

describe('resolvePathAfterScreenshotDelete', () => {
    it('prefers the next neighbour, falls back to the previous one, then to nothing', () => {
        expect(
            resolvePathAfterScreenshotDelete({
                previousFilePath: 'D:\\Photos\\a.png',
                previousFolderPath: 'D:\\Photos',
                nextFilePath: 'D:\\Photos\\2026-05\\c.png',
                nextFolderPath: 'D:\\Photos\\2026-05'
            })
        ).toEqual({
            filePath: 'D:\\Photos\\2026-05\\c.png',
            folderPath: 'D:\\Photos\\2026-05'
        });

        expect(
            resolvePathAfterScreenshotDelete({
                previousFilePath: 'D:\\Photos\\a.png',
                previousFolderPath: 'D:\\Photos',
                nextFilePath: '',
                nextFolderPath: ''
            })
        ).toEqual({
            filePath: 'D:\\Photos\\a.png',
            folderPath: 'D:\\Photos'
        });

        expect(
            resolvePathAfterScreenshotDelete({
                previousFilePath: '',
                previousFolderPath: '',
                nextFilePath: '',
                nextFolderPath: ''
            })
        ).toBeNull();

        expect(resolvePathAfterScreenshotDelete(null)).toBeNull();
    });
});

describe('resolveScreenshotCapturedTime', () => {
    it('prefers the file name capture time over a rewritten file date', () => {
        expect(
            resolveScreenshotCapturedTime({
                capturedAt: null,
                fileName: 'VRChat_2025-01-23_02-13-33.451_1920x1080.png',
                modifiedAt: Date.parse('2025-03-31T20:26:00.000Z')
            })
        ).toBe(new Date(2025, 0, 23, 2, 13, 33, 451).getTime());
    });
});

describe('screenshot search scope', () => {
    it('turns local dates into a whole-day millisecond range and back', () => {
        const scope = {
            ...EMPTY_SCREENSHOT_SEARCH,
            people: ['usr_ava'],
            peopleMatch: 'any' as const,
            worlds: ['wrld_pier'],
            dateFrom: '2026-04-01',
            dateTo: '2026-04-02',
            text: '  pier '
        };
        const filter = screenshotFilterFromScope(scope);

        expect(filter).toMatchObject({
            people: ['usr_ava'],
            peopleMatch: 'any',
            worldIds: ['wrld_pier'],
            fromMs: new Date(2026, 3, 1).getTime(),
            toMs: new Date(2026, 3, 3).getTime(),
            text: 'pier'
        });
        expect(screenshotScopeFromFilter(filter)).toEqual({
            ...scope,
            text: 'pier'
        });
        expect(hasScreenshotSearch(EMPTY_SCREENSHOT_SEARCH)).toBe(false);
        expect(hasScreenshotSearch(scope)).toBe(true);
    });

    it('reads a filter from a link and ignores anything malformed', () => {
        expect(
            parseScreenshotFilterParam(
                JSON.stringify({
                    people: ['usr_ava', 3],
                    fromMs: 'x',
                    text: 'pier'
                })
            )
        ).toEqual({
            people: ['usr_ava'],
            peopleMatch: 'all',
            worldIds: [],
            fromMs: null,
            toMs: null,
            text: 'pier'
        });
        expect(parseScreenshotFilterParam('{not json')).toBeNull();
        expect(parseScreenshotFilterParam('[]')).toBeNull();
    });

    it('builds a result row that names the matched people', () => {
        const row = libraryImageSearchRow(
            {
                path: 'C:\\VRChat\\shot.png',
                folderPath: 'C:\\VRChat',
                fileName: 'shot.png',
                sizeBytes: 1,
                modifiedAt: 1,
                createdAt: null,
                width: 1920,
                height: 1080,
                worldId: 'wrld_pier',
                worldName: 'Night Pier',
                capturedAt: null,
                capturedAtMs: Date.parse('2026-04-16T01:02:03.000Z'),
                metadata: {
                    version: 1,
                    author: { id: 'usr_me', displayName: 'Me' },
                    world: {
                        id: 'wrld_pier',
                        name: 'Night Pier',
                        instanceId: ''
                    },
                    players: [
                        { id: 'usr_ava', displayName: 'Ava Star' },
                        { id: 'usr_ben', displayName: 'Ben' }
                    ]
                },
                error: null
            },
            { ...EMPTY_SCREENSHOT_SEARCH, people: ['usr_ben'], text: 'ava' }
        );

        expect(row).toMatchObject({
            filePath: 'C:\\VRChat\\shot.png',
            world: 'Night Pier',
            author: 'Me',
            playerCount: 2,
            resolution: '1920x1080',
            match: 'Ava Star, Ben'
        });
    });
});
