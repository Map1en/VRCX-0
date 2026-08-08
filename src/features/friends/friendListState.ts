import type { SortingState } from '@tanstack/react-table';

import {
    getDataTableStorageKey,
    readPersistedTableState,
    sanitizeTableColumnSizing,
    writePersistedTableState
} from '@/components/data-table/dataTablePersistence';

export const FRIEND_LIST_DEFAULT_PAGE_SIZES = [10, 15, 20, 25, 50, 100];
export const FRIEND_LIST_DEFAULT_SORTING: SortingState = [
    { id: 'friendNumber', desc: true }
];
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
    'inviteSentCount',
    'inviteReceivedCount',
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

export function sanitizeFriendListSorting(value: unknown): SortingState {
    if (!Array.isArray(value)) {
        return FRIEND_LIST_DEFAULT_SORTING;
    }

    const filtered = value.filter((entry): entry is SortingState[number] => {
        if (!entry || typeof entry !== 'object') {
            return false;
        }
        const candidate = Object.fromEntries(Object.entries(entry));
        return (
            typeof candidate.id === 'string' &&
            FRIEND_LIST_SORTING_COLUMN_IDS.includes(candidate.id)
        );
    });
    return filtered.length ? filtered : FRIEND_LIST_DEFAULT_SORTING;
}

export function sanitizeFriendListPageSizes(value: unknown): number[] {
    if (!Array.isArray(value)) {
        return FRIEND_LIST_DEFAULT_PAGE_SIZES;
    }

    const normalized = Array.from(
        new Set(
            value
                .map((entry) => Number.parseInt(String(entry), 10))
                .filter(
                    (entry) =>
                        Number.isFinite(entry) && entry > 0 && entry <= 1000
                )
        )
    ).sort((left, right) => left - right);

    return normalized.length ? normalized : FRIEND_LIST_DEFAULT_PAGE_SIZES;
}

export function sanitizeFriendListColumnVisibility(value: unknown) {
    const visibility: Record<string, boolean> = {
        inviteSentCount: false,
        inviteReceivedCount: false
    };
    if (value && typeof value === 'object') {
        const source = Object.fromEntries(Object.entries(value));
        for (const columnId of FRIEND_LIST_COLUMN_IDS) {
            if (columnId === 'friendNumber') {
                continue;
            }
            if (typeof source[columnId] === 'boolean') {
                visibility[columnId] = source[columnId];
            }
        }
    }
    return visibility;
}

export function sanitizeFriendListColumnOrder(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [...FRIEND_LIST_COLUMN_IDS];
    }

    const orderedColumns = value.filter(
        (columnId, index, source): columnId is string =>
            typeof columnId === 'string' &&
            FRIEND_LIST_COLUMN_IDS.includes(columnId) &&
            source.indexOf(columnId) === index
    );
    const missingColumns = FRIEND_LIST_COLUMN_IDS.filter(
        (columnId) => !orderedColumns.includes(columnId)
    );

    return [...orderedColumns, ...missingColumns];
}

export function sanitizeFriendListColumnSizing(value: unknown) {
    return sanitizeTableColumnSizing(value, FRIEND_LIST_COLUMN_IDS);
}

export function resolveFriendListPageSize(
    candidate: unknown,
    allowed: unknown,
    fallback: number = FRIEND_LIST_DEFAULT_PAGE_SIZES[1]
) {
    const pageSizes = Array.isArray(allowed)
        ? allowed.filter(
              (size): size is number =>
                  typeof size === 'number' && Number.isFinite(size) && size > 0
          )
        : FRIEND_LIST_DEFAULT_PAGE_SIZES;
    const fallbackPageSize = pageSizes.length
        ? pageSizes[0]
        : FRIEND_LIST_DEFAULT_PAGE_SIZES[0];
    const nearestPageSize = (value: number) =>
        pageSizes.length
            ? pageSizes.reduce((previous, size) =>
                  Math.abs(size - value) < Math.abs(previous - value)
                      ? size
                      : previous
              )
            : fallbackPageSize;
    const parsed = Number.parseInt(String(candidate ?? ''), 10);
    if (Number.isFinite(parsed) && parsed > 0) {
        return pageSizes.includes(parsed) ? parsed : nearestPageSize(parsed);
    }

    if (pageSizes.includes(fallback)) {
        return fallback;
    }

    return nearestPageSize(Number(fallback) || fallbackPageSize);
}
