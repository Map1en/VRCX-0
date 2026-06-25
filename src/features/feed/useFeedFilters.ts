import {
    useCallback,
    useDeferredValue,
    useEffect,
    useMemo,
    useState
} from 'react';

import { useTodayDate } from '@/lib/useTodayDate';
import {
    FEED_FILTER_TYPES,
    type FeedFilterType
} from '@/repositories/feedRepository';

import { parseDateInput, toDateInputValue } from './feedRows';
import type { FeedDateRange } from './feedTypes';

function normalizeFeedFilters(filters: readonly unknown[]): FeedFilterType[] {
    const nextFilters = (Array.isArray(filters) ? filters : []).filter(
        (filter): filter is FeedFilterType =>
            typeof filter === 'string' &&
            FEED_FILTER_TYPES.includes(filter as FeedFilterType)
    );
    return [...new Set(nextFilters)];
}

export function useFeedFilters() {
    const [searchDraft, setSearchDraft] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    const [dateDraftFrom, setDateDraftFrom] = useState('');
    const [dateDraftTo, setDateDraftTo] = useState('');
    const [dateFilterOpen, setDateFilterOpen] = useState(false);
    const [activeFilters, setActiveFilters] = useState<FeedFilterType[]>([]);
    const [favoritesOnly, setFavoritesOnly] = useState(false);
    const deferredSearchQuery = useDeferredValue(searchQuery);
    const todayDate = useTodayDate();

    const setFeedFilters = useCallback((nextFilters: readonly unknown[]) => {
        const nextUniqueFilters = normalizeFeedFilters(nextFilters);
        setActiveFilters(
            nextUniqueFilters.length === FEED_FILTER_TYPES.length
                ? []
                : nextUniqueFilters
        );
    }, []);

    const toggleFeedFilter = useCallback((filter: FeedFilterType) => {
        setActiveFilters((current) => {
            const nextFilters = current.includes(filter)
                ? current.filter((entry) => entry !== filter)
                : [...current, filter];
            return nextFilters.length === FEED_FILTER_TYPES.length
                ? []
                : nextFilters;
        });
    }, []);

    const commitSearch = useCallback(
        (nextValue: string = searchDraft) => {
            setSearchQuery(nextValue);
        },
        [searchDraft]
    );

    const clearSearch = useCallback(() => {
        setSearchDraft('');
        setSearchQuery('');
    }, []);

    const applyDateFilter = useCallback(() => {
        if (dateDraftFrom && dateDraftTo && dateDraftFrom > dateDraftTo) {
            setDateFrom(dateDraftTo);
            setDateTo(dateDraftFrom);
        } else {
            setDateFrom(dateDraftFrom);
            setDateTo(dateDraftTo);
        }
        setDateFilterOpen(false);
    }, [dateDraftFrom, dateDraftTo]);

    const clearDateFilter = useCallback(() => {
        setDateDraftFrom('');
        setDateDraftTo('');
        setDateFrom('');
        setDateTo('');
        setDateFilterOpen(false);
    }, []);

    const dateDraftRange = useMemo(() => {
        const from = parseDateInput(dateDraftFrom);
        const to = parseDateInput(dateDraftTo);
        return from || to ? { from, to } : undefined;
    }, [dateDraftFrom, dateDraftTo]);

    useEffect(() => {
        if (!dateFilterOpen) {
            return;
        }
        setDateDraftFrom(dateFrom);
        setDateDraftTo(dateTo);
    }, [dateFilterOpen, dateFrom, dateTo]);

    const onDateRangeSelect = useCallback((range?: FeedDateRange) => {
        setDateDraftFrom(toDateInputValue(range?.from));
        setDateDraftTo(toDateInputValue(range?.to));
    }, []);

    return {
        activeFilterCount: dateFrom || dateTo ? 1 : 0,
        activeFilters,
        dateDraftFrom,
        dateDraftRange,
        dateDraftTo,
        dateFilterOpen,
        dateFrom,
        dateTo,
        deferredSearchQuery,
        favoritesOnly,
        feedFilterTypes: FEED_FILTER_TYPES,
        searchDraft,
        todayDate,
        applyDateFilter,
        clearDateFilter,
        clearSearch,
        commitSearch,
        onDateRangeSelect,
        setDateFilterOpen,
        setFavoritesOnly,
        setFeedFilters,
        setSearchDraft,
        toggleFeedFilter
    };
}
