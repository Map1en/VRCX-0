export function ModerationPageView({
    PageScaffold,
    embedded,
    PageToolbar,
    ModerationPageToolbar,
    selectedTypes,
    setSelectedTypes,
    getModerationTypeLabel,
    normalizeSelectedTypes,
    searchQuery,
    setSearchQuery,
    userFacingErrorMessage,
    detail,
    currentUserId,
    loadStatus,
    setRefreshToken,
    table,
    t,
    PageBody,
    isLoading,
    LoadingState,
    isError,
    ModerationEmptyState,
    hasRows,
    ModerationPageTable,
    filteredRows,
    pagination,
    pageSizes,
    resolvePageSize,
    setPagination
}) {
    return (
        <PageScaffold embedded={embedded}>
            <PageToolbar>
                <ModerationPageToolbar
                    selectedTypes={selectedTypes}
                    onSelectedTypesChange={setSelectedTypes}
                    getModerationTypeLabel={getModerationTypeLabel}
                    normalizeSelectedTypes={normalizeSelectedTypes}
                    searchQuery={searchQuery}
                    onSearchQueryChange={setSearchQuery}
                    detail={userFacingErrorMessage(
                        detail,
                        'Failed to load the moderation snapshot.'
                    )}
                    currentUserId={currentUserId}
                    loadStatus={loadStatus}
                    onRefresh={() => setRefreshToken((value) => value + 1)}
                    table={table}
                    t={t}
                />
            </PageToolbar>

            <PageBody>
                {isLoading ? (
                    <LoadingState
                        label={t(
                            'view.moderation.generated.loading_the_moderation_snapshot'
                        )}
                    />
                ) : isError ? (
                    <ModerationEmptyState
                        title={t(
                            'view.moderation.generated.moderation_snapshot_failed_to_load'
                        )}
                        description={
                            detail || 'The moderation request did not complete.'
                        }
                    />
                ) : hasRows ? (
                    <ModerationPageTable
                        table={table}
                        filteredRowsLength={filteredRows.length}
                        pagination={pagination}
                        pageSizes={pageSizes}
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
                        t={t}
                    />
                ) : (
                    <ModerationEmptyState
                        title={t(
                            'view.moderation.generated.no_moderation_rows_match_the_current_filters'
                        )}
                        description={t(
                            'view.moderation.generated.broaden_the_type_filters_or_search_query_to_see_more_results'
                        )}
                    />
                )}
            </PageBody>
        </PageScaffold>
    );
}
