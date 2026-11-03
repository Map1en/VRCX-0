import { parseDateInput, toDateInputValue } from '@/lib/dateRange';
import { formatScreenshotDateTime } from '@/lib/dateTime';
import type {
    AuthorDetail,
    PlayerDetail,
    ScreenshotFolderInfo,
    ScreenshotFolderTree,
    ScreenshotLibraryImage,
    ScreenshotFilter,
    ScreenshotMetadata,
    ScreenshotPeopleMatch,
    WorldDetail
} from '@/platform/tauri/bindings';
import { SCREENSHOT_GALLERY_CONFIG_KEYS } from '@/repositories/configKeys';
import { isRecord } from '@/shared/utils/record';
import { parseVrchatScreenshotDateFromFileName } from '@/shared/utils/screenshot';

export type ScreenshotSearchScope = {
    people: string[];
    worlds: string[];
    peopleMatch: ScreenshotPeopleMatch;
    dateFrom: string;
    dateTo: string;
    text: string;
};

export const EMPTY_SCREENSHOT_SEARCH: ScreenshotSearchScope = {
    people: [],
    worlds: [],
    peopleMatch: 'all',
    dateFrom: '',
    dateTo: '',
    text: ''
};

export function hasScreenshotSearch(scope: ScreenshotSearchScope): boolean {
    return Boolean(
        scope.people.length ||
        scope.worlds.length ||
        scope.dateFrom ||
        scope.dateTo ||
        scope.text.trim()
    );
}

export function screenshotFilterFromScope(
    scope: ScreenshotSearchScope
): ScreenshotFilter {
    const from = parseDateInput(scope.dateFrom);
    const to = parseDateInput(scope.dateTo);
    to?.setDate(to.getDate() + 1);
    return {
        people: scope.people,
        peopleMatch: scope.peopleMatch,
        worldIds: scope.worlds,
        fromMs: from ? from.getTime() : null,
        toMs: to ? to.getTime() : null,
        text: scope.text.trim()
    };
}

export function screenshotScopeFromFilter(
    filter: Partial<ScreenshotFilter>
): ScreenshotSearchScope {
    return {
        people: filter.people ?? [],
        worlds: filter.worldIds ?? [],
        peopleMatch: filter.peopleMatch === 'any' ? 'any' : 'all',
        dateFrom: filter.fromMs
            ? toDateInputValue(new Date(filter.fromMs))
            : '',
        dateTo: filter.toMs ? toDateInputValue(new Date(filter.toMs - 1)) : '',
        text: filter.text ?? ''
    };
}

function stringList(value: unknown): string[] {
    return Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string')
        : [];
}

function finiteNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function parseScreenshotFilterParam(
    value: string
): Partial<ScreenshotFilter> | null {
    let parsed: unknown;
    try {
        parsed = JSON.parse(value);
    } catch {
        return null;
    }
    if (!isRecord(parsed)) {
        return null;
    }
    return {
        people: stringList(parsed.people),
        peopleMatch: parsed.peopleMatch === 'any' ? 'any' : 'all',
        worldIds: stringList(parsed.worldIds),
        fromMs: finiteNumber(parsed.fromMs),
        toMs: finiteNumber(parsed.toMs),
        text: typeof parsed.text === 'string' ? parsed.text : ''
    };
}

export function libraryImageSearchRow(
    image: ScreenshotLibraryImage,
    scope: ScreenshotSearchScope,
    locale?: string
): ScreenshotSearchRow {
    const players = image.metadata?.players ?? [];
    const text = scope.text.trim().toLowerCase();
    const matched = players.filter(
        (player) =>
            scope.people.includes(player.id ?? '') ||
            (text && (player.displayName ?? '').toLowerCase().includes(text))
    );
    const dateTime =
        image.capturedAtMs > 0 ? new Date(image.capturedAtMs) : null;
    return {
        filePath: image.path,
        dateTime,
        dateLabel: formatScreenshotDateTime(dateTime, locale),
        world: image.worldName || '—',
        author: image.metadata?.author.displayName || '—',
        playerCount: players.length,
        resolution:
            image.width && image.height
                ? `${image.width}x${image.height}`
                : '—',
        match:
            matched.map((player) => player.displayName ?? '').join(', ') || '—'
    };
}

export type ScreenshotSearchSort = {
    asc: boolean;
    key: string;
};

export type ScreenshotSearchRow = Record<string, unknown> & {
    filePath: string;
    dateTime: Date | null;
    playerCount: number;
    dateLabel?: string;
    world: string;
    author?: string;
    resolution?: string;
    match?: string;
};

export type NormalizedScreenshotMetadata = {
    filePath: string;
    fileName: string;
    previousFilePath: string;
    previousFolderPath: string;
    nextFilePath: string;
    nextFolderPath: string;
    resolution: string;
    fileSizeBytes: number;
    dateTime: Date | null;
    world: WorldDetail;
    author: AuthorDetail;
    players: PlayerDetail[];
    note: string;
    application: string;
};

