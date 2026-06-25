import { useEffect, useRef, useState } from 'react';

import {
    getTablePageSizePreference,
    getTablePageSizesPreference
} from '@/services/preferencesService';
import { usePreferencesStore } from '@/state/preferencesStore';

import {
    MODERATION_DEFAULT_PAGE_SIZES,
    readModerationPersistedState,
    resolveModerationPageSize,
    sanitizeModerationColumnOrder,
    sanitizeModerationColumnSizing,
    sanitizeModerationColumnVisibility,
    sanitizeModerationPageSizes,
    sanitizeModerationSorting,
    writeModerationPersistedState
} from './moderationPageState';

export function useModerationTableState({
    filteredRowsLength,
    searchQuery,
    selectedTypes
}: {
    filteredRowsLength: number;
    searchQuery: string;
    selectedTypes: string[];
}) {
    const [persistedState] = useState(() => readModerationPersistedState());
    const hasWrittenSortingRef = useRef(false);
    const hasWrittenPageSizeRef = useRef(false);
    const hasWrittenTableStateRef = useRef(false);
    const preferencesHydrated = usePreferencesStore(
        (state: any) => state.preferencesHydrated
    );
    const tablePageSizesPreference = usePreferencesStore(
        (state: any) => state.tablePageSizes
    );
    const [pageSizes, setPageSizes] = useState(MODERATION_DEFAULT_PAGE_SIZES);
    const [sorting, setSorting] = useState(() =>
        sanitizeModerationSorting(persistedState.sorting)
    );
    const [columnVisibility, setColumnVisibility] = useState(() =>
        sanitizeModerationColumnVisibility(persistedState.columnVisibility)
    );
    const [columnOrder, setColumnOrder] = useState(() =>
        sanitizeModerationColumnOrder(persistedState.columnOrder)
    );
    const [columnSizing, setColumnSizing] = useState(() =>
        sanitizeModerationColumnSizing(persistedState.columnSizing)
    );
    const [columnOrderLocked, setColumnOrderLocked] = useState(
        () => persistedState.columnOrderLocked === true
    );
    const [pagination, setPagination] = useState(() => ({
        pageIndex: 0,
        pageSize: resolveModerationPageSize(
            persistedState.pageSize,
            MODERATION_DEFAULT_PAGE_SIZES,
            MODERATION_DEFAULT_PAGE_SIZES[1]
        )
    }));

    useEffect(() => {
        let active = true;
        Promise.all([
            getTablePageSizesPreference(MODERATION_DEFAULT_PAGE_SIZES),
            getTablePageSizePreference(20)
        ])
            .then(([nextPageSizes, nextPageSize]: any) => {
                if (!active) {
                    return;
                }
                const resolvedPageSizes =
                    sanitizeModerationPageSizes(nextPageSizes);
                const parsedPersistedPageSize = Number.parseInt(
                    String(persistedState.pageSize ?? ''),
                    10
                );
                const hasPersistedPageSize =
                    Number.isFinite(parsedPersistedPageSize) &&
                    parsedPersistedPageSize > 0;
                const resolvedConfiguredPageSize = resolveModerationPageSize(
                    nextPageSize,
                    resolvedPageSizes,
                    MODERATION_DEFAULT_PAGE_SIZES[1]
                );
                const resolvedActivePageSize = hasPersistedPageSize
                    ? resolveModerationPageSize(
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
        const resolvedPageSizes = sanitizeModerationPageSizes(
            tablePageSizesPreference
        );
        setPageSizes(resolvedPageSizes);
        setPagination((current: any) => {
            const pageSize = resolveModerationPageSize(
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
        writeModerationPersistedState({
            sorting: sanitizeModerationSorting(sorting)
        });
    }, [sorting]);

    useEffect(() => {
        if (!hasWrittenPageSizeRef.current) {
            hasWrittenPageSizeRef.current = true;
            return;
        }
        writeModerationPersistedState({
            pageSize: pagination.pageSize
        });
    }, [pagination.pageSize]);

    useEffect(() => {
        if (!hasWrittenTableStateRef.current) {
            hasWrittenTableStateRef.current = true;
            return;
        }
        writeModerationPersistedState({
            columnVisibility:
                sanitizeModerationColumnVisibility(columnVisibility),
            columnOrder: sanitizeModerationColumnOrder(columnOrder),
            columnSizing: sanitizeModerationColumnSizing(columnSizing),
            columnOrderLocked
        });
    }, [columnOrder, columnOrderLocked, columnSizing, columnVisibility]);

    useEffect(() => {
        setPagination((current: any) => ({
            ...current,
            pageIndex: 0
        }));
    }, [searchQuery, selectedTypes]);

    useEffect(() => {
        const maxPageIndex = Math.max(
            0,
            Math.ceil(filteredRowsLength / pagination.pageSize) - 1
        );
        if (pagination.pageIndex > maxPageIndex) {
            setPagination((current: any) => ({
                ...current,
                pageIndex: maxPageIndex
            }));
        }
    }, [filteredRowsLength, pagination.pageIndex, pagination.pageSize]);

    function handlePageSizeChange(value: any) {
        const nextPageSize = resolveModerationPageSize(
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
