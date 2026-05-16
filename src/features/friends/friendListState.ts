// @ts-nocheck
import {
    getDataTableStorageKey,
    readPersistedTableState,
    sanitizeTableColumnSizing,
    writePersistedTableState
} from '@/components/data-table/dataTablePersistence.js';

export const FRIEND_LIST_DEFAULT_PAGE_SIZES = [10, 15, 20, 25, 50, 100];
export const FRIEND_LIST_DEFAULT_SORTING = [{ id: 'friendNumber', desc: true }];
export const FRIEND_LIST_SEARCH_FILTERS = [
    {
        id: 'displayName',
        labelKey: 'view.friend_list.search_filters.display_name'
    },
    { id: 'username', labelKey: 'view.friend_list.search_filters.username' },
    { id: 'rank', labelKey: 'view.friend_list.search_filters.rank' },
    { id: 'status', labelKey: 'view.friend_list.search_filters.status' },
    { id: 'bio', labelKey: 'view.friend_list.search_filters.bio' },
    { id: 'note', labelKey: 'view.friend_list.search_filters.note' },
    { id: 'memo', labelKey: 'view.friend_list.search_filters.memo' }
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

const STORAGE_KEY = getDataTableStorageKey('friendList');

export function readPersistedFriendListState() {
    return readPersistedTableState(STORAGE_KEY);
}

export function writePersistedFriendListState(patch) {
    writePersistedTableState(STORAGE_KEY, patch);
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
    return sanitizeTableColumnSizing(value, FRIEND_LIST_COLUMN_IDS);
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
