import type { ColumnSizingState, OnChangeFn } from '@tanstack/react-table';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
    STORAGE_KEYS,
    readStoredJson,
    writeStoredText
} from '@/lib/browserStorage';

const DATA_TABLE_STORAGE_PREFIX = STORAGE_KEYS.dataTablePrefix;
const COLUMN_SIZING_SAVE_DELAY_MS = 300;
type PersistedTableState = Record<string, unknown>;
type TableColumnSizing = Record<string, number>;
type TableColumnVisibility = Record<string, boolean>;

export function usePersistedTableColumnSizing({
    columnIds,
    initialValue,
    writePersistedState
}: {
    columnIds: readonly string[];
    initialValue: unknown;
    writePersistedState(patch: PersistedTableState): void;
}): [ColumnSizingState, OnChangeFn<ColumnSizingState>] {
    const [columnSizing, setColumnSizingState] = useState(() =>
        sanitizeTableColumnSizing(initialValue, columnIds)
    );
    const columnSizingRef = useRef(columnSizing);
    const pendingWriteRef = useRef<{
        timer: ReturnType<typeof setTimeout>;
        write: () => void;
    } | null>(null);

    const flushPendingWrite = useCallback(() => {
        const pending = pendingWriteRef.current;
        if (!pending) {
            return;
        }
        pendingWriteRef.current = null;
        clearTimeout(pending.timer);
        pending.write();
    }, []);

    useEffect(
        () => flushPendingWrite,
        [flushPendingWrite, writePersistedState]
    );

    const setColumnSizing = useCallback<OnChangeFn<ColumnSizingState>>(
        (updater) => {
            const nextColumnSizing = sanitizeTableColumnSizing(
                typeof updater === 'function'
                    ? updater(columnSizingRef.current)
                    : updater,
                columnIds
            );
            columnSizingRef.current = nextColumnSizing;
            setColumnSizingState(nextColumnSizing);
            if (pendingWriteRef.current) {
                clearTimeout(pendingWriteRef.current.timer);
            }
            pendingWriteRef.current = {
                timer: setTimeout(
                    flushPendingWrite,
                    COLUMN_SIZING_SAVE_DELAY_MS
                ),
                write: () =>
                    writePersistedState({ columnSizing: nextColumnSizing })
            };
        },
        [columnIds, flushPendingWrite, writePersistedState]
    );

    return [columnSizing, setColumnSizing];
}

export function getDataTableStorageKey(tableId: string): string {
    return `${DATA_TABLE_STORAGE_PREFIX}${tableId}`;
}

export function readPersistedTableState(
    storageKey: string | null
): PersistedTableState {
    if (!storageKey) {
        return {};
    }

    const parsed = readStoredJson(storageKey);
    return parsed && typeof parsed === 'object'
        ? Object.fromEntries(Object.entries(parsed))
        : {};
}

export function writePersistedTableState(
    storageKey: string | null,
    patch: PersistedTableState
): void {
    if (!storageKey) {
        return;
    }

    writeStoredText(
        storageKey,
        JSON.stringify({
            ...readPersistedTableState(storageKey),
            ...patch,
            updatedAt: Date.now()
        })
    );
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

export function usePersistedDataTableLayout({
    tableId,
    columnIds = [],
    initialColumnOrder = [],
    initialColumnVisibility = {}
}: {
    tableId?: string;
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
    const [columnOrderLocked, setColumnOrderLocked] = useState(
        () => persistedState.columnOrderLocked === true
    );
    const writePersistedState = useCallback(
        (patch: PersistedTableState) =>
            writePersistedTableState(storageKey, patch),
        [storageKey]
    );
    const [columnSizing, setColumnSizing] = usePersistedTableColumnSizing({
        columnIds,
        initialValue: persistedState.columnSizing,
        writePersistedState
    });

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
