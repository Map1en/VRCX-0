import {
    getDataTableStorageKey,
    readPersistedTableState,
    safeJsonParse,
    sanitizeTableColumnSizing,
    writePersistedTableState
} from '@/components/data-table/dataTablePersistence';

export { safeJsonParse };

export const PLAYER_LIST_STORAGE_KEY = getDataTableStorageKey('playerList');

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

export function readPersistedPlayerListState() {
    return readPersistedTableState(PLAYER_LIST_STORAGE_KEY);
}

export function writePersistedPlayerListState(patch: Record<string, unknown>) {
    writePersistedTableState(PLAYER_LIST_STORAGE_KEY, patch);
}

export function sanitizePlayerListSorting(value: any) {
    if (!Array.isArray(value)) {
        return DEFAULT_PLAYER_LIST_SORTING;
    }

    const filtered = value.filter(
        (entry: any) =>
            entry &&
            typeof entry.id === 'string' &&
            PLAYER_LIST_COLUMN_IDS.includes(entry.id)
    );

    return filtered.length ? filtered : DEFAULT_PLAYER_LIST_SORTING;
}

export function sanitizePlayerListColumnVisibility(value: any) {
    const visibility: Record<string, boolean> = {};
    if (value && typeof value === 'object') {
        for (const columnId of PLAYER_LIST_COLUMN_IDS) {
            if (typeof value[columnId] === 'boolean') {
                visibility[columnId] = value[columnId];
            }
        }
    }

    return visibility;
}

export function sanitizePlayerListColumnOrder(value: any) {
    if (!Array.isArray(value)) {
        return [...PLAYER_LIST_COLUMN_IDS];
    }

    const ordered: string[] = [];
    const seen = new Set();
    for (const columnId of value) {
        if (!PLAYER_LIST_COLUMN_IDS.includes(columnId) || seen.has(columnId)) {
            continue;
        }
        ordered.push(columnId);
        seen.add(columnId);
    }
    const missing = PLAYER_LIST_COLUMN_IDS.filter(
        (columnId: any) => !ordered.includes(columnId)
    );
    return [...ordered, ...missing];
}

export function sanitizePlayerListColumnSizing(value: any) {
    return sanitizeTableColumnSizing(value, PLAYER_LIST_COLUMN_IDS);
}
