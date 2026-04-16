import { parseVrchatScreenshotDateFromFileName } from '@/shared/utils/screenshot.js';

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

export const DEFAULT_SCREENSHOT_SEARCH_SORT = {
    key: 'dateTime',
    asc: false
};

export function normalizeDroppedFilePath(value) {
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
            return /^[A-Za-z]:/.test(pathname.slice(1)) ? pathname.slice(1) : pathname;
        } catch {
            return text;
        }
    }

    return text;
}

export function getDroppedScreenshotPath(event) {
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

export function getScreenshotSearchSortValue(row, key) {
    if (key === 'dateTime') {
        return row?.dateTime?.getTime?.() ?? 0;
    }
    if (key === 'playerCount') {
        return Number(row?.playerCount) || 0;
    }
    return String(row?.[key] || '').toLowerCase();
}

export function sortScreenshotSearchRows(rows, sort) {
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

export function formatScreenshotBytes(bytes) {
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

export function formatScreenshotDateTime(value) {
    if (!value) {
        return '—';
    }

    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
        return '—';
    }

    return new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short'
    }).format(date);
}

export function getFileNameFromPath(path) {
    return String(path || '')
        .split(/[\\/]/)
        .filter(Boolean)
        .at(-1) || '';
}

export function resolveScreenshotMetadataDate(metadata, extra, fileName) {
    if (metadata?.timestamp) {
        const parsed = Date.parse(metadata.timestamp);
        if (Number.isFinite(parsed)) {
            return new Date(parsed);
        }
    }

    const fileNameTimestamp = parseVrchatScreenshotDateFromFileName(fileName);
    if (Number.isFinite(fileNameTimestamp)) {
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

export function normalizeScreenshotMetadata(metadata, extra) {
    const fileName =
        extra?.fileName || getFileNameFromPath(extra?.filePath || metadata?.sourceFile);
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

export function buildScreenshotSearchRow(normalized, selectedSearchType, query) {
    let match = '';
    if (selectedSearchType?.index === 0) {
        const normalizedQuery = String(query || '').toLowerCase();
        const hits = normalized.players
            .filter((player) =>
                String(player.displayName || '')
                    .toLowerCase()
                    .includes(normalizedQuery)
            )
            .map((player) => player.displayName);
        match = hits.join(', ');
    } else if (selectedSearchType?.index === 1) {
        match =
            normalized.players.find((player) => player.id === query)
                ?.displayName || '';
    }

    return {
        filePath: normalized.filePath,
        dateTime: normalized.dateTime,
        dateLabel: formatScreenshotDateTime(normalized.dateTime),
        world: normalized.world?.name || '—',
        author: normalized.author?.displayName || '—',
        playerCount: normalized.players.length,
        resolution: normalized.resolution || '—',
        match: match || '—'
    };
}

export function sortScreenshotRowsByNewest(rows) {
    return (Array.isArray(rows) ? rows : []).filter(Boolean).sort((left, right) => {
        const leftTime = left?.dateTime?.getTime?.() ?? 0;
        const rightTime = right?.dateTime?.getTime?.() ?? 0;
        return rightTime - leftTime;
    });
}
