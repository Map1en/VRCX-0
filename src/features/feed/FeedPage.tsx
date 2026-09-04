import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';

import { PreviousInstancesTableDialog } from '@/components/dialogs/PreviousInstancesTableDialog';
import { PageBody, PageScaffold } from '@/components/layout/PageScaffold';
import {
    readFeedRouteUserIds,
    withFeedRouteUserIds
} from '@/shared/utils/feedRouteScope';
import { Spinner } from '@/ui/shadcn/spinner';

import { FeedColumnsMode } from './columns/FeedColumnsMode';
import { FeedTableShell } from './components/FeedTableShell';
import { FeedToolbar } from './components/FeedToolbar';
import { FeedVirtualListShell } from './components/FeedVirtualListShell';
import type { FeedViewMode } from './feedColumnsState';
import { useFeedPageController } from './useFeedPageController';
import { useFeedViewModeState } from './useFeedViewModeState';

type FeedPageProps = {
    embedded?: boolean;
};

export function FeedPage({ embedded = false }: FeedPageProps = {}) {
    const [searchParams, setSearchParams] = useSearchParams();
    const routeScopedUserIds = useMemo(
        () => (embedded ? [] : readFeedRouteUserIds(searchParams)),
        [embedded, searchParams]
    );
    const {
        columns,
        density,
        ready,
        setColumns,
        setDensity,
        setViewMode,
        viewMode
    } = useFeedViewModeState();
    const effectiveViewMode =
        !embedded && searchParams.get('feedView') === 'table'
            ? 'table'
            : viewMode;
    const setEffectiveViewMode = useCallback(
        (value: FeedViewMode) => {
            if (!embedded && searchParams.has('feedView')) {
                const nextSearchParams = new URLSearchParams(searchParams);
                nextSearchParams.delete('feedView');
                setSearchParams(nextSearchParams, { replace: true });
            }
            setViewMode(value);
        },
        [embedded, searchParams, setSearchParams, setViewMode]
    );
    const setRouteScopedUserIds = useCallback(
        (userIds: readonly string[]) => {
            if (embedded) {
                return;
            }
            setSearchParams(withFeedRouteUserIds(searchParams, userIds), {
                replace: true
            });
        },
        [embedded, searchParams, setSearchParams]
    );

    if (!ready) {
        return (
            <PageScaffold
                embedded={embedded}
                className={embedded ? '' : 'feed'}
            >
                <PageBody className="items-center justify-center">
                    <Spinner />
                </PageBody>
            </PageScaffold>
        );
    }

    return (
        <PageScaffold embedded={embedded} className={embedded ? '' : 'feed'}>
            {effectiveViewMode === 'columns' ? (
                <PageBody className="gap-2">
                    <FeedColumnsMode
                        columns={columns}
                        density={density}
                        onViewModeChange={setEffectiveViewMode}
                        onColumnsChange={setColumns}
                        onDensityChange={setDensity}
                    />
                </PageBody>
            ) : (
                <FeedTableMode
                    onViewModeChange={setEffectiveViewMode}
                    routeScopedUserIds={routeScopedUserIds}
                    setRouteScopedUserIds={setRouteScopedUserIds}
                />
            )}
        </PageScaffold>
    );
}

