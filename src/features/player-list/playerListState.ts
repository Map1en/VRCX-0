import type {
    SortingState,
    ColumnVisibilityState
} from '@tanstack/react-table';

import {
    getDataTableStorageKey,
    readPersistedTableState,
    writePersistedTableState
} from '@/components/data-table/dataTablePersistence';
import { isRecord } from '@/shared/utils/record';

export const PLAYER_LIST_STORAGE_KEY = getDataTableStorageKey('playerList');

export const PLAYER_LIST_COLUMN_IDS = [
    'avatar',
    'timer',
    'displayName',
    'mutualFriends',
    'rank',
    'groupRoles',
    'status',
    'icon',
    'platform',
    'language',
    'bioLink',
    'note'
];

const PLAYER_LIST_SORTABLE_COLUMN_IDS = [
    'mutualFriends',
    'groupRoles',
    'timer',
    'displayName',
    'rank',
    'platform'
];

export const PLAYER_LIST_MUTUAL_FRIENDS_COLUMN_ID = 'mutualFriends';
export const PLAYER_LIST_GROUP_ROLES_COLUMN_ID = 'groupRoles';

export const DEFAULT_PLAYER_LIST_SORTING = [{ id: 'timer', desc: true }];

export function readPersistedPlayerListState() {
    return readPersistedTableState(PLAYER_LIST_STORAGE_KEY);
}

export function writePersistedPlayerListState(patch: Record<string, unknown>) {
    writePersistedTableState(PLAYER_LIST_STORAGE_KEY, patch);
}

export function sanitizePlayerListSorting(value: unknown): SortingState {
    if (!Array.isArray(value)) {
        return DEFAULT_PLAYER_LIST_SORTING;
    }

    const filtered = value.filter(
        (entry): entry is SortingState[number] =>
            entry &&
            typeof entry.id === 'string' &&
            PLAYER_LIST_SORTABLE_COLUMN_IDS.includes(entry.id)
    );

    return filtered.length ? filtered : DEFAULT_PLAYER_LIST_SORTING;
}

export function sanitizePlayerListColumnVisibility(
    value: unknown
): ColumnVisibilityState {
    const visibility: ColumnVisibilityState = {
        [PLAYER_LIST_GROUP_ROLES_COLUMN_ID]: false
    };
    if (!isRecord(value)) {
        return visibility;
    }
    for (const columnId of PLAYER_LIST_COLUMN_IDS) {
        if (
            columnId !== PLAYER_LIST_MUTUAL_FRIENDS_COLUMN_ID &&
            typeof value[columnId] === 'boolean'
        ) {
            visibility[columnId] = value[columnId];
        }
    }
    return visibility;
}

export function sanitizePlayerListColumnOrder(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [...PLAYER_LIST_COLUMN_IDS];
    }

    const ordered: string[] = [];
    const seen = new Set<string>();
    for (const columnId of value) {
        if (!PLAYER_LIST_COLUMN_IDS.includes(columnId) || seen.has(columnId)) {
            continue;
        }
        ordered.push(columnId);
        seen.add(columnId);
    }
    PLAYER_LIST_COLUMN_IDS.forEach((columnId, index) => {
        if (seen.has(columnId)) {
            return;
        }
        const previous = PLAYER_LIST_COLUMN_IDS.slice(0, index)
            .reverse()
            .find((candidate) => seen.has(candidate));
        ordered.splice(
            previous ? ordered.indexOf(previous) + 1 : 0,
            0,
            columnId
        );
        seen.add(columnId);
    });
    return ordered;
}
