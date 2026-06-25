import { SCREENSHOT_GALLERY_CONFIG_KEYS } from '@/repositories/configKeys';
import {
    formatDateTimeValue,
    formatIsoDateTime,
    normalizeDateLocale
} from '@/shared/utils/dateTimeFormatters';
import { parseVrchatScreenshotDateFromFileName } from '@/shared/utils/screenshot';
import { useShellStore } from '@/state/shellStore';

export const SCREENSHOT_METADATA_SEARCH_TYPES = [
    {
        value: 'Player Name',
        index: 0,
        labelKey: 'dialog.screenshot_metadata.search_types.player_name'
    },
    {
        value: 'Player ID',
        index: 1,
        labelKey: 'dialog.screenshot_metadata.search_types.player_id'
    },
    {
        value: 'World Name',
        index: 2,
        labelKey: 'dialog.screenshot_metadata.search_types.world_name'
    },
    {
        value: 'World ID',
        index: 3,
        labelKey: 'dialog.screenshot_metadata.search_types.world_id'
    }
];

export type ScreenshotSearchSort = {
    asc: boolean;
    key: string;
};

export type ScreenshotSearchRow = Record<string, unknown> & {
    filePath: string;
    dateTime: Date | null;
    playerCount: number;
};

export const DEFAULT_SCREENSHOT_SEARCH_SORT: ScreenshotSearchSort = {
    key: 'dateTime',
    asc: false
};

export const SCREENSHOT_GALLERY_FOLDER_CONFIG_KEY =
    SCREENSHOT_GALLERY_CONFIG_KEYS.folder;
export const SCREENSHOT_GALLERY_SCROLL_CONFIG_KEY =
    SCREENSHOT_GALLERY_CONFIG_KEYS.scrollPositions;
export const SCREENSHOT_GALLERY_SCROLL_SAVE_DELAY_MS = 500;
export const MAX_SCREENSHOT_GALLERY_SCROLL_POSITIONS = 100;
export const MAX_SCREENSHOT_GALLERY_SCROLL_TOP = 50_000_000;

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
    positions: Map<unknown, unknown>
): Record<string, number> {
    const result: Record<string, number> = {};
    const entries = Array.from(positions.entries())
        .filter(
            (entry): entry is [unknown, unknown] =>
                Array.isArray(entry) && Boolean(entry[0])
        )
        .slice(-MAX_SCREENSHOT_GALLERY_SCROLL_POSITIONS);
    for (const [path, scrollTop] of entries) {
        result[String(path)] = normalizeGalleryScrollTop(scrollTop);
    }
    return result;
}

export function getGalleryFolderPathSet(folderTree: any) {
    return new Set(
        (Array.isArray(folderTree?.folders) ? folderTree.folders : [])
            .map((folder: any) => folder?.path)
            .filter(Boolean)
    );
}

export function getFolderLatestModifiedAt(folder: any) {
    return Number(folder?.latestModifiedAt) || 0;
}

export function resolveGalleryFolder(folderTree: any, preferredFolders: any) {
    const folders = Array.isArray(folderTree?.folders)
        ? folderTree.folders
        : [];
    const preferredList = Array.isArray(preferredFolders)
        ? preferredFolders
        : [preferredFolders];
    for (const preferredFolder of preferredList) {
        if (
            preferredFolder &&
            folders.some((folder: any) => folder.path === preferredFolder)
        ) {
            return preferredFolder;
        }
    }
    const latestFolder = folders
        .filter((folder: any) => Number(folder.imageCount) > 0)
        .sort(
            (left: any, right: any) =>
                getFolderLatestModifiedAt(right) -
                    getFolderLatestModifiedAt(left) ||
                String(right.path || '').localeCompare(String(left.path || ''))
        )[0];
    return latestFolder?.path || folderTree?.rootPath || folders[0]?.path || '';
}

