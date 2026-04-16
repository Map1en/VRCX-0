export const PLAYER_LIST_STORAGE_KEY = 'vrcx:table:playerList';

export const PLAYER_LIST_COLUMN_IDS = [
    'avatar',
    'timer',
    'displayName',
    'rank',
    'status',
    'icon',
    'platform',
    'language',
    'bioLink',
    'note'
];

export const DEFAULT_PLAYER_LIST_SORTING = [{ id: 'timer', desc: true }];

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

export function readPersistedPlayerListState() {
    if (typeof window === 'undefined') {
        return {};
    }

    try {
        return (
            safeJsonParse(window.localStorage.getItem(PLAYER_LIST_STORAGE_KEY)) ??
            {}
        );
    } catch {
        return {};
    }
}

export function writePersistedPlayerListState(patch) {
    if (typeof window === 'undefined') {
        return;
    }

    try {
        const current = readPersistedPlayerListState();
        window.localStorage.setItem(
            PLAYER_LIST_STORAGE_KEY,
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

export function sanitizePlayerListSorting(value) {
    if (!Array.isArray(value)) {
        return DEFAULT_PLAYER_LIST_SORTING;
    }

    const filtered = value.filter(
        (entry) =>
            entry &&
            typeof entry.id === 'string' &&
            PLAYER_LIST_COLUMN_IDS.includes(entry.id)
    );

    return filtered.length ? filtered : DEFAULT_PLAYER_LIST_SORTING;
}

export function sanitizePlayerListColumnVisibility(value) {
    const visibility = {};
    if (value && typeof value === 'object') {
        for (const columnId of PLAYER_LIST_COLUMN_IDS) {
            if (typeof value[columnId] === 'boolean') {
                visibility[columnId] = value[columnId];
            }
        }
    }

    return visibility;
}

export function sanitizePlayerListColumnOrder(value) {
    if (!Array.isArray(value)) {
        return [...PLAYER_LIST_COLUMN_IDS];
    }

    const ordered = [];
    const seen = new Set();
    for (const columnId of value) {
        if (!PLAYER_LIST_COLUMN_IDS.includes(columnId) || seen.has(columnId)) {
            continue;
        }
        ordered.push(columnId);
        seen.add(columnId);
    }
    const missing = PLAYER_LIST_COLUMN_IDS.filter(
        (columnId) => !ordered.includes(columnId)
    );
    return [...ordered, ...missing];
}

export function sanitizePlayerListColumnSizing(value) {
    if (!value || typeof value !== 'object') {
        return {};
    }

    const sizing = {};
    for (const columnId of PLAYER_LIST_COLUMN_IDS) {
        const width = Number.parseInt(value[columnId], 10);
        if (Number.isFinite(width) && width > 0) {
            sizing[columnId] = width;
        }
    }
    return sizing;
}
