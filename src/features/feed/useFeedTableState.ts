import type { PaginationState } from '@tanstack/react-table';
import type { Dispatch, SetStateAction } from 'react';
import { useEffect, useRef, useState } from 'react';

import { usePersistedTableColumnSizing } from '@/components/data-table/dataTablePersistence';
import type { FeedFilterType } from '@/components/feed/feedTypes';
import configRepository from '@/repositories/configRepository';
import { isFeedFilterType } from '@/repositories/feedRepository';
import {
    getTablePageSizePreference,
    getTablePageSizesPreference
} from '@/services/preferencesService';
import { usePreferencesStore } from '@/state/preferencesStore';

import {
    FEED_RESIZABLE_COLUMN_IDS,
    FEED_TABLE_DEFAULT_PAGE_SIZES as DEFAULT_PAGE_SIZES,
    readPersistedFeedTableState as readPersistedState,
    resolveFeedPageSize as resolvePageSize,
    safeJsonParse,
    sanitizeFeedPageSizes as sanitizePageSizes,
    sanitizeFeedSorting as sanitizeSorting,
    writePersistedFeedTableState as writePersistedState
} from './feedTableState';

type UseFeedTableStateOptions = {
    activeFilters: FeedFilterType[];
    dateFrom: string;
    dateTo: string;
    deferredSearchQuery: string;
    favoritesOnly: boolean;
    scopedUserIds: readonly string[];
    setFavoritesOnly: Dispatch<SetStateAction<boolean>>;
    setFeedFilters(filters: FeedFilterType[]): void;
};

export function useFeedTableState({
    activeFilters,
    dateFrom,
    dateTo,
    deferredSearchQuery,
    favoritesOnly,
    scopedUserIds,
    setFavoritesOnly,
    setFeedFilters
}: UseFeedTableStateOptions) {
    const preferencesHydrated = usePreferencesStore(
        (state) => state.preferencesHydrated
    );
    const tablePageSizesPreference = usePreferencesStore(
        (state) => state.tablePageSizes
    );
    const [persistedState] = useState(() => readPersistedState());
    const persistedPageSize = Number.parseInt(
        String(persistedState.pageSize),
        10
    );
    const hasWrittenSortingRef = useRef(false);
    const hasWrittenPageSizeRef = useRef(false);
    const [preferencesReady, setPreferencesReady] = useState(false);
    const [expanded, setExpanded] = useState({});
    const [pageSizes, setPageSizes] = useState(DEFAULT_PAGE_SIZES);
    const [sorting, setSorting] = useState(() =>
        sanitizeSorting(persistedState.sorting)
    );
    const [columnSizing, setColumnSizing] = usePersistedTableColumnSizing({
        columnIds: FEED_RESIZABLE_COLUMN_IDS,
        initialValue: persistedState.columnSizing,
        writePersistedState
    });
    const [pagination, setPagination] = useState<PaginationState>({
        pageIndex: 0,
        pageSize: resolvePageSize(persistedPageSize, DEFAULT_PAGE_SIZES)
    });

    useEffect(() => {
        let active = true;
        Promise.all([
            configRepository.getString('feedTableFilters', '[]'),
            configRepository.getBool('VRCX_feedTableVIPFilter', false),
            getTablePageSizesPreference(DEFAULT_PAGE_SIZES),
            getTablePageSizePreference(20)
        ])
            .then(([savedFilters, savedVip, savedPageSizes, savedPageSize]) => {
                if (!active) {
                    return;
                }
                const parsedFilters = safeJsonParse(savedFilters);
                const nextPageSizes = sanitizePageSizes(savedPageSizes);
                const resolvedSavedPageSize = resolvePageSize(
                    savedPageSize,
                    nextPageSizes
                );
                const resolvedActivePageSize = Number.isFinite(
                    persistedPageSize
                )
                    ? resolvePageSize(
                          persistedPageSize,
                          nextPageSizes,
                          resolvedSavedPageSize
                      )
                    : resolvedSavedPageSize;

                setFeedFilters(
                    Array.isArray(parsedFilters)
                        ? parsedFilters.filter(isFeedFilterType)
                        : []
                );
                setFavoritesOnly(savedVip);
                setPageSizes(nextPageSizes);
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
    }, [persistedPageSize, setFavoritesOnly, setFeedFilters]);

    useEffect(() => {
        if (!preferencesHydrated) {
            return;
        }
        const nextPageSizes = sanitizePageSizes(tablePageSizesPreference);
        setPageSizes(nextPageSizes);
        setPagination((current) => {
            const pageSize = resolvePageSize(current.pageSize, nextPageSizes);
            return pageSize === current.pageSize
                ? current
                : {
                      ...current,
                      pageSize
                  };
        });
    }, [preferencesHydrated, tablePageSizesPreference]);

    useEffect(() => {
        if (!preferencesReady) {
            return;
        }
        configRepository.setString(
            'VRCX_feedTableFilters',
            JSON.stringify(activeFilters)
        );
    }, [activeFilters, preferencesReady]);

    useEffect(() => {
        if (!preferencesReady) {
            return;
        }
        configRepository.setBool('VRCX_feedTableVIPFilter', favoritesOnly);
    }, [favoritesOnly, preferencesReady]);

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
        setPagination((current) => ({
            ...current,
            pageIndex: 0
        }));
    }, [
        activeFilters,
        dateFrom,
        dateTo,
        deferredSearchQuery,
        favoritesOnly,
        scopedUserIds
    ]);

    return {
        columnSizing,
        expanded,
        pageSizes,
        pagination,
        preferencesReady,
        setColumnSizing,
        setExpanded,
        setPagination,
        setSorting,
        sorting
    };
}
