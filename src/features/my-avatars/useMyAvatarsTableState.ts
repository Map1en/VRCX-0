import { useEffect, useMemo, useRef, useState } from 'react';

import {
    getTablePageSizePreference,
    getTablePageSizesPreference
} from '@/services/preferencesService';
import { usePreferencesStore } from '@/state/preferencesStore';

import {
    MY_AVATARS_DEFAULT_COLUMN_VISIBILITY,
    MY_AVATARS_DEFAULT_PAGE_SIZES,
    readPersistedMyAvatarsState,
    resolveMyAvatarsColumnVisibility,
    resolveMyAvatarsPageSize,
    sanitizeMyAvatarsColumnOrder,
    sanitizeMyAvatarsColumnSizing,
    sanitizeMyAvatarsColumnVisibility,
    sanitizeMyAvatarsPageSizes,
    sanitizeMyAvatarsSorting,
    writePersistedMyAvatarsState
} from './myAvatarsState';
import type { MyAvatarsViewMode } from './myAvatarsTypes';

function resolveTableColumnOrder(columnOrder: any) {
    const ordered = sanitizeMyAvatarsColumnOrder(columnOrder);
    return [
        ...ordered.filter((columnId: any) => columnId !== 'actions'),
        'actions'
    ];
}

export function useMyAvatarsTableState({
    deferredSearchQuery,
    filteredCount,
    platformFilter,
    releaseStatusFilter,
    tagFilters,
    viewMode
}: {
    deferredSearchQuery: string;
    filteredCount: number;
    platformFilter: string;
    releaseStatusFilter: string;
    tagFilters: Set<string>;
    viewMode: MyAvatarsViewMode;
}) {
    const [persistedState] = useState(() => readPersistedMyAvatarsState());
    const hasWrittenSortingRef = useRef(false);
    const hasWrittenPageSizeRef = useRef(false);
    const hasWrittenTableStateRef = useRef(false);
    const preferencesHydrated = usePreferencesStore(
        (state: any) => state.preferencesHydrated
    );
    const tablePageSizesPreference = usePreferencesStore(
        (state: any) => state.tablePageSizes
    );
    const [pageSizes, setPageSizes] = useState(MY_AVATARS_DEFAULT_PAGE_SIZES);
    const [sorting, setSorting] = useState(() =>
        sanitizeMyAvatarsSorting(persistedState.sorting)
    );
    const [columnVisibility, setColumnVisibility] = useState(() =>
        resolveMyAvatarsColumnVisibility(persistedState)
    );
    const [columnOrder, setColumnOrder] = useState(() =>
        sanitizeMyAvatarsColumnOrder(persistedState.columnOrder)
    );
    const [columnSizing, setColumnSizing] = useState(() =>
        sanitizeMyAvatarsColumnSizing(persistedState.columnSizing)
    );
    const [columnOrderLocked, setColumnOrderLocked] = useState(
        () => persistedState.columnOrderLocked === true
    );
    const [pagination, setPagination] = useState(() => ({
        pageIndex: 0,
        pageSize: resolveMyAvatarsPageSize(
            persistedState.pageSize,
            MY_AVATARS_DEFAULT_PAGE_SIZES,
            MY_AVATARS_DEFAULT_PAGE_SIZES[1]
        )
    }));
    const tableColumnOrder = useMemo(
        () => resolveTableColumnOrder(columnOrder),
        [columnOrder]
    );

    useEffect(() => {
        let active = true;
        Promise.all([
            getTablePageSizesPreference(MY_AVATARS_DEFAULT_PAGE_SIZES),
            getTablePageSizePreference(20)
        ])
            .then(([nextPageSizes, nextPageSize]: any) => {
                if (!active) {
                    return;
                }
                const resolvedPageSizes =
                    sanitizeMyAvatarsPageSizes(nextPageSizes);
                const parsedPersistedPageSize = Number.parseInt(
                    String(persistedState.pageSize ?? ''),
                    10
                );
                const hasPersistedPageSize =
                    Number.isFinite(parsedPersistedPageSize) &&
                    parsedPersistedPageSize > 0;
                const resolvedConfiguredPageSize = resolveMyAvatarsPageSize(
                    nextPageSize,
                    resolvedPageSizes,
                    MY_AVATARS_DEFAULT_PAGE_SIZES[1]
                );
                const resolvedActivePageSize = hasPersistedPageSize
                    ? resolveMyAvatarsPageSize(
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
        const resolvedPageSizes = sanitizeMyAvatarsPageSizes(
            tablePageSizesPreference
        );
        setPageSizes(resolvedPageSizes);
        setPagination((current: any) => {
            const pageSize = resolveMyAvatarsPageSize(
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
        writePersistedMyAvatarsState({
            sorting: sanitizeMyAvatarsSorting(sorting)
        });
    }, [sorting]);

    useEffect(() => {
        if (!hasWrittenPageSizeRef.current) {
            hasWrittenPageSizeRef.current = true;
            return;
        }
        writePersistedMyAvatarsState({
            pageSize: pagination.pageSize
        });
    }, [pagination.pageSize]);

    useEffect(() => {
        if (!hasWrittenTableStateRef.current) {
            hasWrittenTableStateRef.current = true;
            return;
        }
        writePersistedMyAvatarsState({
            columnVisibility:
                sanitizeMyAvatarsColumnVisibility(columnVisibility),
            columnOrder: sanitizeMyAvatarsColumnOrder(columnOrder),
            columnSizing: sanitizeMyAvatarsColumnSizing(columnSizing),
            columnOrderLocked
        });
    }, [columnOrder, columnOrderLocked, columnSizing, columnVisibility]);

    useEffect(() => {
        setPagination((current: any) => ({
            ...current,
            pageIndex: 0
        }));
    }, [
        deferredSearchQuery,
        platformFilter,
        releaseStatusFilter,
        tagFilters,
        viewMode
    ]);

    useEffect(() => {
        const maxPageIndex = Math.max(
            0,
            Math.ceil(filteredCount / pagination.pageSize) - 1
        );
        if (pagination.pageIndex > maxPageIndex) {
            setPagination((current: any) => ({
                ...current,
                pageIndex: maxPageIndex
            }));
        }
    }, [filteredCount, pagination.pageIndex, pagination.pageSize]);

    function handleColumnOrderChange(updater: any) {
        setColumnOrder((current: any) =>
            resolveTableColumnOrder(
                typeof updater === 'function'
                    ? updater(resolveTableColumnOrder(current))
                    : updater
            )
        );
    }

    function handlePageSizeChange(value: any) {
        const nextPageSize = resolveMyAvatarsPageSize(
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
        columnOrder: tableColumnOrder,
        columnOrderLocked,
        columnSizing,
        columnVisibility,
        handleColumnOrderChange,
        handlePageSizeChange,
        initialColumnVisibility: MY_AVATARS_DEFAULT_COLUMN_VISIBILITY,
        pageSizes,
        pagination,
        setColumnOrderLocked,
        setColumnSizing,
        setColumnVisibility,
        setPagination,
        setSorting,
        sorting
    };
}