function FeedTableMode({
    onViewModeChange,
    routeScopedUserIds,
    setRouteScopedUserIds
}: {
    onViewModeChange(value: FeedViewMode): void;
    routeScopedUserIds: readonly string[];
    setRouteScopedUserIds(userIds: readonly string[]): void;
}) {
    const {
        filters,
        friendLogNamesById,
        friendActions,
        hasMore,
        hasUnloadedLatest,
        isFavoritesLoaded,
        listRows,
        loadOlder,
        loadStatus,
        loadingOlder,
        normalQueryKey,
        previousInstancesDialog,
        resolvePageSize,
        rows,
        reloadLatest,
        searchMode,
        setViewingLatest,
        table,
        tableModel
    } = useFeedPageController({ routeScopedUserIds });
    const {
        activeFilters,
        applyDateFilter,
        clearDateFilter,
        clearSearch,
        commitSearch,
        dateDraftFrom,
        dateDraftRange,
        dateDraftTo,
        dateFilterOpen,
        dateFrom,
        dateTo,
        favoritesOnly,
        feedFilterTypes,
        onDateRangeSelect,
        scopedUserIds,
        searchDraft,
        setDateFilterOpen,
        setFavoritesOnly,
        setFeedFilters,
        setSearchDraft,
        setUserScope,
        todayDate,
        toggleFeedFilter
    } = filters;
    const isSearching =
        loadStatus === 'running' &&
        Boolean(
            filters.deferredSearchQuery.trim() ||
            filters.deferredScopedUserIds.length
        );
    const filterModel = useMemo(
        () => ({
            activeFilters,
            dateDraftFrom,
            dateDraftRange,
            dateDraftTo,
            dateFilterOpen,
            dateFrom,
            dateTo,
            favoritesOnly,
            feedFilterTypes,
            scopedUserIds,
            searchDraft,
            todayDate
        }),
        [
            activeFilters,
            dateDraftFrom,
            dateDraftRange,
            dateDraftTo,
            dateFilterOpen,
            dateFrom,
            dateTo,
            favoritesOnly,
            feedFilterTypes,
            scopedUserIds,
            searchDraft,
            todayDate
        ]
    );
    const filterCommands = useMemo(
        () => ({
            onApplyDateFilter: applyDateFilter,
            onClearDateFilter: clearDateFilter,
            onClearFeedFilters: () => setFeedFilters([]),
            onClearSearch: clearSearch,
            onCommitSearch: () => commitSearch(),
            onDateFilterOpenChange: setDateFilterOpen,
            onDateRangeSelect,
            onScopeChange: (userIds: readonly string[]) => {
                setUserScope(userIds);
                setRouteScopedUserIds(userIds);
            },
            onSearchDraftChange: setSearchDraft,
            onFeedFiltersChange: setFeedFilters,
            onToggleFavoritesOnly: () =>
                setFavoritesOnly((current) => !current),
            onToggleFeedFilter: toggleFeedFilter
        }),
        [
            applyDateFilter,
            clearDateFilter,
            clearSearch,
            commitSearch,
            onDateRangeSelect,
            setDateFilterOpen,
            setFavoritesOnly,
            setFeedFilters,
            setRouteScopedUserIds,
            setSearchDraft,
            setUserScope,
            toggleFeedFilter
        ]
    );

    return (
        <>
            <FeedToolbar
                onViewModeChange={onViewModeChange}
                filterModel={filterModel}
                filterCommands={filterCommands}
                isSearching={isSearching}
            />
            <PageBody>
                {searchMode ? (
                    <FeedTableShell
                        favoritesOnly={filters.favoritesOnly}
                        isFavoritesLoaded={isFavoritesLoaded}
                        loadStatus={loadStatus}
                        loadingPreviousInstancesKey={
                            previousInstancesDialog.loadingKey
                        }
                        onNewInstance={friendActions.openFeedNewInstance}
                        onOpenPreviousInstances={
                            previousInstancesDialog.openPreviousInstancesForLocation
                        }
                        onPaginationChange={tableModel.setPagination}
                        pageSizes={tableModel.pageSizes}
                        pagination={tableModel.pagination}
                        resolvePageSize={resolvePageSize}
                        rows={rows}
                        table={table}
                    />
                ) : (
                    <FeedVirtualListShell
                        actions={friendActions}
                        favoritesOnly={filters.favoritesOnly}
                        friendLogNamesById={friendLogNamesById}
                        hasMore={hasMore}
                        hasUnloadedLatest={hasUnloadedLatest}
                        isFavoritesLoaded={isFavoritesLoaded}
                        loadStatus={loadStatus}
                        loadingOlder={loadingOlder}
                        loadingPreviousInstancesKey={
                            previousInstancesDialog.loadingKey
                        }
                        onLoadOlder={loadOlder}
                        onReloadLatest={reloadLatest}
                        onOpenPreviousInstances={
                            previousInstancesDialog.openPreviousInstancesForLocation
                        }
                        resetKey={normalQueryKey}
                        rows={listRows}
                        sorting={tableModel.sorting}
                        sourceRows={rows}
                        table={table}
                        onViewingLatestChange={setViewingLatest}
                    />
                )}
            </PageBody>
            <PreviousInstancesTableDialog
                open={previousInstancesDialog.open}
                onOpenChange={previousInstancesDialog.setOpen}
                title={previousInstancesDialog.title}
                instances={previousInstancesDialog.rows}
                onRowsChange={previousInstancesDialog.setRows}
            />
        </>
    );
}
