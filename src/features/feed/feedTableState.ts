import type { SortingState } from '@tanstack/react-table';

import {
    getDataTableStorageKey,
    readPersistedTableState,
    safeJsonParse,
    writePersistedTableState
} from '@/components/data-table/dataTablePersistence';

export { safeJsonParse };

export const FEED_TABLE_DEFAULT_PAGE_SIZES = [10, 15, 20, 25, 50, 100];
export const FEED_TABLE_DEFAULT_SORTING: SortingState = [];
const FEED_TABLE_SORT_COLUMN_IDS = ['created_at', 'type', 'displayName'];
export const FEED_RESIZABLE_COLUMN_IDS = [
    'created_at',
    'type',
    'displayName',
    'detail'
];

const STORAGE_KEY = getDataTableStorageKey('feed');

export function readPersistedFeedTableState() {
    return readPersistedTableState(STORAGE_KEY);
}

export function writePersistedFeedTableState(patch: Record<string, unknown>) {
    writePersistedTableState(STORAGE_KEY, patch);
}

function isFeedSortingEntry(value: unknown): value is SortingState[number] {
    if (!value || typeof value !== 'object') {
        return false;
    }
    const id = 'id' in value ? value.id : undefined;
    return typeof id === 'string' && FEED_TABLE_SORT_COLUMN_IDS.includes(id);
}

export function sanitizeFeedSorting(value: unknown): SortingState {
    if (!Array.isArray(value)) {
        return FEED_TABLE_DEFAULT_SORTING;
    }

    const filtered = value.filter(isFeedSortingEntry);
    return filtered.length ? filtered : FEED_TABLE_DEFAULT_SORTING;
}

export function sanitizeFeedPageSizes(value: unknown): number[] {
    if (!Array.isArray(value)) {
        return FEED_TABLE_DEFAULT_PAGE_SIZES;
    }

    const sizes = value
        .map((entry: unknown) => Number.parseInt(String(entry), 10))
        .filter(
            (entry) => Number.isFinite(entry) && entry > 0 && entry <= 1000
        );
    return sizes.length
        ? [...new Set(sizes)].sort((left, right) => left - right)
        : FEED_TABLE_DEFAULT_PAGE_SIZES;
}

export function resolveFeedPageSize(
    candidate: unknown,
    pageSizes: number[] = FEED_TABLE_DEFAULT_PAGE_SIZES,
    fallback: number = pageSizes[1] ?? FEED_TABLE_DEFAULT_PAGE_SIZES[1]
): number {
    const allowed = pageSizes.filter(
        (size) => Number.isFinite(size) && size > 0
    );
    const fallbackPageSize = allowed.length
        ? allowed[0]
        : FEED_TABLE_DEFAULT_PAGE_SIZES[0];
    const nearestPageSize = (value: number): number =>
        allowed.length
            ? allowed.reduce((previous, size) =>
                  Math.abs(size - value) < Math.abs(previous - value)
                      ? size
                      : previous
              )
            : fallbackPageSize;
    const parsed = Number.parseInt(String(candidate), 10);
    if (Number.isFinite(parsed) && parsed > 0) {
        return allowed.includes(parsed) ? parsed : nearestPageSize(parsed);
    }

    return allowed.includes(fallback)
        ? fallback
        : nearestPageSize(fallback || fallbackPageSize);
}
