// @ts-nocheck
import {
    getDataTableStorageKey,
    readPersistedTableState,
    safeJsonParse,
    sanitizeTableColumnSizing,
    writePersistedTableState
} from '@/components/data-table/dataTablePersistence.js';

export { safeJsonParse };

export const GAME_LOG_DEFAULT_PAGE_SIZES = [10, 15, 20, 25, 50, 100];
export const GAME_LOG_DEFAULT_SORTING = [{ id: 'created_at', desc: true }];
export const GAME_LOG_COLUMN_IDS = [
    'spacer',
    'created_at',
    'type',
    'displayName',
    'detail',
    'action'
];

const STORAGE_KEY = getDataTableStorageKey('gameLog');

export function readPersistedGameLogState() {
    return readPersistedTableState(STORAGE_KEY);
}

export function writePersistedGameLogState(patch) {
    writePersistedTableState(STORAGE_KEY, patch);
}

export function sanitizeGameLogSorting(value) {
    if (!Array.isArray(value)) {
        return GAME_LOG_DEFAULT_SORTING;
    }

    const filtered = value.filter(
        (entry) =>
            entry &&
            typeof entry.id === 'string' &&
            GAME_LOG_COLUMN_IDS.includes(entry.id)
    );
    return filtered.length ? filtered : GAME_LOG_DEFAULT_SORTING;
}

export function sanitizeGameLogPageSizes(value) {
    if (!Array.isArray(value)) {
        return GAME_LOG_DEFAULT_PAGE_SIZES;
    }

    const normalized = Array.from(
        new Set(
            value
                .map((entry) => Number.parseInt(entry, 10))
                .filter(
                    (entry) =>
                        Number.isFinite(entry) && entry > 0 && entry <= 1000
                )
        )
    ).sort((left, right) => left - right);

    return normalized.length ? normalized : GAME_LOG_DEFAULT_PAGE_SIZES;
}

export function sanitizeGameLogColumnVisibility(value) {
    const visibility = {};
    if (!value || typeof value !== 'object') {
        return visibility;
    }

    for (const columnId of GAME_LOG_COLUMN_IDS) {
        if (typeof value[columnId] === 'boolean') {
            visibility[columnId] = value[columnId];
        }
    }

    return visibility;
}

export function sanitizeGameLogColumnOrder(value) {
    if (!Array.isArray(value)) {
        return GAME_LOG_COLUMN_IDS;
    }

    const orderedColumns = value.filter((columnId) =>
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

export function sanitizeGameLogColumnSizing(value) {
    return sanitizeTableColumnSizing(value, GAME_LOG_COLUMN_IDS);
}

export function resolveGameLogPageSize(
    candidate,
    allowed,
    fallback = GAME_LOG_DEFAULT_PAGE_SIZES[1]
) {
    const pageSizes = Array.isArray(allowed)
        ? allowed.filter((size) => Number.isFinite(size) && size > 0)
        : GAME_LOG_DEFAULT_PAGE_SIZES;
    const fallbackPageSize = pageSizes.length
        ? pageSizes[0]
        : GAME_LOG_DEFAULT_PAGE_SIZES[0];
    const nearestPageSize = (value) =>
        pageSizes.length
            ? pageSizes.reduce((previous, size) =>
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
