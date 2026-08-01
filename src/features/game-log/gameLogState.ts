import type { SortingState } from '@tanstack/react-table';

import {
    getDataTableStorageKey,
    readPersistedTableState,
    safeJsonParse,
    sanitizeTableColumnSizing,
    sanitizeTableColumnVisibility,
    writePersistedTableState
} from '@/components/data-table/dataTablePersistence';

export { safeJsonParse };

export const GAME_LOG_DEFAULT_PAGE_SIZES: number[] = [10, 15, 20, 25, 50, 100];
export const GAME_LOG_DEFAULT_SORTING: SortingState = [
    { id: 'created_at', desc: true }
];
export const GAME_LOG_COLUMN_IDS: string[] = [
    'spacer',
    'created_at',
    'type',
    'displayName',
    'detail',
    'action'
];
const GAME_LOG_SORTING_COLUMN_IDS = GAME_LOG_COLUMN_IDS.filter(
    (columnId) => columnId !== 'displayName'
);

const STORAGE_KEY = getDataTableStorageKey('gameLog');

export function readPersistedGameLogState() {
    return readPersistedTableState(STORAGE_KEY);
}

export function writePersistedGameLogState(patch: Record<string, unknown>) {
    writePersistedTableState(STORAGE_KEY, patch);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

export function sanitizeGameLogSorting(value: unknown): SortingState {
    if (!Array.isArray(value)) {
        return GAME_LOG_DEFAULT_SORTING;
    }

    const filtered = value.filter(
        (entry): entry is SortingState[number] =>
            isRecord(entry) &&
            typeof entry.id === 'string' &&
            typeof entry.desc === 'boolean' &&
            GAME_LOG_SORTING_COLUMN_IDS.includes(entry.id)
    );
    return filtered.length ? filtered : GAME_LOG_DEFAULT_SORTING;
}

export function sanitizeGameLogPageSizes(value: unknown): number[] {
    if (!Array.isArray(value)) {
        return GAME_LOG_DEFAULT_PAGE_SIZES;
    }

    const normalized = Array.from(
        new Set(
            value
                .map((entry) => Number.parseInt(String(entry), 10))
                .filter(
                    (entry) =>
                        Number.isFinite(entry) && entry > 0 && entry <= 1000
                )
        )
    ).sort((left, right) => left - right);

    return normalized.length ? normalized : GAME_LOG_DEFAULT_PAGE_SIZES;
}

export function sanitizeGameLogColumnVisibility(value: unknown) {
    return sanitizeTableColumnVisibility(value, GAME_LOG_COLUMN_IDS);
}

export function sanitizeGameLogColumnOrder(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return GAME_LOG_COLUMN_IDS;
    }

    const orderedColumns = value.filter(
        (columnId): columnId is string =>
            typeof columnId === 'string' &&
            GAME_LOG_COLUMN_IDS.includes(columnId)
    );
    const missingColumns = GAME_LOG_COLUMN_IDS.filter(
        (columnId) => !orderedColumns.includes(columnId)
    );
    const nextColumns = [...orderedColumns, ...missingColumns];
    return [
        'spacer',
        ...nextColumns.filter((columnId) => columnId !== 'spacer')
    ];
}

export function sanitizeGameLogColumnSizing(value: unknown) {
    return sanitizeTableColumnSizing(value, GAME_LOG_COLUMN_IDS);
}

export function resolveGameLogPageSize(
    candidate: unknown,
    allowed: unknown,
    fallback: unknown = GAME_LOG_DEFAULT_PAGE_SIZES[1]
) {
    const pageSizes = Array.isArray(allowed)
        ? allowed.filter(
              (size): size is number =>
                  typeof size === 'number' && Number.isFinite(size) && size > 0
          )
        : GAME_LOG_DEFAULT_PAGE_SIZES;
    const fallbackPageSize = pageSizes.length
        ? pageSizes[0]
        : GAME_LOG_DEFAULT_PAGE_SIZES[0];
    const nearestPageSize = (value: number) =>
        pageSizes.length
            ? pageSizes.reduce((previous, size) =>
                  Math.abs(size - value) < Math.abs(previous - value)
                      ? size
                      : previous
              )
            : fallbackPageSize;
    const parsed = Number.parseInt(String(candidate), 10);
    if (Number.isFinite(parsed) && parsed > 0) {
        return pageSizes.includes(parsed) ? parsed : nearestPageSize(parsed);
    }

    if (typeof fallback === 'number' && pageSizes.includes(fallback)) {
        return fallback;
    }

    return nearestPageSize(Number(fallback) || fallbackPageSize);
}
