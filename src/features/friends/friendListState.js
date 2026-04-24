export const FRIEND_LIST_DEFAULT_PAGE_SIZES = [10, 15, 20, 25, 50, 100];
export const FRIEND_LIST_DEFAULT_SORTING = [{ id: 'friendNumber', desc: true }];
export const FRIEND_LIST_SEARCH_FILTERS = [
    { id: 'displayName', label: 'Display Name' },
    { id: 'username', label: 'User Name' },
    { id: 'rank', label: 'Rank' },
    { id: 'status', label: 'Status' },
    { id: 'bio', label: 'Bio' },
    { id: 'note', label: 'Note' },
    { id: 'memo', label: 'Memo' }
];

const VISIBLE_COLUMN_IDS = [
    'leftSpacer',
    'bulkSelect',
    'friendNumber',
    'avatar',
    'displayName',
    'rank',
    'status'
];
const LEGACY_SORT_COLUMN_IDS = [
    'language',
    'bioLink',
    'joinCount',
    'timeTogether',
    'lastSeen',
    'mutualFriends',
    'lastActivity',
    'lastLogin',
    'dateJoined',
    'unfriend'
];
export const FRIEND_LIST_COLUMN_IDS = [
    ...VISIBLE_COLUMN_IDS,
    ...LEGACY_SORT_COLUMN_IDS
];

const STORAGE_KEY = 'vrcx:table:friendList';

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

export function readPersistedFriendListState() {
    if (typeof window === 'undefined') {
        return {};
    }

    try {
        return safeJsonParse(window.localStorage.getItem(STORAGE_KEY)) ?? {};
    } catch {
        return {};
    }
}

export function writePersistedFriendListState(patch) {
    if (typeof window === 'undefined') {
        return;
    }

    try {
        const current = readPersistedFriendListState();
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

export function sanitizeFriendListSorting(value) {
    if (!Array.isArray(value)) {
        return FRIEND_LIST_DEFAULT_SORTING;
    }

    const filtered = value.filter(
        (entry) =>
            entry &&
            typeof entry.id === 'string' &&
            FRIEND_LIST_COLUMN_IDS.includes(entry.id)
    );
    return filtered.length ? filtered : FRIEND_LIST_DEFAULT_SORTING;
}

export function sanitizeFriendListPageSizes(value) {
    if (!Array.isArray(value)) {
        return FRIEND_LIST_DEFAULT_PAGE_SIZES;
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

    return normalized.length ? normalized : FRIEND_LIST_DEFAULT_PAGE_SIZES;
}

export function sanitizeFriendListColumnVisibility(value) {
    const visibility = {};
    if (value && typeof value === 'object') {
        for (const columnId of FRIEND_LIST_COLUMN_IDS) {
            if (columnId === 'friendNumber') {
                continue;
            }
            if (typeof value[columnId] === 'boolean') {
                visibility[columnId] = value[columnId];
            }
        }
    }
    return visibility;
}

export function sanitizeFriendListColumnOrder(value) {
    if (!Array.isArray(value)) {
        return [...FRIEND_LIST_COLUMN_IDS];
    }

    const orderedColumns = value.filter(
        (columnId, index, source) =>
            FRIEND_LIST_COLUMN_IDS.includes(columnId) &&
            source.indexOf(columnId) === index
    );
    const missingColumns = FRIEND_LIST_COLUMN_IDS.filter(
        (columnId) => !orderedColumns.includes(columnId)
    );

    return [...orderedColumns, ...missingColumns];
}

export function sanitizeFriendListColumnSizing(value) {
    if (!value || typeof value !== 'object') {
        return {};
    }

    const sizing = {};
    for (const columnId of FRIEND_LIST_COLUMN_IDS) {
        const width = Number.parseInt(value[columnId], 10);
        if (Number.isFinite(width) && width > 0) {
            sizing[columnId] = width;
        }
    }
    return sizing;
}

export function resolveFriendListPageSize(
    candidate,
    allowed,
    fallback = FRIEND_LIST_DEFAULT_PAGE_SIZES[1]
) {
    const pageSizes = Array.isArray(allowed)
        ? allowed.filter((size) => Number.isFinite(size) && size > 0)
        : FRIEND_LIST_DEFAULT_PAGE_SIZES;
    const fallbackPageSize = pageSizes.length
        ? pageSizes[0]
        : FRIEND_LIST_DEFAULT_PAGE_SIZES[0];
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
