import { useEffect, useRef, useState } from 'react';

import { usePersistedTableColumnSizing } from '@/components/data-table/dataTablePersistence';

import {
    PLAYER_LIST_COLUMN_IDS as COLUMN_IDS,
    readPersistedPlayerListState,
    sanitizePlayerListColumnOrder,
    sanitizePlayerListColumnVisibility,
    sanitizePlayerListSorting,
    writePersistedPlayerListState
} from './playerListState';

export function usePlayerListTableState() {
    const [persistedState] = useState(() => readPersistedPlayerListState());
    const hasWrittenSortingRef = useRef(false);
    const hasWrittenTableStateRef = useRef(false);

    const [sorting, setSorting] = useState(() =>
        sanitizePlayerListSorting(persistedState.sorting)
    );
    const [columnVisibility, setColumnVisibility] = useState(() =>
        sanitizePlayerListColumnVisibility(persistedState.columnVisibility)
    );
    const [columnOrder, setColumnOrder] = useState(() =>
        sanitizePlayerListColumnOrder(persistedState.columnOrder)
    );
    const [columnSizing, setColumnSizing] = usePersistedTableColumnSizing({
        columnIds: COLUMN_IDS,
        initialValue: persistedState.columnSizing,
        writePersistedState: writePersistedPlayerListState
    });
    const [columnOrderLocked, setColumnOrderLocked] = useState(
        () => persistedState.columnOrderLocked === true
    );

    useEffect(() => {
        if (!hasWrittenSortingRef.current) {
            hasWrittenSortingRef.current = true;
            return;
        }

        writePersistedPlayerListState({
            sorting: sanitizePlayerListSorting(sorting)
        });
    }, [sorting]);

    useEffect(() => {
        if (!hasWrittenTableStateRef.current) {
            hasWrittenTableStateRef.current = true;
            return;
        }

        writePersistedPlayerListState({
            columnOrder: sanitizePlayerListColumnOrder(columnOrder),
            columnOrderLocked,
            columnVisibility:
                sanitizePlayerListColumnVisibility(columnVisibility)
        });
    }, [columnOrder, columnOrderLocked, columnVisibility]);

    function resetLayout() {
        setColumnVisibility(sanitizePlayerListColumnVisibility({}));
        setColumnOrder([...COLUMN_IDS]);
        setColumnSizing({});
    }

    return {
        columnOrder,
        columnOrderLocked,
        columnSizing,
        columnVisibility,
        resetLayout,
        setColumnOrder,
        setColumnOrderLocked,
        setColumnSizing,
        setColumnVisibility,
        setSorting,
        sorting
    };
}
