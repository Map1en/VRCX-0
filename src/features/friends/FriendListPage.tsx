import { PageScaffold } from '@/components/layout/PageScaffold';

import { FriendListTable } from './components/FriendListTable';
import { FriendListToolbar } from './components/FriendListToolbar';
import { useFriendListPageController } from './useFriendListPageController';

export function FriendListPage({
    embedded = false
}: { embedded?: boolean } = {}) {
    const {
        actions,
        filters,
        isError,
        isLoading,
        isMutualOptOut,
        mutualProgress,
        pageCount,
        rows,
        selection,
        table,
        tableState
    } = useFriendListPageController();

    return (
        <PageScaffold embedded={embedded}>
            <FriendListToolbar
                bulkModel={{
                    bulkUnfriendMode: selection.bulkUnfriendMode,
                    isBulkDeleting: selection.isBulkDeleting,
                    selectedFriendCount: selection.selectedFriendIds.size
                }}
                filterModel={{
                    activeSearchFilterIds: filters.activeSearchFilterIds,
                    favoritesOnly: filters.favoritesOnly,
                    isFavoritesLoaded: filters.isFavoritesLoaded,
                    searchQuery: filters.searchQuery
                }}
                loadModel={{
                    currentUserId: rows.currentUserId,
                    isLoadingUserDetails: actions.isLoadingUserDetails,
                    isMutualFetching: actions.isMutualFetching,
                    isMutualOptOut,
                    mutualProgress,
                    statusDetail: rows.friendDetail
                }}
                table={table}
                toolbarCommands={{
                    onBulkUnfriend: () => {
                        actions.bulkUnfriendSelected();
                    },
                    onBulkUnfriendModeChange: selection.setBulkUnfriendMode,
                    onLoadFriendUserDetails: () => {
                        actions.loadFriendUserDetails();
                    },
                    onLoadMutualFriends: () => {
                        actions.loadMutualFriends();
                    },
                    onResetTableLayout: actions.resetFriendListTableLayout,
                    onSearchChange: filters.setSearchQuery,
                    onSearchFilterChange: filters.setActiveSearchFilterIds,
                    onToggleFavoritesOnly: () =>
                        filters.setFavoritesOnly((current: boolean) => !current)
                }}
            />

            <FriendListTable
                table={table}
                pageCount={pageCount}
                pageSizes={tableState.pageSizes}
                pagination={tableState.pagination}
                filteredRowsLength={rows.filteredRows.length}
                friendDetail={rows.friendDetail}
                favoritesOnly={filters.favoritesOnly}
                isLoading={isLoading}
                isError={isError}
                hasRows={rows.filteredRows.length > 0}
                onResetTableLayout={actions.resetFriendListTableLayout}
                onPageSizeChange={tableState.setPageSize}
                onOpenUser={actions.openFriendDetails}
            />
        </PageScaffold>
    );
}
