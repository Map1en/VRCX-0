import { FRIEND_LOG_TYPES } from './components/FriendLogViewParts.jsx';

export const DEFAULT_PAGE_SIZES = [10, 25, 50];
export const COLUMN_IDS = [
    'spacer',
    'created_at',
    'type',
    'displayName',
    'action',
    'trailing'
];

const DEFAULT_SORTING = [];
const STORAGE_KEY = 'vrcx:table:friendLog';

function safeJsonParse(value) {
    if (!value) {
        return null;
    }

    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
}

export function readPersistedState() {
    if (typeof window === 'undefined') {
        return {};
    }

    try {
        return safeJsonParse(window.localStorage.getItem(STORAGE_KEY)) ?? {};
    } catch {
        return {};
    }
}

export function writePersistedState(patch) {
    if (typeof window === 'undefined') {
        return;
    }

    try {
        const current = readPersistedState();
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

export function sanitizeSorting(value) {
    if (!Array.isArray(value)) {
        return DEFAULT_SORTING;
    }

    return value.filter(
        (entry) =>
            entry &&
            typeof entry.id === 'string' &&
            COLUMN_IDS.includes(entry.id)
    );
}

export function sanitizePageSizes(value) {
    if (!Array.isArray(value)) {
        return DEFAULT_PAGE_SIZES;
    }

    const normalized = Array.from(
        new Set(
            value
                .map((entry) => Number.parseInt(entry, 10))
                .filter((entry) => Number.isFinite(entry) && entry > 0)
        )
    ).sort((left, right) => left - right);

    return normalized.length ? normalized : DEFAULT_PAGE_SIZES;
}

export function sanitizeColumnVisibility(value) {
    const visibility = {};
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

export function sanitizeColumnOrder(value) {
    if (!Array.isArray(value)) {
        return COLUMN_IDS;
    }

    const orderedColumns = value.filter((columnId) =>
        COLUMN_IDS.includes(columnId)
    );
    const missingColumns = COLUMN_IDS.filter(
        (columnId) => !orderedColumns.includes(columnId)
    );
    return [...orderedColumns, ...missingColumns];
}

export function sanitizeColumnSizing(value) {
    if (!value || typeof value !== 'object') {
        return {};
    }

    const sizing = {};
    for (const columnId of COLUMN_IDS) {
        const width = Number.parseInt(value[columnId], 10);
        if (Number.isFinite(width) && width > 0) {
            sizing[columnId] = width;
        }
    }
    return sizing;
}

export function resolvePageSize(
    candidate,
    allowed,
    fallback = DEFAULT_PAGE_SIZES[1]
) {
    const parsed = Number.parseInt(candidate, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
        if (allowed.includes(parsed)) {
            return parsed;
        }

        if (allowed.includes(fallback)) {
            return fallback;
        }

        return allowed[0] ?? DEFAULT_PAGE_SIZES[0];
    }

    if (allowed.includes(fallback)) {
        return fallback;
    }

    return allowed[0] ?? DEFAULT_PAGE_SIZES[0];
}

export function parseTypeFilters(value) {
    const parsed = safeJsonParse(value);
    if (!Array.isArray(parsed)) {
        return [];
    }

    return parsed.filter(
        (entry) => typeof entry === 'string' && FRIEND_LOG_TYPES.includes(entry)
    );
}
