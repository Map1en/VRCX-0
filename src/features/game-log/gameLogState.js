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
export const GAME_LOG_STRETCH_COLUMN_ID = 'detail';

const STORAGE_KEY = 'vrcx:table:gameLog';

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

export function readPersistedGameLogState() {
    if (typeof window === 'undefined') {
        return {};
    }

    try {
        return safeJsonParse(window.localStorage.getItem(STORAGE_KEY)) ?? {};
    } catch {
        return {};
    }
}

export function writePersistedGameLogState(patch) {
    if (typeof window === 'undefined') {
        return;
    }

    try {
        const current = readPersistedGameLogState();
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
    if (!value || typeof value !== 'object') {
        return {};
    }

    const sizing = {};
    for (const columnId of GAME_LOG_COLUMN_IDS) {
        const width = Number.parseInt(value[columnId], 10);
        if (Number.isFinite(width) && width > 0) {
            sizing[columnId] = width;
        }
    }
    return sizing;
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
