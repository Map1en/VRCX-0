import { useEffect, useRef, useState } from 'react';

import { usePersistedTableColumnSizing } from '@/components/data-table/dataTablePersistence';

import {
    MODERATION_COLUMN_IDS,
    readModerationPersistedState,
    sanitizeModerationColumnOrder,
    sanitizeModerationColumnVisibility,
    sanitizeModerationSorting,
    writeModerationPersistedState
} from './moderationPageState';

export function useModerationTableState() {
    const [persistedState] = useState(() => readModerationPersistedState());
    const hasWrittenSortingRef = useRef(false);
    const hasWrittenTableStateRef = useRef(false);
    const [sorting, setSorting] = useState(() =>
        sanitizeModerationSorting(persistedState.sorting)
    );
    const [columnVisibility, setColumnVisibility] = useState(() =>
        sanitizeModerationColumnVisibility(persistedState.columnVisibility)
    );
    const [columnOrder, setColumnOrder] = useState(() =>
        sanitizeModerationColumnOrder(persistedState.columnOrder)
    );
    const [columnSizing, setColumnSizing] = usePersistedTableColumnSizing({
        columnIds: MODERATION_COLUMN_IDS,
        initialValue: persistedState.columnSizing,
        writePersistedState: writeModerationPersistedState
    });
    const [columnOrderLocked, setColumnOrderLocked] = useState(
        () => persistedState.columnOrderLocked === true
    );

    useEffect(() => {
        if (!hasWrittenSortingRef.current) {
            hasWrittenSortingRef.current = true;
            return;
        }
        writeModerationPersistedState({
            sorting: sanitizeModerationSorting(sorting)
        });
    }, [sorting]);

    useEffect(() => {
        if (!hasWrittenTableStateRef.current) {
            hasWrittenTableStateRef.current = true;
            return;
        }
        writeModerationPersistedState({
            columnVisibility:
                sanitizeModerationColumnVisibility(columnVisibility),
            columnOrder: sanitizeModerationColumnOrder(columnOrder),
            columnOrderLocked
        });
    }, [columnOrder, columnOrderLocked, columnVisibility]);

    return {
        columnOrder,
        columnOrderLocked,
        columnSizing,
        columnVisibility,
        setColumnOrder,
        setColumnOrderLocked,
        setColumnSizing,
        setColumnVisibility,
        setSorting,
        sorting
    };
}