export function normalizeDroppedFilePath(value: any) {
    const text = String(value || '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean);

    if (!text) {
        return '';
    }

    if (text.startsWith('file://')) {
        try {
            const url = new URL(text);
            const pathname = decodeURIComponent(url.pathname);
            return /^[A-Za-z]:/.test(pathname.slice(1))
                ? pathname.slice(1)
                : pathname;
        } catch {
            return text;
        }
    }

    return text;
}

export function getDroppedScreenshotPath(event: any) {
    const file = event.dataTransfer?.files?.[0] || null;
    const filePath = file?.path || file?.webkitRelativePath || '';
    if (filePath) {
        return filePath;
    }

    return normalizeDroppedFilePath(
        event.dataTransfer?.getData('text/uri-list') ||
            event.dataTransfer?.getData('text/plain') ||
            ''
    );
}

export function getScreenshotSearchSortValue(
    row: ScreenshotSearchRow,
    key: string
) {
    if (key === 'dateTime') {
        return row?.dateTime?.getTime?.() ?? 0;
    }
    if (key === 'playerCount') {
        return Number(row?.playerCount) || 0;
    }
    return String(row?.[key] || '').toLowerCase();
}

export function sortScreenshotSearchRows(
    rows: ScreenshotSearchRow[],
    sort: ScreenshotSearchSort
): ScreenshotSearchRow[] {
    const sortKey = sort?.key || DEFAULT_SCREENSHOT_SEARCH_SORT.key;
    const direction = sort?.asc ? 1 : -1;
    return [...rows].sort((left, right) => {
        const leftValue = getScreenshotSearchSortValue(left, sortKey);
        const rightValue = getScreenshotSearchSortValue(right, sortKey);
        if (leftValue < rightValue) {
            return -1 * direction;
        }
        if (leftValue > rightValue) {
            return 1 * direction;
        }
        const leftTime = left?.dateTime?.getTime?.() ?? 0;
        const rightTime = right?.dateTime?.getTime?.() ?? 0;
        return rightTime - leftTime;
    });
}

export function formatScreenshotBytes(bytes: unknown): string {
    const sizeInBytes = Number(bytes);
    if (!Number.isFinite(sizeInBytes) || sizeInBytes <= 0) {
        return '';
    }

    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = sizeInBytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex += 1;
    }

    const precision = size >= 100 || unitIndex === 0 ? 0 : 1;
    return `${size.toFixed(precision)} ${units[unitIndex]}`;
}

export function formatScreenshotDateTime(value: any, locale: any = undefined) {
    if (!value) {
        return '—';
    }

    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
        return '—';
    }

    const {
        dateHour12,
        dateIsoFormat,
        locale: appLocale
    } = useShellStore.getState();

    if (dateIsoFormat) {
        return formatIsoDateTime(date);
    }

    return formatDateTimeValue(
        date,
        {
            dateStyle: 'medium',
            timeStyle: 'short'
        },
        {
            locale: normalizeDateLocale(locale || appLocale, 'en'),
            hour12: Boolean(dateHour12),
            fallback: '—'
        }
    );
}

export function getFileNameFromPath(path: any) {
    return (
        String(path || '')
            .split(/[\\/]/)
            .filter(Boolean)
            .at(-1) || ''
    );
}

export function resolveScreenshotMetadataDate(
    metadata: any,
    extra: any,
    fileName: any
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

export function normalizeScreenshotMetadata(metadata: any, extra: any) {
    const fileName =
        extra?.fileName ||
        getFileNameFromPath(extra?.filePath || metadata?.sourceFile);
    const dateTime = resolveScreenshotMetadataDate(metadata, extra, fileName);

    return {
        filePath: extra?.filePath || metadata?.sourceFile || '',
        fileName,
        previousFilePath: extra?.previousFilePath || '',
        nextFilePath: extra?.nextFilePath || '',
        resolution: extra?.resolution || '',
        fileSizeBytes: extra?.fileSizeBytes ?? 0,
        dateTime,
        world: metadata?.world ?? {},
        author: metadata?.author ?? {},
        players: Array.isArray(metadata?.players) ? metadata.players : [],
        note: metadata?.note || '',
        application: metadata?.application || ''
    };
}

export function buildScreenshotSearchRow(
    normalized: any,
    selectedSearchType: any,
    query: any,
    locale: any = undefined
): ScreenshotSearchRow {
    let match = '';
    if (selectedSearchType?.index === 0) {
        const normalizedQuery = String(query || '').toLowerCase();
        const hits = normalized.players
            .filter((player: any) =>
                String(player.displayName || '')
                    .toLowerCase()
                    .includes(normalizedQuery)
            )
            .map((player: any) => player.displayName);
        match = hits.join(', ');
    } else if (selectedSearchType?.index === 1) {
        match =
            normalized.players.find((player: any) => player.id === query)
                ?.displayName || '';
    }

    return {
        filePath: normalized.filePath,
        dateTime: normalized.dateTime,
        dateLabel: formatScreenshotDateTime(normalized.dateTime, locale),
        world: normalized.world?.name || '—',
        author: normalized.author?.displayName || '—',
        playerCount: normalized.players.length,
        resolution: normalized.resolution || '—',
        match: match || '—'
    };
}

export function sortScreenshotRowsByNewest(
    rows: Array<ScreenshotSearchRow | null>
): ScreenshotSearchRow[] {
    return (Array.isArray(rows) ? rows : [])
        .filter((row): row is ScreenshotSearchRow => Boolean(row))
        .sort((left, right) => {
            const leftTime = left?.dateTime?.getTime?.() ?? 0;
            const rightTime = right?.dateTime?.getTime?.() ?? 0;
            return rightTime - leftTime;
        });
}
