import { useCallback, useMemo, useState } from 'react';

const DATA_TABLE_STORAGE_PREFIX = 'vrcx-0:table:';
type PersistedTableState = Record<string, unknown>;
type TableColumnSizing = Record<string, number>;
type TableColumnVisibility = Record<string, boolean>;

function getBrowserLocalStorage() {
    if (typeof window === 'undefined' || !window.localStorage) {
        return null;
    }
    return window.localStorage;
}

export function getDataTableStorageKey(tableId: unknown): string {
    return `${DATA_TABLE_STORAGE_PREFIX}${tableId}`;
}

export function safeJsonParse(value: unknown): unknown | null {
    if (!value) {
        return null;
    }

    try {
        return JSON.parse(String(value));
    } catch {
        return null;
    }
}

export function readPersistedTableState(
    storageKey: unknown
): PersistedTableState {
    if (!storageKey) {
        return {};
    }

    const localStorage = getBrowserLocalStorage();
    if (!localStorage) {
        return {};
    }

    try {
        const parsed = safeJsonParse(localStorage.getItem(String(storageKey)));
        return parsed && typeof parsed === 'object'
            ? Object.fromEntries(Object.entries(parsed))
            : {};
    } catch {
        return {};
    }
}

export function writePersistedTableState(
    storageKey: unknown,
    patch: PersistedTableState
): void {
    if (!storageKey) {
        return;
    }

    const localStorage = getBrowserLocalStorage();
    if (!localStorage) {
        return;
    }

    try {
        const current = readPersistedTableState(storageKey);
        localStorage.setItem(
            String(storageKey),
            JSON.stringify({
                ...current,
                ...patch,
                updatedAt: Date.now()
            })
        );
    } catch {
        // no-op
    }
}

export function sanitizeTableColumnSizing(
    value: unknown,
    columnIds: readonly string[]
): TableColumnSizing {
    const sizing: TableColumnSizing = {};
    if (!value || typeof value !== 'object' || !Array.isArray(columnIds)) {
        return sizing;
    }
    const source = Object.fromEntries(Object.entries(value));

    for (const columnId of columnIds) {
        const width = Number.parseInt(String(source[columnId] ?? ''), 10);
        if (Number.isFinite(width) && width > 0) {
            sizing[columnId] = width;
        }
    }
    return sizing;
}

export function sanitizeTableColumnVisibility(
    value: unknown,
    columnIds: readonly string[]
): TableColumnVisibility {
    const visibility: TableColumnVisibility = {};
    if (!value || typeof value !== 'object' || !Array.isArray(columnIds)) {
        return visibility;
    }
    const source = Object.fromEntries(Object.entries(value));

    for (const columnId of columnIds) {
        if (typeof source[columnId] === 'boolean') {
            visibility[columnId] = source[columnId];
        }
    }
    return visibility;
}

export function sanitizeTableColumnOrder(
    value: unknown,
    columnIds: readonly string[],
    fallback: string[] = []
): string[] {
    if (!Array.isArray(value) || !Array.isArray(columnIds)) {
        return fallback;
    }

    return value.filter(
        (columnId): columnId is string =>
            typeof columnId === 'string' && columnIds.includes(columnId)
    );
}

export function createPersistedTableStateHelpers(tableId: unknown) {
    const storageKey = getDataTableStorageKey(tableId);

    return {
        storageKey,
        read: () => readPersistedTableState(storageKey),
        write: (patch: PersistedTableState) =>
            writePersistedTableState(storageKey, patch)
    };
}

export function usePersistedDataTableLayout({
    tableId,
    columnIds = [],
    initialColumnOrder = [],
    initialColumnVisibility = {}
}: {
    tableId?: unknown;
    columnIds?: string[];
    initialColumnOrder?: string[];
    initialColumnVisibility?: TableColumnVisibility;
} = {}) {
    const storageKey = useMemo(
        () => (tableId ? getDataTableStorageKey(tableId) : null),
        [tableId]
    );
    const [persistedState] = useState(() =>
        readPersistedTableState(storageKey)
    );
    const [columnVisibility, setColumnVisibility] = useState(() => ({
        ...initialColumnVisibility,
        ...sanitizeTableColumnVisibility(
            persistedState.columnVisibility,
            columnIds
        )
    }));
    const [columnOrder, setColumnOrder] = useState(() => {
        const persistedOrder = sanitizeTableColumnOrder(
            persistedState.columnOrder,
            columnIds,
            []
        );
        return persistedOrder.length ? persistedOrder : initialColumnOrder;
    });
    const [columnSizing, setColumnSizing] = useState(() =>
        sanitizeTableColumnSizing(persistedState.columnSizing, columnIds)
    );
    const [columnOrderLocked, setColumnOrderLocked] = useState(
        () => persistedState.columnOrderLocked === true
    );
    const writePersistedState = useCallback(
        (patch: PersistedTableState) =>
            writePersistedTableState(storageKey, patch),
        [storageKey]
    );

    return {
        columnOrder,
        columnOrderLocked,
        columnSizing,
        columnVisibility,
        persistedState,
        setColumnOrder,
        setColumnOrderLocked,
        setColumnSizing,
        setColumnVisibility,
        storageKey,
        writePersistedState
    };
}
