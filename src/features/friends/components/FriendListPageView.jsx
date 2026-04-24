export function FriendListPageView({
    PageScaffold,
    embedded,
    FriendListToolbar,
    t,
    favoritesOnly,
    isFavoritesLoaded,
    activeSearchFilterIds,
    searchQuery,
    bulkUnfriendMode,
    selectedFriendIds,
    isBulkDeleting,
    isMutualOptOut,
    isMutualFetching,
    currentUserId,
    isLoadingUserDetails,
    table,
    toolbarDetail,
    setFavoritesOnly,
    setActiveSearchFilterIds,
    setSearchQuery,
    bulkUnfriendSelected,
    setBulkUnfriendMode,
    loadMutualFriends,
    loadFriendUserDetails,
    resetFriendListTableLayout,
    FriendListTable,
    pageCount,
    pageSizes,
    pagination,
    filteredRows,
    friendDetail,
    isLoading,
    isError,
    hasRows,
    resolvePageSize,
    setPagination,
    openFriendDetails,
    FriendListUserLoadDialog,
    userLoadProgress,
    userLoadPercent,
    cancelFriendUserDetailsLoad
}) {
    return (
        <PageScaffold embedded={embedded}>
            <FriendListToolbar
                t={t}
                favoritesOnly={favoritesOnly}
                isFavoritesLoaded={isFavoritesLoaded}
                activeSearchFilterIds={activeSearchFilterIds}
                searchQuery={searchQuery}
                bulkUnfriendMode={bulkUnfriendMode}
                selectedFriendCount={selectedFriendIds.size}
                isBulkDeleting={isBulkDeleting}
                isMutualOptOut={isMutualOptOut}
                isMutualFetching={isMutualFetching}
                currentUserId={currentUserId}
                isLoadingUserDetails={isLoadingUserDetails}
                table={table}
                statusDetail={toolbarDetail}
                onToggleFavoritesOnly={() =>
                    setFavoritesOnly((current) => !current)
                }
                onSearchFilterChange={setActiveSearchFilterIds}
                onSearchChange={setSearchQuery}
                onBulkUnfriend={() => void bulkUnfriendSelected()}
                onBulkUnfriendModeChange={setBulkUnfriendMode}
                onLoadMutualFriends={() => void loadMutualFriends()}
                onLoadFriendUserDetails={() => void loadFriendUserDetails()}
                onResetTableLayout={resetFriendListTableLayout}
            />

            <FriendListTable
                t={t}
                table={table}
                pageCount={pageCount}
                pageSizes={pageSizes}
                pagination={pagination}
                filteredRowsLength={filteredRows.length}
                friendDetail={friendDetail}
                favoritesOnly={favoritesOnly}
                isLoading={isLoading}
                isError={isError}
                hasRows={hasRows}
                onResetTableLayout={resetFriendListTableLayout}
                onPageSizeChange={(value) => {
                    const nextPageSize = resolvePageSize(
                        value,
                        pageSizes,
                        pagination.pageSize
                    );
                    setPagination({
                        pageIndex: 0,
                        pageSize: nextPageSize
                    });
                }}
                onOpenUser={openFriendDetails}
            />

            <FriendListUserLoadDialog
                t={t}
                open={userLoadProgress.open}
                progress={userLoadProgress}
                percent={userLoadPercent}
                onCancel={cancelFriendUserDetailsLoad}
            />
        </PageScaffold>
    );
}