type ScreenshotExtraData = Record<string, unknown> & {
    filePath?: string | null;
    fileName?: string | null;
    previousFilePath?: string | null;
    previousFolderPath?: string | null;
    nextFilePath?: string | null;
    nextFolderPath?: string | null;
    resolution?: string | null;
    fileSizeBytes?: number | null;
    creationDate?: string | null;
};

function stringValue(value: unknown): string {
    return typeof value === 'string' ? value : String(value ?? '');
}

export const DEFAULT_SCREENSHOT_SEARCH_SORT: ScreenshotSearchSort = {
    key: 'dateTime',
    asc: false
};

export const SCREENSHOT_GALLERY_FOLDER_CONFIG_KEY =
    SCREENSHOT_GALLERY_CONFIG_KEYS.folder;
export const SCREENSHOT_GALLERY_SCROLL_CONFIG_KEY =
    SCREENSHOT_GALLERY_CONFIG_KEYS.scrollPositions;
export const SCREENSHOT_SEARCH_LAYOUT_CONFIG_KEY =
    SCREENSHOT_GALLERY_CONFIG_KEYS.searchLayout;
export const SCREENSHOT_GALLERY_SCROLL_SAVE_DELAY_MS = 500;
const MAX_SCREENSHOT_GALLERY_SCROLL_POSITIONS = 100;
const MAX_SCREENSHOT_GALLERY_SCROLL_TOP = 50_000_000;

export function normalizeGalleryScrollTop(value: unknown): number {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return 0;
    }
    return Math.min(
        MAX_SCREENSHOT_GALLERY_SCROLL_TOP,
        Math.max(0, Math.round(numeric))
    );
}

export function normalizeGalleryScrollPositions(
    value: unknown
): Map<string, number> {
    const entries =
        value && typeof value === 'object' && !Array.isArray(value)
            ? Object.entries(value)
            : [];
    const positions = new Map();

    for (const [path, scrollTop] of entries) {
        if (!path || typeof path !== 'string') {
            continue;
        }
        positions.set(path, normalizeGalleryScrollTop(scrollTop));
        if (positions.size >= MAX_SCREENSHOT_GALLERY_SCROLL_POSITIONS) {
            break;
        }
    }

    return positions;
}

export function serializeGalleryScrollPositions(
    positions: Map<string, number>
): Record<string, number> {
    const result: Record<string, number> = {};
    const entries = Array.from(positions.entries())
        .filter(([path]) => Boolean(path))
        .slice(-MAX_SCREENSHOT_GALLERY_SCROLL_POSITIONS);
    for (const [path, scrollTop] of entries) {
        result[path] = normalizeGalleryScrollTop(scrollTop);
    }
    return result;
}

export function getGalleryFolderPathSet(
    folderTree: ScreenshotFolderTree | null | undefined
) {
    return new Set(
        (folderTree?.folders ?? []).map((folder) => folder.path).filter(Boolean)
    );
}

function getFolderLatestModifiedAt(folder: ScreenshotFolderInfo) {
    return folder.latestModifiedAt ?? 0;
}

export function resolvePathAfterScreenshotDelete(
    metadata: Pick<
        NormalizedScreenshotMetadata,
        | 'nextFilePath'
        | 'nextFolderPath'
        | 'previousFilePath'
        | 'previousFolderPath'
    > | null
) {
    if (metadata?.nextFilePath) {
        return {
            filePath: metadata.nextFilePath,
            folderPath: metadata.nextFolderPath
        };
    }
    if (metadata?.previousFilePath) {
        return {
            filePath: metadata.previousFilePath,
            folderPath: metadata.previousFolderPath
        };
    }
    return null;
}

export const SCREENSHOT_FAVORITES_FOLDER = '::favorites';
export const SCREENSHOT_TIMELINE_FOLDER = '::timeline';
export const SCREENSHOT_WORLDS_FOLDER = '::worlds';
export const SCREENSHOT_PEOPLE_FOLDER = '::people';

const SCREENSHOT_VIRTUAL_FOLDERS: ReadonlySet<string> = new Set([
    SCREENSHOT_FAVORITES_FOLDER,
    SCREENSHOT_TIMELINE_FOLDER,
    SCREENSHOT_WORLDS_FOLDER,
    SCREENSHOT_PEOPLE_FOLDER
]);

export function isScreenshotVirtualFolder(folder: string) {
    return SCREENSHOT_VIRTUAL_FOLDERS.has(folder);
}

