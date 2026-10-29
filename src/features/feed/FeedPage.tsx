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
import { FeedFirstRunTip } from './components/FeedFirstRunTip';
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
            {embedded ? null : <FeedFirstRunTip />}
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
        newSinceLeftCount,
        normalQueryKey,
        previousInstancesDialog,
        resolvePageSize,
        rows,
        reloadLatest,
        rowFilterCommands,
        searchMode,
        setViewingLatest,
        table,
        tableModel
    } = useFeedPageController({ routeScopedUserIds, setRouteScopedUserIds });
    const {
        activeFilters,
        clearSearch,
        commitSearch,
        dateFrom,
        dateTo,
        favoritesOnly,
        feedFilterTypes,
        scopedUserIds,
        searchDraft,
        setFavoritesOnly,
        setFeedFilters,
        setSearchDraft,
        setDateRange,
        setUserScope,
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
            dateFrom,
            dateTo,
            favoritesOnly,
            feedFilterTypes,
            scopedUserIds,
            searchDraft
        }),
        [
            activeFilters,
            dateFrom,
            dateTo,
            favoritesOnly,
            feedFilterTypes,
            scopedUserIds,
            searchDraft
        ]
    );
    const filterCommands = useMemo(
        () => ({
            onDateRangeChange: setDateRange,
            onClearFeedFilters: () => setFeedFilters([]),
            onClearSearch: clearSearch,
            onCommitSearch: () => commitSearch(),
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
            clearSearch,
            commitSearch,
            setFavoritesOnly,
            setFeedFilters,
            setDateRange,
            setRouteScopedUserIds,
            setSearchDraft,
            setUserScope,
            toggleFeedFilter
        ]
    );

    const emptyFilterModel = useMemo(
        () => ({
            hasActiveFilters: Boolean(
                filters.deferredSearchQuery.trim() ||
                scopedUserIds.length ||
                dateFrom ||
                dateTo ||
                activeFilters.length ||
                favoritesOnly
            ),
            onClearFilters: () => {
                setFeedFilters([]);
                clearSearch();
                setDateRange('', '');
                setFavoritesOnly(false);
                setUserScope([]);
                setRouteScopedUserIds([]);
            }
        }),
        [
            activeFilters.length,
            clearSearch,
            dateFrom,
            dateTo,
            favoritesOnly,
            filters.deferredSearchQuery,
            scopedUserIds.length,
            setDateRange,
            setFavoritesOnly,
            setFeedFilters,
            setRouteScopedUserIds,
            setUserScope
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
                        emptyFilterModel={emptyFilterModel}
                        filterCommands={rowFilterCommands}
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
                        emptyFilterModel={emptyFilterModel}
                        filterCommands={rowFilterCommands}
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
                        newCount={newSinceLeftCount}
                        onLoadOlder={loadOlder}
                        onReloadLatest={reloadLatest}
                        onOpenPreviousInstances={
                            previousInstancesDialog.openPreviousInstancesForLocation
                        }
                        resetKey={normalQueryKey}
                        rows={listRows}
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
