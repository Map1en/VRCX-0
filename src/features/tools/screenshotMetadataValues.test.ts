import { describe, expect, it } from 'vitest';

import { formatScreenshotDateTime } from '@/lib/dateTime';
import { resolveScreenshotCapturedTime } from '@/shared/utils/screenshot';

import {
    buildScreenshotSearchRow,
    DEFAULT_SCREENSHOT_SEARCH_SORT,
    formatScreenshotBytes,
    getDroppedScreenshotPath,
    getGalleryFolderPathSet,
    getFileNameFromPath,
    normalizeGalleryScrollPositions,
    normalizeGalleryScrollTop,
    normalizeDroppedFilePath,
    normalizeScreenshotMetadata,
    normalizeScreenshotSearchResult,
    pickRandomScreenshotPath,
    resolveGalleryFolder,
    resolvePathAfterScreenshotDelete,
    searchResultToLibraryImage,
    SCREENSHOT_METADATA_SEARCH_TYPES,
    serializeGalleryScrollPositions,
    sortScreenshotRowsByNewest,
    sortScreenshotSearchRows
} from './screenshotMetadataValues';

describe('screenshotMetadataValues', () => {
    it('reads a dropped screenshot path from files, file URLs, or plain text', () => {
        expect(
            getDroppedScreenshotPath({
                dataTransfer: {
                    files: [{ path: 'D:\\VRChat\\Photos\\shot.png' }],
                    getData: () => ''
                }
            })
        ).toBe('D:\\VRChat\\Photos\\shot.png');

        expect(
            normalizeDroppedFilePath(
                '\n file:///C:/Users/Alice/Pictures/VRChat%20Shot.png\n'
            )
        ).toBe('C:/Users/Alice/Pictures/VRChat Shot.png');

        expect(
            getDroppedScreenshotPath({
                dataTransfer: {
                    files: [],
                    getData: (type: string) =>
                        type === 'text/plain' ? 'D:\\VRChat\\fallback.png' : ''
                }
            })
        ).toBe('D:\\VRChat\\fallback.png');
    });

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

    it('normalizes typed search results into the same shape as metadata + extra data', () => {
        const normalized = normalizeScreenshotSearchResult({
            filePath: 'D:\\VRChat\\shot.png',
            fileName: 'shot.png',
            fileSizeBytes: 2048,
            creationDate: '2026-04-16T01:02:03.000Z',
            width: 1920,
            height: 1080,
            metadata: {
                sourceFile: 'D:\\VRChat\\shot.png',
                world: { id: 'wrld_1', name: 'Great World' },
                author: { id: 'usr_author', displayName: 'Author' },
                players: [{ id: 'usr_ava', displayName: 'Ava' }]
            }
        });

        expect(normalized).toMatchObject({
            filePath: 'D:\\VRChat\\shot.png',
            fileName: 'shot.png',
            fileSizeBytes: 2048,
            resolution: '1920x1080',
            world: { id: 'wrld_1', name: 'Great World' },
            author: { id: 'usr_author', displayName: 'Author' },
            players: [{ id: 'usr_ava', displayName: 'Ava' }]
        });
        expect(normalized.dateTime!.toISOString()).toBe(
            '2026-04-16T01:02:03.000Z'
        );

        const degenerate = normalizeScreenshotSearchResult({
            filePath: 'D:\\VRChat\\broken.png',
            fileName: 'broken.png',
            fileSizeBytes: 0,
            creationDate: null,
            width: null,
            height: null,
            metadata: null
        });
        expect(degenerate.resolution).toBe('');
        expect(degenerate.dateTime).toBeNull();
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

        expect(
            buildScreenshotSearchRow(
                normalized,
                SCREENSHOT_METADATA_SEARCH_TYPES[0],
                'ava'
            )
        ).toMatchObject({
            filePath: 'shot.png',
            world: 'Great World',
            author: 'Author',
            playerCount: 2,
            resolution: '1920x1080',
            match: 'Ava Star'
        });
        expect(
            buildScreenshotSearchRow(
                normalized,
                SCREENSHOT_METADATA_SEARCH_TYPES[1],
                'usr_ben'
            )
        ).toMatchObject({
            match: 'Ben'
        });
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
        expect(
            sortScreenshotRowsByNewest(rows).map((row) => row.filePath)
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

describe('pickRandomScreenshotPath', () => {
    const images = [{ path: 'a.png' }, { path: 'b.png' }, { path: 'c.png' }];

    it('maps the random value across the whole list and clamps the upper bound', () => {
        expect(pickRandomScreenshotPath(images, 0)).toBe('a.png');
        expect(pickRandomScreenshotPath(images, 0.5)).toBe('b.png');
        expect(pickRandomScreenshotPath(images, 0.999)).toBe('c.png');
        expect(pickRandomScreenshotPath(images, 1)).toBe('c.png');
    });

    it('returns nothing when there is no image to open', () => {
        expect(pickRandomScreenshotPath([], 0.5)).toBe('');
    });
});

describe('searchResultToLibraryImage', () => {
    it('maps a search result onto the library image shape the thumbnail grid renders', () => {
        expect(
            searchResultToLibraryImage({
                filePath: 'C:\\VRChat\\2026-07\\shot.png',
                fileName: 'shot.png',
                fileSizeBytes: 2048,
                creationDate: '2026-04-16T01:02:03.000Z',
                width: 1920,
                height: 1080,
                metadata: {
                    author: { id: 'usr_author', displayName: 'Author' },
                    world: {
                        id: 'wrld_1',
                        name: 'Great World',
                        instanceId: 'wrld_1:12345'
                    },
                    players: [],
                    timestamp: '2026-04-16T01:02:03.000Z'
                }
            })
        ).toMatchObject({
            path: 'C:\\VRChat\\2026-07\\shot.png',
            folderPath: 'C:\\VRChat\\2026-07',
            fileName: 'shot.png',
            sizeBytes: 2048,
            modifiedAt: Date.parse('2026-04-16T01:02:03.000Z'),
            width: 1920,
            height: 1080,
            worldId: 'wrld_1',
            worldName: 'Great World',
            capturedAt: '2026-04-16T01:02:03.000Z',
            error: null
        });
    });

    it('falls back to the capture time encoded in the file name', () => {
        expect(
            resolveScreenshotCapturedTime(
                searchResultToLibraryImage({
                    filePath:
                        'C:\\VRChat\\2025-01\\VRChat_2025-01-05_02-24-53.276_3840x2160.png',
                    fileName: 'VRChat_2025-01-05_02-24-53.276_3840x2160.png',
                    fileSizeBytes: 2048,
                    creationDate: '2025-03-31T20:15:00.000Z',
                    width: 3840,
                    height: 2160,
                    metadata: null
                })
            )
        ).toBe(new Date(2025, 0, 5, 2, 24, 53, 276).getTime());
    });

    it('prefers the file name capture time over a rewritten file date', () => {
        expect(
            resolveScreenshotCapturedTime({
                capturedAt: null,
                fileName: 'VRChat_2025-01-23_02-13-33.451_1920x1080.png',
                modifiedAt: Date.parse('2025-03-31T20:26:00.000Z')
            })
        ).toBe(new Date(2025, 0, 23, 2, 13, 33, 451).getTime());
    });

    it('keeps posix folders and degrades missing metadata and dates', () => {
        expect(
            searchResultToLibraryImage({
                filePath: '/home/ava/Pictures/VRChat/shot.png',
                fileName: 'shot.png',
                fileSizeBytes: 0,
                creationDate: null,
                width: null,
                height: null,
                metadata: null
            })
        ).toMatchObject({
            folderPath: '/home/ava/Pictures/VRChat',
            modifiedAt: 0,
            createdAt: null,
            worldId: null,
            worldName: null,
            capturedAt: null,
            metadata: null
        });
    });
});
