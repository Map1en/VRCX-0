import type { PaginationState } from '@tanstack/react-table';
import { useCallback, useEffect, useRef, useState } from 'react';

import { usePersistedTableColumnSizing } from '@/components/data-table/dataTablePersistence';
import {
    GAME_LOG_SESSION_LIMIT_MAX,
    GAME_LOG_SESSION_PAGE_SIZE
} from '@/components/game-log/gameLogTypes';
import type { GameLogViewMode } from '@/components/game-log/gameLogTypes';
import {
    getTablePageSizePreference,
    getTablePageSizesPreference
} from '@/services/preferencesService';
import { usePreferencesStore } from '@/state/preferencesStore';

import {
    GAME_LOG_COLUMN_IDS,
    GAME_LOG_DEFAULT_PAGE_SIZES,
    readPersistedGameLogState,
    resolveGameLogPageSize,
    sanitizeGameLogColumnOrder,
    sanitizeGameLogColumnVisibility,
    sanitizeGameLogPageSizes,
    sanitizeGameLogSorting,
    writePersistedGameLogState
} from './gameLogState';

type UseGameLogTableStateOptions = {
    deferredSearchQuery: string;
    sessionDateFrom: string;
    sessionDateTo: string;
    sessionFavoritesOnly: boolean;
    sessionSelectedTypes: readonly string[];
    tableFavoritesOnly: boolean;
    tableSelectedTypes: readonly string[];
    viewMode: GameLogViewMode;
};

export function useGameLogTableState({
    deferredSearchQuery,
    sessionDateFrom,
    sessionDateTo,
    sessionFavoritesOnly,
    sessionSelectedTypes,
    tableFavoritesOnly,
    tableSelectedTypes,
    viewMode
}: UseGameLogTableStateOptions) {
    const preferencesHydrated = usePreferencesStore(
        (state) => state.preferencesHydrated
    );
    const tablePageSizesPreference = usePreferencesStore(
        (state) => state.tablePageSizes
    );
    const [persistedState] = useState(() => readPersistedGameLogState());
    const hasWrittenSortingRef = useRef(false);
    const hasWrittenPageSizeRef = useRef(false);
    const hasWrittenTableStateRef = useRef(false);
    const [preferencesReady, setPreferencesReady] = useState(false);
    const [pageSizes, setPageSizes] = useState(GAME_LOG_DEFAULT_PAGE_SIZES);
    const [sessionLimit, setSessionLimit] = useState(
        GAME_LOG_SESSION_PAGE_SIZE
    );
    const [sorting, setSorting] = useState(() =>
        sanitizeGameLogSorting(persistedState.sorting)
    );
    const [columnVisibility, setColumnVisibility] = useState(() =>
        sanitizeGameLogColumnVisibility(persistedState.columnVisibility)
    );
    const [columnOrder, setColumnOrder] = useState(() =>
        sanitizeGameLogColumnOrder(persistedState.columnOrder)
    );
    const [columnSizing, setColumnSizing] = usePersistedTableColumnSizing({
        columnIds: GAME_LOG_COLUMN_IDS,
        initialValue: persistedState.columnSizing,
        writePersistedState: writePersistedGameLogState
    });
    const [columnOrderLocked, setColumnOrderLocked] = useState(
        () => persistedState.columnOrderLocked === true
    );
    const [pagination, setPagination] = useState<PaginationState>(() => ({
        pageIndex: 0,
        pageSize: resolveGameLogPageSize(
            persistedState.pageSize,
            GAME_LOG_DEFAULT_PAGE_SIZES,
            GAME_LOG_DEFAULT_PAGE_SIZES[1]
        )
    }));

    useEffect(() => {
        let active = true;
        Promise.all([
            getTablePageSizesPreference(GAME_LOG_DEFAULT_PAGE_SIZES),
            getTablePageSizePreference(20)
        ])
            .then(([nextPageSizes, nextPageSize]) => {
                if (!active) {
                    return;
                }
                const resolvedPageSizes =
                    sanitizeGameLogPageSizes(nextPageSizes);
                const parsedPersistedPageSize = Number.parseInt(
                    String(persistedState.pageSize),
                    10
                );
                const hasPersistedPageSize =
                    Number.isFinite(parsedPersistedPageSize) &&
                    parsedPersistedPageSize > 0;
                const resolvedConfiguredPageSize = resolveGameLogPageSize(
                    nextPageSize,
                    resolvedPageSizes,
                    GAME_LOG_DEFAULT_PAGE_SIZES[1]
                );
                const resolvedActivePageSize = hasPersistedPageSize
                    ? resolveGameLogPageSize(
                          parsedPersistedPageSize,
                          resolvedPageSizes,
                          resolvedConfiguredPageSize
                      )
                    : resolvedConfiguredPageSize;
                setPageSizes(resolvedPageSizes);
                setPagination((current) => ({
                    ...current,
                    pageSize: resolvedActivePageSize
                }));
                setPreferencesReady(true);
            })
            .catch(() => {
                if (active) {
                    setPreferencesReady(true);
                }
            });
        return () => {
            active = false;
        };
    }, [persistedState.pageSize]);

    useEffect(() => {
        if (!preferencesHydrated) {
            return;
        }
        const resolvedPageSizes = sanitizeGameLogPageSizes(
            tablePageSizesPreference
        );
        setPageSizes(resolvedPageSizes);
        setPagination((current) => {
            const pageSize = resolveGameLogPageSize(
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
        writePersistedGameLogState({
            sorting: sanitizeGameLogSorting(sorting)
        });
    }, [sorting]);

    useEffect(() => {
        if (!hasWrittenPageSizeRef.current) {
            hasWrittenPageSizeRef.current = true;
            return;
        }
        writePersistedGameLogState({
            pageSize: pagination.pageSize
        });
    }, [pagination.pageSize]);

    useEffect(() => {
        if (!hasWrittenTableStateRef.current) {
            hasWrittenTableStateRef.current = true;
            return;
        }
        writePersistedGameLogState({
            columnVisibility: sanitizeGameLogColumnVisibility(columnVisibility),
            columnOrder: sanitizeGameLogColumnOrder(columnOrder),
            columnOrderLocked
        });
    }, [columnOrder, columnOrderLocked, columnVisibility]);

    useEffect(() => {
        setPagination((current) => ({
            ...current,
            pageIndex: 0
        }));
        setSessionLimit(GAME_LOG_SESSION_PAGE_SIZE);
    }, [
        deferredSearchQuery,
        pagination.pageSize,
        sessionDateFrom,
        sessionDateTo,
        sessionFavoritesOnly,
        sessionSelectedTypes,
        tableFavoritesOnly,
        tableSelectedTypes,
        viewMode
    ]);

    const setPageSize = useCallback(
        (value: unknown) => {
            const nextPageSize = resolveGameLogPageSize(
                value,
                pageSizes,
                pagination.pageSize
            );
            setPagination({
                pageIndex: 0,
                pageSize: nextPageSize
            });
        },
        [pageSizes, pagination.pageSize]
    );

    const loadMoreSessions = useCallback(() => {
        setSessionLimit((current) =>
            Math.min(
                current + GAME_LOG_SESSION_PAGE_SIZE,
                GAME_LOG_SESSION_LIMIT_MAX
            )
        );
    }, []);

    return {
        columnOrder,
        columnOrderLocked,
        columnSizing,
        columnVisibility,
        pageSizes,
        pagination,
        preferencesReady,
        sessionLimit,
        loadMoreSessions,
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
