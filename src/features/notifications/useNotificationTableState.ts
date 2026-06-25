import { useEffect, useRef, useState } from 'react';

import { usePreferencesStore } from '@/state/preferencesStore';

import {
    NOTIFICATION_TABLE_DEFAULT_PAGE_SIZES as DEFAULT_PAGE_SIZES,
    readPersistedNotificationTableState as readPersistedState,
    resolveNotificationPageSize as resolvePageSize,
    sanitizeNotificationColumnOrder as sanitizeColumnOrder,
    sanitizeNotificationColumnSizing as sanitizeColumnSizing,
    sanitizeNotificationColumnVisibility as sanitizeColumnVisibility,
    sanitizeNotificationPageSizes as sanitizePageSizes,
    sanitizeNotificationSorting as sanitizeSorting,
    writePersistedNotificationTableState as writePersistedState
} from './notificationTableState';

type NotificationPagination = {
    pageIndex: number;
    pageSize: number;
};

export function useNotificationTableState({
    activeTypes,
    deferredSearchQuery
}: {
    activeTypes: string[];
    deferredSearchQuery: string;
}) {
    const preferencesHydrated = usePreferencesStore(
        (state: any) => state.preferencesHydrated
    );
    const tablePageSizePreference = usePreferencesStore(
        (state: any) => state.tablePageSize
    );
    const tablePageSizesPreference = usePreferencesStore(
        (state: any) => state.tablePageSizes
    );

    const [persistedState] = useState(() => readPersistedState());
    const persistedPageSize = Number.parseInt(
        String(persistedState.pageSize ?? ''),
        10
    );
    const hasPersistedPageSize =
        Number.isFinite(persistedPageSize) && persistedPageSize > 0;
    const hasStoredPageSizeRef = useRef(hasPersistedPageSize);
    const storedPageSizeRef = useRef(
        hasPersistedPageSize ? persistedPageSize : null
    );
    const hasWrittenSortingRef = useRef(false);
    const hasWrittenPageSizeRef = useRef(false);
    const hasWrittenColumnVisibilityRef = useRef(false);
    const hasWrittenTableLayoutRef = useRef(false);
    const [pageSizes, setPageSizes] = useState(DEFAULT_PAGE_SIZES);
    const [sorting, setSorting] = useState(() =>
        sanitizeSorting(persistedState.sorting)
    );
    const [columnVisibility, setColumnVisibility] = useState(() =>
        sanitizeColumnVisibility(persistedState.columnVisibility)
    );
    const [columnOrder, setColumnOrder] = useState(() =>
        sanitizeColumnOrder(persistedState.columnOrder)
    );
    const [columnSizing, setColumnSizing] = useState(() =>
        sanitizeColumnSizing(persistedState.columnSizing)
    );
    const [columnOrderLocked, setColumnOrderLocked] = useState(
        () => persistedState.columnOrderLocked === true
    );
    const [pagination, setPagination] = useState<NotificationPagination>({
        pageIndex: 0,
        pageSize: resolvePageSize(persistedPageSize)
    });

    useEffect(() => {
        if (!hasWrittenSortingRef.current) {
            hasWrittenSortingRef.current = true;
            return;
        }
        writePersistedState({
            sorting: sanitizeSorting(sorting)
        });
    }, [sorting]);

    useEffect(() => {
        if (!hasWrittenPageSizeRef.current) {
            hasWrittenPageSizeRef.current = true;
            return;
        }
        hasStoredPageSizeRef.current = true;
        storedPageSizeRef.current = pagination.pageSize;
        writePersistedState({
            pageSize: pagination.pageSize
        });
    }, [pagination.pageSize]);

    useEffect(() => {
        if (!hasWrittenColumnVisibilityRef.current) {
            hasWrittenColumnVisibilityRef.current = true;
            return;
        }
        writePersistedState({
            columnVisibility: sanitizeColumnVisibility(columnVisibility)
        });
    }, [columnVisibility]);

    useEffect(() => {
        if (!hasWrittenTableLayoutRef.current) {
            hasWrittenTableLayoutRef.current = true;
            return;
        }
        writePersistedState({
            columnOrder: sanitizeColumnOrder(columnOrder),
            columnOrderLocked,
            columnSizing: sanitizeColumnSizing(columnSizing)
        });
    }, [columnOrder, columnOrderLocked, columnSizing]);

    useEffect(() => {
        if (!preferencesHydrated) {
            return;
        }
        const resolvedPageSizes = sanitizePageSizes(tablePageSizesPreference);
        const configuredPageSize = resolvePageSize(
            tablePageSizePreference,
            resolvedPageSizes
        );
        setPageSizes(resolvedPageSizes);
        setPagination((current) => {
            const storedPageSize = Number.isFinite(storedPageSizeRef.current)
                ? storedPageSizeRef.current
                : current.pageSize;
            const activePageSize = hasStoredPageSizeRef.current
                ? resolvePageSize(
                      storedPageSize,
                      resolvedPageSizes,
                      configuredPageSize
                  )
                : configuredPageSize;
            storedPageSizeRef.current = activePageSize;
            return activePageSize === current.pageSize
                ? current
                : {
                      ...current,
                      pageSize: activePageSize
                  };
        });
    }, [
        preferencesHydrated,
        tablePageSizePreference,
        tablePageSizesPreference
    ]);

    useEffect(() => {
        setPagination((current) => ({
            ...current,
            pageIndex: 0
        }));
    }, [activeTypes, deferredSearchQuery]);

    function handlePageSizeChange(value: number) {
        setPagination({
            pageIndex: 0,
            pageSize: resolvePageSize(value, pageSizes, pagination.pageSize)
        });
    }

    return {
        columnOrder,
        columnOrderLocked,
        columnSizing,
        columnVisibility,
        handlePageSizeChange,
        pageSizes,
        pagination,
        setColumnOrder,
        setColumnOrderLocked,
        setColumnSizing,
        setColumnVisibility,
        setPagination,
        setSorting,
        sorting
    };
}
