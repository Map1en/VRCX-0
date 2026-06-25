import {
    getDataTableStorageKey,
    readPersistedTableState,
    safeJsonParse,
    sanitizeTableColumnSizing,
    writePersistedTableState
} from '@/components/data-table/dataTablePersistence';

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

export function sanitizeGameLogSorting(value: any) {
    if (!Array.isArray(value)) {
        return GAME_LOG_DEFAULT_SORTING;
    }

    const filtered = value.filter(
        (entry: any) =>
            entry &&
            typeof entry.id === 'string' &&
            GAME_LOG_SORTING_COLUMN_IDS.includes(entry.id)
    );
    return filtered.length ? filtered : GAME_LOG_DEFAULT_SORTING;
}

export function sanitizeGameLogPageSizes(value: any) {
    if (!Array.isArray(value)) {
        return GAME_LOG_DEFAULT_PAGE_SIZES;
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

    return normalized.length ? normalized : GAME_LOG_DEFAULT_PAGE_SIZES;
}

export function sanitizeGameLogColumnVisibility(value: any) {
    const visibility: Record<string, boolean> = {};
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

export function sanitizeGameLogColumnOrder(value: any) {
    if (!Array.isArray(value)) {
        return GAME_LOG_COLUMN_IDS;
    }

    const orderedColumns = value.filter((columnId: any) =>
        GAME_LOG_COLUMN_IDS.includes(columnId)
    );
    const missingColumns = GAME_LOG_COLUMN_IDS.filter(
        (columnId: any) => !orderedColumns.includes(columnId)
    );
    const nextColumns = [...orderedColumns, ...missingColumns];
    return [
        'spacer',
        ...nextColumns.filter((columnId: any) => columnId !== 'spacer')
    ];
}

export function sanitizeGameLogColumnSizing(value: any) {
    return sanitizeTableColumnSizing(value, GAME_LOG_COLUMN_IDS);
}

export function resolveGameLogPageSize(
    candidate: any,
    allowed: any,
    fallback: any = GAME_LOG_DEFAULT_PAGE_SIZES[1]
) {
    const pageSizes = Array.isArray(allowed)
        ? allowed.filter((size: any) => Number.isFinite(size) && size > 0)
        : GAME_LOG_DEFAULT_PAGE_SIZES;
    const fallbackPageSize = pageSizes.length
        ? pageSizes[0]
        : GAME_LOG_DEFAULT_PAGE_SIZES[0];
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
