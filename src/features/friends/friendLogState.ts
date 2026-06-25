import {
    getDataTableStorageKey,
    readPersistedTableState,
    safeJsonParse,
    sanitizeTableColumnSizing,
    writePersistedTableState
} from '@/components/data-table/dataTablePersistence';

import { FRIEND_LOG_TYPES } from './components/FriendLogViewParts';

export const DEFAULT_PAGE_SIZES = [10, 15, 20, 25, 50, 100];
export const COLUMN_IDS = [
    'spacer',
    'created_at',
    'type',
    'displayName',
    'action',
    'trailing'
];
const SORTING_COLUMN_IDS = COLUMN_IDS.filter(
    (columnId) => columnId !== 'displayName'
);

const DEFAULT_SORTING: { id: string; desc?: boolean }[] = [];
const STORAGE_KEY = getDataTableStorageKey('friendLog');

export function readPersistedState() {
    return readPersistedTableState(STORAGE_KEY);
}

export function writePersistedState(patch: Record<string, unknown>) {
    writePersistedTableState(STORAGE_KEY, patch);
}

export function sanitizeSorting(value: any) {
    if (!Array.isArray(value)) {
        return DEFAULT_SORTING;
    }

    return value.filter(
        (entry: any) =>
            entry &&
            typeof entry.id === 'string' &&
            SORTING_COLUMN_IDS.includes(entry.id)
    );
}

export function sanitizePageSizes(value: any) {
    if (!Array.isArray(value)) {
        return DEFAULT_PAGE_SIZES;
    }

    const normalized = Array.from(
        new Set(
            value
                .map((entry: any) => Number.parseInt(entry, 10))
                .filter(
                    (entry: any) =>
                        Number.isFinite(entry) && entry > 0 && entry <= 1000
                )
        )
    ).sort((left: any, right: any) => left - right);

    return normalized.length ? normalized : DEFAULT_PAGE_SIZES;
}

export function sanitizeColumnVisibility(value: any) {
    const visibility: Record<string, boolean> = {};
    if (!value || typeof value !== 'object') {
        return visibility;
    }

    for (const columnId of COLUMN_IDS) {
        if (typeof value[columnId] === 'boolean') {
            visibility[columnId] = value[columnId];
        }
    }

    return visibility;
}

export function sanitizeColumnOrder(value: any) {
    if (!Array.isArray(value)) {
        return COLUMN_IDS;
    }

    const orderedColumns = value.filter((columnId: any) =>
        COLUMN_IDS.includes(columnId)
    );
    const missingColumns = COLUMN_IDS.filter(
        (columnId: any) => !orderedColumns.includes(columnId)
    );
    return [...orderedColumns, ...missingColumns];
}

export function sanitizeColumnSizing(value: any) {
    return sanitizeTableColumnSizing(value, COLUMN_IDS);
}

export function resolvePageSize(
    candidate: any,
    allowed: any,
    fallback: any = DEFAULT_PAGE_SIZES[1]
) {
    const pageSizes = Array.isArray(allowed)
        ? allowed.filter((size: any) => Number.isFinite(size) && size > 0)
        : DEFAULT_PAGE_SIZES;
    const fallbackPageSize = pageSizes.length
        ? pageSizes[0]
        : DEFAULT_PAGE_SIZES[0];
    const nearestPageSize = (value: any) =>
        pageSizes.length
            ? pageSizes.reduce((previous: any, size: any) =>
                  Math.abs(size - value) < Math.abs(previous - value)
                      ? size
                      : previous
              )
            : fallbackPageSize;
    const parsed = Number.parseInt(candidate, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
        return pageSizes.includes(parsed) ? parsed : nearestPageSize(parsed);
    }

    if (pageSizes.includes(fallback)) {
        return fallback;
    }

    return nearestPageSize(Number(fallback) || fallbackPageSize);
}

export function parseTypeFilters(value: any) {
    const parsed = safeJsonParse(value);
    if (!Array.isArray(parsed)) {
        return [];
    }

    return parsed.filter(
        (entry: any) =>
            typeof entry === 'string' && FRIEND_LOG_TYPES.includes(entry)
    );
}
