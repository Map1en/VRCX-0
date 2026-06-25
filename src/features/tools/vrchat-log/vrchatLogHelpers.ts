import type {
    VrchatLogEntryOutput,
    VrchatLogFileOutput
} from '@/platform/tauri/bindings';
import storageRepository from '@/repositories/storageRepository';

export type VrchatLogLevel = 'Debug' | 'Warning' | 'Error';

export const LOG_LEVELS: VrchatLogLevel[] = ['Debug', 'Warning', 'Error'];
export const ALL_CATEGORY_VALUE = '__all__';
export const PREFS_KEY = 'prefs';
export const PAGE_LIMIT = 350;
export const TAIL_LIMIT = 300;
export const MAX_CLIENT_ENTRIES = 2500;
export const FOLLOW_INTERVAL_MS = 2000;
export const LOG_ROW_HEIGHT = 30;
export const LOG_HEADER_HEIGHT = 30;
export const LOG_ROW_OVERSCAN = 18;
export const LOG_TABLE_GRID_CLASS =
    'grid-cols-[32px_172px_78px_minmax(136px,190px)_minmax(420px,1fr)]';

export const logViewerStorage = storageRepository.withPrefix('tool:vrchatLog:');

export type VrchatLogViewerPrefs = {
    levels?: string[];
    categories?: string[];
    category?: string;
    searchQuery?: string;
    followLatest?: boolean;
    recentFileName?: string;
};

function isVrchatLogLevel(value: string): value is VrchatLogLevel {
    return LOG_LEVELS.some((level) => level === value);
}

export function normalizePrefs(value: VrchatLogViewerPrefs | null) {
    const levels = Array.isArray(value?.levels)
        ? value.levels.filter(isVrchatLogLevel)
        : LOG_LEVELS;
    return {
        levels: levels.length ? levels : LOG_LEVELS,
        categories: Array.isArray(value?.categories)
            ? value.categories.filter(Boolean)
            : value?.category && value.category !== ALL_CATEGORY_VALUE
              ? [value.category]
              : [],
        searchQuery: value?.searchQuery || '',
        followLatest: value?.followLatest ?? true,
        recentFileName: value?.recentFileName || ''
    };
}

export function fileLabel(file: VrchatLogFileOutput, latestLabel: string) {
    const size = formatBytes(file.size);
    return file.latest
        ? `${file.fileName} (${size}, ${latestLabel})`
        : `${file.fileName} (${size})`;
}

export function formatBytes(value: number) {
    if (!Number.isFinite(value) || value <= 0) {
        return '0 B';
    }
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = value;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex += 1;
    }
    return `${size >= 10 || unitIndex === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[unitIndex]}`;
}

export function levelClassName(level: string) {
    if (level === 'Error') {
        return 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300';
    }
    if (level === 'Warning') {
        return 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300';
    }
    return 'bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300';
}

export function entryKey(entry: VrchatLogEntryOutput) {
    return `${entry.fileName}:${entry.lineNumber}`;
}

export function mergeEntries(
    currentEntries: VrchatLogEntryOutput[],
    incomingEntries: VrchatLogEntryOutput[],
    trimToNewest = false
) {
    const byKey = new Map<string, VrchatLogEntryOutput>();
    for (const entry of currentEntries) {
        byKey.set(entryKey(entry), entry);
    }
    for (const entry of incomingEntries) {
        byKey.set(entryKey(entry), entry);
    }
    const sortedEntries = Array.from(byKey.values()).sort(
        (left, right) => left.lineNumber - right.lineNumber
    );
    return trimToNewest
        ? sortedEntries.slice(-MAX_CLIENT_ENTRIES)
        : sortedEntries;
}

export function mergeLogCategories(
    currentCategories: string[],
    incomingEntries: VrchatLogEntryOutput[]
) {
    const categories = new Set(currentCategories);
    for (const entry of incomingEntries) {
        if (entry.category) {
            categories.add(entry.category);
        }
    }
    return Array.from(categories).sort((left, right) =>
        left.localeCompare(right)
    );
}

export function entryToText(entry: VrchatLogEntryOutput) {
    return [entry.raw || `${entry.timestamp} ${entry.level} - ${entry.message}`]
        .concat(entry.continuationLines || [])
        .join('\n');
}

export function entryMessageText(entry: VrchatLogEntryOutput) {
    return [entry.message].concat(entry.continuationLines || []).join('\n');
}
