export const FEED_TABLE_DEFAULT_PAGE_SIZES = [10, 15, 20, 25, 50, 100];
export const FEED_TABLE_DEFAULT_SORTING = [];
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

const STORAGE_KEY = 'vrcx:table:feed';

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

export function readPersistedFeedTableState() {
    if (typeof window === 'undefined') {
        return {};
    }

    try {
        return safeJsonParse(window.localStorage.getItem(STORAGE_KEY)) ?? {};
    } catch {
        return {};
    }
}

export function writePersistedFeedTableState(patch) {
    if (typeof window === 'undefined') {
        return;
    }

    try {
        const current = readPersistedFeedTableState();
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

export function sanitizeFeedSorting(value) {
    if (!Array.isArray(value)) {
        return FEED_TABLE_DEFAULT_SORTING;
    }

    const allowedIds = new Set(FEED_TABLE_COLUMN_IDS);
    const filtered = value.filter(
        (entry) =>
            entry && typeof entry.id === 'string' && allowedIds.has(entry.id)
    );
    return filtered.length ? filtered : FEED_TABLE_DEFAULT_SORTING;
}

export function sanitizeFeedPageSizes(value) {
    if (!Array.isArray(value)) {
        return FEED_TABLE_DEFAULT_PAGE_SIZES;
    }

    const sizes = value
        .map((entry) => Number.parseInt(entry, 10))
        .filter(
            (entry) => Number.isFinite(entry) && entry > 0 && entry <= 1000
        );
    return sizes.length
        ? [...new Set(sizes)].sort((left, right) => left - right)
        : FEED_TABLE_DEFAULT_PAGE_SIZES;
}

export function sanitizeFeedColumnVisibility(value) {
    const visibility = {};
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

export function sanitizeFeedColumnOrder(value) {
    if (!Array.isArray(value)) {
        return [];
    }

    return value.filter((columnId) =>
        FEED_TABLE_ORDER_COLUMN_IDS.includes(columnId)
    );
}

export function sanitizeFeedColumnSizing(value) {
    const sizing = {};
    if (!value || typeof value !== 'object') {
        return sizing;
    }

    for (const columnId of FEED_TABLE_ORDER_COLUMN_IDS) {
        const size = Number(value[columnId]);
        if (Number.isFinite(size) && size > 0) {
            sizing[columnId] = size;
        }
    }

    return sizing;
}

export function resolveFeedPageSize(
    candidate,
    pageSizes = FEED_TABLE_DEFAULT_PAGE_SIZES,
    fallback = pageSizes[1] ?? FEED_TABLE_DEFAULT_PAGE_SIZES[1]
) {
    const allowed = Array.isArray(pageSizes)
        ? pageSizes.filter((size) => Number.isFinite(size) && size > 0)
        : FEED_TABLE_DEFAULT_PAGE_SIZES;
    const fallbackPageSize = allowed.length
        ? allowed[0]
        : FEED_TABLE_DEFAULT_PAGE_SIZES[0];
    const nearestPageSize = (value) =>
        allowed.length
            ? allowed.reduce((previous, size) =>
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
