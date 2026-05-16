// @ts-nocheck
import { useCallback, useMemo, useState } from 'react';

const DATA_TABLE_STORAGE_PREFIX = 'vrcx-0:table:';

function getBrowserLocalStorage() {
    if (typeof window === 'undefined' || !window.localStorage) {
        return null;
    }
    return window.localStorage;
}

export function getDataTableStorageKey(tableId) {
    return `${DATA_TABLE_STORAGE_PREFIX}${tableId}`;
}

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

export function readPersistedTableState(storageKey) {
    if (!storageKey) {
        return {};
    }

    const localStorage = getBrowserLocalStorage();
    if (!localStorage) {
        return {};
    }

    try {
        return safeJsonParse(localStorage.getItem(storageKey)) ?? {};
    } catch {
        return {};
    }
}

export function writePersistedTableState(storageKey, patch) {
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
            storageKey,
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

export function sanitizeTableColumnSizing(value, columnIds) {
    const sizing = {};
    if (!value || typeof value !== 'object' || !Array.isArray(columnIds)) {
        return sizing;
    }

    for (const columnId of columnIds) {
        const width = Number.parseInt(value[columnId], 10);
        if (Number.isFinite(width) && width > 0) {
            sizing[columnId] = width;
        }
    }
    return sizing;
}

export function sanitizeTableColumnVisibility(value, columnIds) {
    const visibility = {};
    if (!value || typeof value !== 'object' || !Array.isArray(columnIds)) {
        return visibility;
    }

    for (const columnId of columnIds) {
        if (typeof value[columnId] === 'boolean') {
            visibility[columnId] = value[columnId];
        }
    }
    return visibility;
}

export function sanitizeTableColumnOrder(value, columnIds, fallback = []) {
    if (!Array.isArray(value) || !Array.isArray(columnIds)) {
        return fallback;
    }

    return value.filter((columnId) => columnIds.includes(columnId));
}

export function createPersistedTableStateHelpers(tableId) {
    const storageKey = getDataTableStorageKey(tableId);

    return {
        storageKey,
        read: () => readPersistedTableState(storageKey),
        write: (patch) => writePersistedTableState(storageKey, patch)
    };
}

export function usePersistedDataTableLayout({
    tableId,
    columnIds = [],
    initialColumnOrder = [],
    initialColumnVisibility = {}
} = {}) {
    const storageKey = useMemo(
        () => (tableId ? getDataTableStorageKey(tableId) : null),
        [tableId]
    );
    const [persistedState] = useState(() => readPersistedTableState(storageKey));
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
        (patch) => writePersistedTableState(storageKey, patch),
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
