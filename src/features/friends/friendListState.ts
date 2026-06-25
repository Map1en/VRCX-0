import {
    getDataTableStorageKey,
    readPersistedTableState,
    sanitizeTableColumnSizing,
    writePersistedTableState
} from '@/components/data-table/dataTablePersistence';

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
const FRIEND_LIST_SORTING_COLUMN_IDS = FRIEND_LIST_COLUMN_IDS.filter(
    (columnId) => columnId !== 'displayName'
);

const STORAGE_KEY = getDataTableStorageKey('friendList');

export function readPersistedFriendListState() {
    return readPersistedTableState(STORAGE_KEY);
}

export function writePersistedFriendListState(patch: Record<string, unknown>) {
    writePersistedTableState(STORAGE_KEY, patch);
}

export function sanitizeFriendListSorting(value: any) {
    if (!Array.isArray(value)) {
        return FRIEND_LIST_DEFAULT_SORTING;
    }

    const filtered = value.filter(
        (entry: any) =>
            entry &&
            typeof entry.id === 'string' &&
            FRIEND_LIST_SORTING_COLUMN_IDS.includes(entry.id)
    );
    return filtered.length ? filtered : FRIEND_LIST_DEFAULT_SORTING;
}

export function sanitizeFriendListPageSizes(value: any) {
    if (!Array.isArray(value)) {
        return FRIEND_LIST_DEFAULT_PAGE_SIZES;
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

    return normalized.length ? normalized : FRIEND_LIST_DEFAULT_PAGE_SIZES;
}

export function sanitizeFriendListColumnVisibility(value: any) {
    const visibility: Record<string, boolean> = {};
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

export function sanitizeFriendListColumnOrder(value: any) {
    if (!Array.isArray(value)) {
        return [...FRIEND_LIST_COLUMN_IDS];
    }

    const orderedColumns = value.filter(
        (columnId: any, index: any, source: any) =>
            FRIEND_LIST_COLUMN_IDS.includes(columnId) &&
            source.indexOf(columnId) === index
    );
    const missingColumns = FRIEND_LIST_COLUMN_IDS.filter(
        (columnId: any) => !orderedColumns.includes(columnId)
    );

    return [...orderedColumns, ...missingColumns];
}

export function sanitizeFriendListColumnSizing(value: any) {
    return sanitizeTableColumnSizing(value, FRIEND_LIST_COLUMN_IDS);
}

export function resolveFriendListPageSize(
    candidate: any,
    allowed: any,
    fallback: any = FRIEND_LIST_DEFAULT_PAGE_SIZES[1]
) {
    const pageSizes = Array.isArray(allowed)
        ? allowed.filter((size: any) => Number.isFinite(size) && size > 0)
        : FRIEND_LIST_DEFAULT_PAGE_SIZES;
    const fallbackPageSize = pageSizes.length
        ? pageSizes[0]
        : FRIEND_LIST_DEFAULT_PAGE_SIZES[0];
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
