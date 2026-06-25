import {
    getDataTableStorageKey,
    readPersistedTableState,
    safeJsonParse,
    sanitizeTableColumnSizing,
    writePersistedTableState
} from '@/components/data-table/dataTablePersistence';

export { safeJsonParse };

export const NOTIFICATION_TABLE_DEFAULT_PAGE_SIZES = [10, 15, 20, 25, 50, 100];
export const NOTIFICATION_TABLE_DEFAULT_SORTING = [
    { id: 'created_at', desc: true }
];
export const NOTIFICATION_TABLE_COLUMN_IDS = [
    'created_at',
    'type',
    'senderUsername',
    'groupName',
    'photo',
    'message',
    'action',
    'trailing'
];

const STORAGE_KEY = getDataTableStorageKey('notifications');
const LEGACY_COLUMN_ID_MAP: Record<string, string> = {
    createdAt: 'created_at',
    sender: 'senderUsername',
    group: 'groupName',
    actions: 'action'
};

export function readPersistedNotificationTableState() {
    return readPersistedTableState(STORAGE_KEY);
}

export function writePersistedNotificationTableState(
    patch: Record<string, unknown>
) {
    writePersistedTableState(STORAGE_KEY, patch);
}

export function normalizeNotificationColumnId(columnId: any) {
    return LEGACY_COLUMN_ID_MAP[columnId] || columnId;
}

export function sanitizeNotificationSorting(value: any) {
    if (!Array.isArray(value)) {
        return NOTIFICATION_TABLE_DEFAULT_SORTING;
    }

    const allowedIds = new Set([
        'created_at',
        'type',
        'senderUsername',
        'groupName'
    ]);
    const filtered = value
        .map((entry: any) => ({
            ...entry,
            id: normalizeNotificationColumnId(entry?.id)
        }))
        .filter(
            (entry: any) =>
                entry &&
                typeof entry.id === 'string' &&
                allowedIds.has(entry.id)
        );
    return filtered.length ? filtered : NOTIFICATION_TABLE_DEFAULT_SORTING;
}

export function sanitizeNotificationFilters(value: any, allowedTypes: any) {
    const allowedTypeSet = new Set(
        Array.isArray(allowedTypes) ? allowedTypes : []
    );
    if (!Array.isArray(value)) {
        return [];
    }

    return value.filter((type: any) => allowedTypeSet.has(type));
}

export function sanitizeNotificationPageSizes(value: any) {
    if (!Array.isArray(value)) {
        return NOTIFICATION_TABLE_DEFAULT_PAGE_SIZES;
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

    return normalized.length
        ? normalized
        : NOTIFICATION_TABLE_DEFAULT_PAGE_SIZES;
}

export function sanitizeNotificationColumnVisibility(value: any) {
    const visibility: Record<string, boolean> = {};
    if (!value || typeof value !== 'object') {
        return visibility;
    }

    for (const [columnId, visible] of Object.entries(value)) {
        const normalizedColumnId = normalizeNotificationColumnId(columnId);
        if (
            NOTIFICATION_TABLE_COLUMN_IDS.includes(normalizedColumnId) &&
            typeof visible === 'boolean'
        ) {
            visibility[normalizedColumnId] = visible;
        }
    }
    return visibility;
}

export function sanitizeNotificationColumnOrder(value: any) {
    if (!Array.isArray(value)) {
        return [];
    }

    const order: string[] = [];
    for (const columnId of value) {
        const normalizedColumnId = normalizeNotificationColumnId(columnId);
        if (
            NOTIFICATION_TABLE_COLUMN_IDS.includes(normalizedColumnId) &&
            !order.includes(normalizedColumnId)
        ) {
            order.push(normalizedColumnId);
        }
    }
    return order;
}

export function sanitizeNotificationColumnSizing(value: any) {
    if (!value || typeof value !== 'object') {
        return {};
    }

    const normalizedSizing: Record<string, unknown> = {};
    for (const [columnId, rawSize] of Object.entries(value)) {
        const normalizedColumnId = normalizeNotificationColumnId(columnId);
        if (NOTIFICATION_TABLE_COLUMN_IDS.includes(normalizedColumnId)) {
            normalizedSizing[normalizedColumnId] = rawSize;
        }
    }

    return sanitizeTableColumnSizing(
        normalizedSizing,
        NOTIFICATION_TABLE_COLUMN_IDS
    );
}

export function resolveNotificationPageSize(
    candidate: any,
    allowed: any = NOTIFICATION_TABLE_DEFAULT_PAGE_SIZES,
    fallback: any = 20
) {
    const pageSizes = Array.isArray(allowed)
        ? allowed.filter((size: any) => Number.isFinite(size) && size > 0)
        : NOTIFICATION_TABLE_DEFAULT_PAGE_SIZES;
    const fallbackPageSize = pageSizes.length
        ? pageSizes[0]
        : NOTIFICATION_TABLE_DEFAULT_PAGE_SIZES[0];
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
    return pageSizes.includes(fallback)
        ? fallback
        : nearestPageSize(Number(fallback) || fallbackPageSize);
}
