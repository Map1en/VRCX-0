import type { SortingState } from '@tanstack/react-table';

import {
    getDataTableStorageKey,
    readPersistedTableState,
    safeJsonParse,
    sanitizeTableColumnSizing,
    writePersistedTableState
} from '@/components/data-table/dataTablePersistence';

export { safeJsonParse };

export const FEED_TABLE_DEFAULT_PAGE_SIZES = [10, 15, 20, 25, 50, 100];
export const FEED_TABLE_DEFAULT_SORTING: SortingState = [];
export const FEED_TABLE_COLUMN_IDS = [
    'created_at',
    'type',
    'displayName',
    'detail'
];
export const FEED_TABLE_ORDER_COLUMN_IDS = [
    'expander',
    ...FEED_TABLE_COLUMN_IDS
];

const STORAGE_KEY = getDataTableStorageKey('feed');

export function readPersistedFeedTableState() {
    return readPersistedTableState(STORAGE_KEY);
}

export function writePersistedFeedTableState(patch: Record<string, unknown>) {
    writePersistedTableState(STORAGE_KEY, patch);
}

export function sanitizeFeedSorting(value: any) {
    if (!Array.isArray(value)) {
        return FEED_TABLE_DEFAULT_SORTING;
    }

    const allowedIds = new Set(FEED_TABLE_COLUMN_IDS);
    const filtered = value.filter(
        (entry: any) =>
            entry && typeof entry.id === 'string' && allowedIds.has(entry.id)
    );
    return filtered.length ? filtered : FEED_TABLE_DEFAULT_SORTING;
}

export function sanitizeFeedPageSizes(value: any) {
    if (!Array.isArray(value)) {
        return FEED_TABLE_DEFAULT_PAGE_SIZES;
    }

    const sizes = value
        .map((entry: any) => Number.parseInt(entry, 10))
        .filter(
            (entry: any) => Number.isFinite(entry) && entry > 0 && entry <= 1000
        );
    return sizes.length
        ? [...new Set(sizes)].sort((left: any, right: any) => left - right)
        : FEED_TABLE_DEFAULT_PAGE_SIZES;
}

export function sanitizeFeedColumnVisibility(value: any) {
    const visibility: Record<string, boolean> = {};
    if (!value || typeof value !== 'object') {
        return visibility;
    }

    for (const columnId of FEED_TABLE_COLUMN_IDS) {
        if (typeof value[columnId] === 'boolean') {
            visibility[columnId] = value[columnId];
        }
    }
    return visibility;
}

export function sanitizeFeedColumnOrder(value: any) {
    if (!Array.isArray(value)) {
        return [];
    }

    return value.filter((columnId: any) =>
        FEED_TABLE_ORDER_COLUMN_IDS.includes(columnId)
    );
}

export function sanitizeFeedColumnSizing(value: any) {
    return sanitizeTableColumnSizing(value, FEED_TABLE_ORDER_COLUMN_IDS);
}

export function resolveFeedPageSize(
    candidate: any,
    pageSizes: any = FEED_TABLE_DEFAULT_PAGE_SIZES,
    fallback: any = pageSizes[1] ?? FEED_TABLE_DEFAULT_PAGE_SIZES[1]
) {
    const allowed = Array.isArray(pageSizes)
        ? pageSizes.filter((size: any) => Number.isFinite(size) && size > 0)
        : FEED_TABLE_DEFAULT_PAGE_SIZES;
    const fallbackPageSize = allowed.length
        ? allowed[0]
        : FEED_TABLE_DEFAULT_PAGE_SIZES[0];
    const nearestPageSize = (value: any) =>
        allowed.length
            ? allowed.reduce((previous: any, size: any) =>
                  Math.abs(size - value) < Math.abs(previous - value)
                      ? size
                      : previous
              )
            : fallbackPageSize;
    const parsed = Number.parseInt(candidate, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
        return allowed.includes(parsed) ? parsed : nearestPageSize(parsed);
    }

    return allowed.includes(fallback)
        ? fallback
        : nearestPageSize(Number(fallback) || fallbackPageSize);
}
