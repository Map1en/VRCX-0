export const NOTIFICATION_TABLE_DEFAULT_PAGE_SIZES = [
    10,
    15,
    20,
    25,
    50,
    100
];
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

const STORAGE_KEY = 'vrcx:table:notifications';
const LEGACY_COLUMN_ID_MAP = {
    createdAt: 'created_at',
    sender: 'senderUsername',
    group: 'groupName',
    actions: 'action'
};

export function safeJsonParse(value) {
    if (!value) {
        return null;
    }

    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
}

export function readPersistedNotificationTableState() {
    if (typeof window === 'undefined') {
        return {};
    }

    try {
        return safeJsonParse(window.localStorage.getItem(STORAGE_KEY)) ?? {};
    } catch {
        return {};
    }
}

export function writePersistedNotificationTableState(patch) {
    if (typeof window === 'undefined') {
        return;
    }

    try {
        const current = readPersistedNotificationTableState();
        window.localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({
                ...current,
                ...patch,
                updatedAt: Date.now()
            })
        );
    } catch {
        // Persisted table state is optional.
    }
}

export function normalizeNotificationColumnId(columnId) {
    return LEGACY_COLUMN_ID_MAP[columnId] || columnId;
}

export function sanitizeNotificationSorting(value) {
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
        .map((entry) => ({
            ...entry,
            id: normalizeNotificationColumnId(entry?.id)
        }))
        .filter(
            (entry) =>
                entry &&
                typeof entry.id === 'string' &&
                allowedIds.has(entry.id)
        );
    return filtered.length ? filtered : NOTIFICATION_TABLE_DEFAULT_SORTING;
}

export function sanitizeNotificationFilters(value, allowedTypes) {
    const allowedTypeSet = new Set(
        Array.isArray(allowedTypes) ? allowedTypes : []
    );
    if (!Array.isArray(value)) {
        return [];
    }

    return value.filter((type) => allowedTypeSet.has(type));
}

export function sanitizeNotificationPageSizes(value) {
    if (!Array.isArray(value)) {
        return NOTIFICATION_TABLE_DEFAULT_PAGE_SIZES;
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

    return normalized.length
        ? normalized
        : NOTIFICATION_TABLE_DEFAULT_PAGE_SIZES;
}

export function sanitizeNotificationColumnVisibility(value) {
    const visibility = {};
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

export function sanitizeNotificationColumnOrder(value) {
    if (!Array.isArray(value)) {
        return [];
    }

    const order = [];
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

export function sanitizeNotificationColumnSizing(value) {
    const sizing = {};
    if (!value || typeof value !== 'object') {
        return sizing;
    }

    for (const [columnId, rawSize] of Object.entries(value)) {
        const normalizedColumnId = normalizeNotificationColumnId(columnId);
        const size = Number(rawSize);
        if (
            NOTIFICATION_TABLE_COLUMN_IDS.includes(normalizedColumnId) &&
            Number.isFinite(size) &&
            size > 0
        ) {
            sizing[normalizedColumnId] = size;
        }
    }

    return sizing;
}

export function resolveNotificationPageSize(
    candidate,
    allowed = NOTIFICATION_TABLE_DEFAULT_PAGE_SIZES,
    fallback = 20
) {
    const pageSizes = Array.isArray(allowed)
        ? allowed.filter((size) => Number.isFinite(size) && size > 0)
        : NOTIFICATION_TABLE_DEFAULT_PAGE_SIZES;
    const fallbackPageSize = pageSizes.length
        ? pageSizes[0]
        : NOTIFICATION_TABLE_DEFAULT_PAGE_SIZES[0];
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
    return pageSizes.includes(fallback)
        ? fallback
        : nearestPageSize(Number(fallback) || fallbackPageSize);
}