export function resolveGalleryFolder(
    folderTree: ScreenshotFolderTree | null | undefined,
    preferredFolders: string | readonly string[]
) {
    const folders = folderTree?.folders ?? [];
    const preferredList = Array.isArray(preferredFolders)
        ? preferredFolders
        : [preferredFolders];
    for (const preferredFolder of preferredList) {
        if (
            isScreenshotVirtualFolder(preferredFolder) ||
            (preferredFolder &&
                folders.some((folder) => folder.path === preferredFolder))
        ) {
            return preferredFolder;
        }
    }
    const latestFolder = folders
        .filter((folder) => folder.imageCount > 0)
        .sort(
            (left, right) =>
                getFolderLatestModifiedAt(right) -
                    getFolderLatestModifiedAt(left) ||
                right.path.localeCompare(left.path)
        )[0];
    return latestFolder?.path || folderTree?.rootPath || folders[0]?.path || '';
}

function getScreenshotSearchSortValue(row: ScreenshotSearchRow, key: string) {
    if (key === 'dateTime') {
        return row.dateTime?.getTime() ?? 0;
    }
    if (key === 'playerCount') {
        return row.playerCount;
    }
    return String(row[key] || '').toLowerCase();
}

export function sortScreenshotSearchRows(
    rows: ScreenshotSearchRow[],
    sort: ScreenshotSearchSort
): ScreenshotSearchRow[] {
    const sortKey = sort.key || DEFAULT_SCREENSHOT_SEARCH_SORT.key;
    const direction = sort.asc ? 1 : -1;
    return [...rows].sort((left, right) => {
        const leftValue = getScreenshotSearchSortValue(left, sortKey);
        const rightValue = getScreenshotSearchSortValue(right, sortKey);
        if (leftValue < rightValue) {
            return -1 * direction;
        }
        if (leftValue > rightValue) {
            return 1 * direction;
        }
        const leftTime = left.dateTime?.getTime() ?? 0;
        const rightTime = right.dateTime?.getTime() ?? 0;
        return rightTime - leftTime;
    });
}

export function formatScreenshotBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) {
        return '';
    }

    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex += 1;
    }

    const precision = size >= 100 || unitIndex === 0 ? 0 : 1;
    return `${size.toFixed(precision)} ${units[unitIndex]}`;
}

export function getFileNameFromPath(path: unknown) {
    return (
        String(path || '')
            .split(/[\\/]/)
            .filter(Boolean)
            .at(-1) || ''
    );
}

function resolveScreenshotMetadataDate(
    metadata: Partial<ScreenshotMetadata>,
    extra: ScreenshotExtraData,
    fileName: string
) {
    if (metadata?.timestamp) {
        const parsed = Date.parse(metadata.timestamp);
        if (Number.isFinite(parsed)) {
            return new Date(parsed);
        }
    }

    const fileNameTimestamp = parseVrchatScreenshotDateFromFileName(fileName);
    if (fileNameTimestamp !== null && Number.isFinite(fileNameTimestamp)) {
        return new Date(fileNameTimestamp);
    }

    if (extra?.creationDate) {
        const parsed = Date.parse(extra.creationDate);
        if (Number.isFinite(parsed)) {
            return new Date(parsed);
        }
    }

    return null;
}

export function normalizeScreenshotMetadata(
    metadata: unknown,
    extra: unknown = {}
): NormalizedScreenshotMetadata {
    const source = isRecord(metadata) ? metadata : {};
    const extraData: ScreenshotExtraData = isRecord(extra) ? extra : {};
    const fileName =
        stringValue(extraData.fileName) ||
        getFileNameFromPath(extraData.filePath || source.sourceFile);
    const typedMetadata: Partial<ScreenshotMetadata> = {
        timestamp:
            typeof source.timestamp === 'string' ? source.timestamp : null,
        sourceFile:
            typeof source.sourceFile === 'string' ? source.sourceFile : null
    };
    const dateTime = resolveScreenshotMetadataDate(
        typedMetadata,
        extraData,
        fileName
    );
    const world = isRecord(source.world)
        ? {
              id: stringValue(source.world.id) || undefined,
              name: stringValue(source.world.name) || undefined,
              instanceId: stringValue(source.world.instanceId) || undefined
          }
        : {};
    const author = isRecord(source.author)
        ? {
              id: stringValue(source.author.id) || undefined,
              displayName: stringValue(source.author.displayName) || undefined
          }
        : {};
    const players = Array.isArray(source.players)
        ? source.players.flatMap((player): PlayerDetail[] => {
              if (!isRecord(player)) {
                  return [];
              }
              return [
                  {
                      id: stringValue(player.id) || undefined,
                      displayName: stringValue(player.displayName) || undefined
                  }
              ];
          })
        : [];

    return {
        filePath: stringValue(extraData.filePath || source.sourceFile),
        fileName,
        previousFilePath: stringValue(extraData.previousFilePath),
        previousFolderPath: stringValue(extraData.previousFolderPath),
        nextFilePath: stringValue(extraData.nextFilePath),
        nextFolderPath: stringValue(extraData.nextFolderPath),
        resolution: stringValue(extraData.resolution),
        fileSizeBytes: extraData.fileSizeBytes ?? 0,
        dateTime,
        world,
        author,
        players,
        note: stringValue(source.note),
        application: stringValue(source.application)
    };
}
