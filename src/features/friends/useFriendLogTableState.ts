import { useEffect, useRef, useState } from 'react';

import {
    getTablePageSizePreference,
    getTablePageSizesPreference
} from '@/services/preferencesService';
import { usePreferencesStore } from '@/state/preferencesStore';

import {
    DEFAULT_PAGE_SIZES,
    readPersistedState,
    resolvePageSize,
    sanitizeColumnOrder,
    sanitizeColumnSizing,
    sanitizeColumnVisibility,
    sanitizePageSizes,
    sanitizeSorting,
    writePersistedState
} from './friendLogState';

export function useFriendLogTableState({
    hideUnfriends,
    orderedRowsLength,
    searchQuery,
    selectedTypes
}: {
    hideUnfriends: boolean;
    orderedRowsLength: number;
    searchQuery: string;
    selectedTypes: string[];
}) {
    const preferencesHydrated = usePreferencesStore(
        (state: any) => state.preferencesHydrated
    );
    const tablePageSizesPreference = usePreferencesStore(
        (state: any) => state.tablePageSizes
    );
    const [persistedState] = useState(() => readPersistedState());
    const hasWrittenSortingRef = useRef(false);
    const hasWrittenPageSizeRef = useRef(false);
    const hasWrittenTableStateRef = useRef(false);
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
    const [pagination, setPagination] = useState(() => ({
        pageIndex: 0,
        pageSize: resolvePageSize(
            persistedState.pageSize,
            DEFAULT_PAGE_SIZES,
            DEFAULT_PAGE_SIZES[1]
        )
    }));

    useEffect(() => {
        let active = true;
        Promise.all([
            getTablePageSizesPreference(DEFAULT_PAGE_SIZES),
            getTablePageSizePreference(20)
        ])
            .then(([nextPageSizes, nextPageSize]: any) => {
                if (!active) {
                    return;
                }
                const resolvedPageSizes = sanitizePageSizes(nextPageSizes);
                const parsedPersistedPageSize = Number.parseInt(
                    String(persistedState.pageSize ?? ''),
                    10
                );
                const hasPersistedPageSize =
                    Number.isFinite(parsedPersistedPageSize) &&
                    parsedPersistedPageSize > 0;
                const resolvedConfiguredPageSize = resolvePageSize(
                    nextPageSize,
                    resolvedPageSizes,
                    DEFAULT_PAGE_SIZES[1]
                );
                const resolvedActivePageSize = hasPersistedPageSize
                    ? resolvePageSize(
                          parsedPersistedPageSize,
                          resolvedPageSizes,
                          resolvedConfiguredPageSize
                      )
                    : resolvedConfiguredPageSize;
                setPageSizes(resolvedPageSizes);
                setPagination((current: any) => ({
                    ...current,
                    pageSize: resolvedActivePageSize
                }));
            })
            .catch(() => {});
        return () => {
            active = false;
        };
    }, [persistedState.pageSize]);

    useEffect(() => {
        if (!preferencesHydrated) {
            return;
        }
        const resolvedPageSizes = sanitizePageSizes(tablePageSizesPreference);
        setPageSizes(resolvedPageSizes);
        setPagination((current: any) => {
            const pageSize = resolvePageSize(
                current.pageSize,
                resolvedPageSizes
            );
            return pageSize === current.pageSize
                ? current
                : {
                      ...current,
                      pageSize
                  };
        });
    }, [preferencesHydrated, tablePageSizesPreference]);

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
        writePersistedState({
            pageSize: pagination.pageSize
        });
    }, [pagination.pageSize]);

    useEffect(() => {
        if (!hasWrittenTableStateRef.current) {
            hasWrittenTableStateRef.current = true;
            return;
        }
        writePersistedState({
            columnVisibility: sanitizeColumnVisibility(columnVisibility),
            columnOrder: sanitizeColumnOrder(columnOrder),
            columnSizing: sanitizeColumnSizing(columnSizing),
            columnOrderLocked
        });
    }, [columnOrder, columnOrderLocked, columnSizing, columnVisibility]);

    useEffect(() => {
        setPagination((current: any) => ({
            ...current,
            pageIndex: 0
        }));
    }, [searchQuery, selectedTypes, hideUnfriends]);

    useEffect(() => {
        const maxPageIndex = Math.max(
            0,
            Math.ceil(orderedRowsLength / pagination.pageSize) - 1
        );
        if (pagination.pageIndex > maxPageIndex) {
            setPagination((current: any) => ({
                ...current,
                pageIndex: maxPageIndex
            }));
        }
    }, [orderedRowsLength, pagination.pageIndex, pagination.pageSize]);

    function setPageSize(value: unknown) {
        const nextPageSize = resolvePageSize(
            value,
            pageSizes,
            pagination.pageSize
        );
        setPagination({
            pageIndex: 0,
            pageSize: nextPageSize
        });
    }

    return {
        columnOrder,
        columnOrderLocked,
        columnSizing,
        columnVisibility,
        pageSizes,
        pagination,
        setColumnOrder,
        setColumnOrderLocked,
        setColumnSizing,
        setColumnVisibility,
        setPageSize,
        setPagination,
        setSorting,
        sorting
    };
}
