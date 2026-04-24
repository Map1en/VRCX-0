export function GameLogPageView({
    PageScaffold,
    embedded,
    PageToolbar,
    GameLogToolbar,
    savedViewMode,
    favoritesOnly,
    availableFilterTypes,
    queryFilterTypes,
    changeViewMode,
    toggleFavoritesOnly,
    setActiveSelectedTypes,
    sessionDatePopoverOpen,
    handleSessionDatePopoverChange,
    sessionDateFrom,
    sessionDateTo,
    sessionDateDraftFrom,
    sessionDateDraftTo,
    sessionDateDraftRange,
    todayDate,
    updateSessionDateDraftRange,
    clearSessionDateRange,
    applySessionDateRange,
    searchDraft,
    setSearchDraft,
    commitSearchDraft,
    clearSearch,
    currentUserId,
    gameLogDisabled,
    loadStatus,
    refreshGameLog,
    table,
    t,
    detail,
    userFacingErrorMessage,
    PageBody,
    isLoading,
    LoadingState,
    isError,
    GameLogEmptyState,
    hasSessions,
    GameLogSessionsView,
    annotatedSessions,
    isGameRunning,
    hasMoreSessions,
    isLoadingMoreSessions,
    deferredSearchQuery,
    setSessionLimit,
    pagination,
    isFavoritesLoaded,
    hasRows,
    DataTableSurface,
    DataTableHeader,
    getGameLogColumnStyle,
    TableBody,
    TableRow,
    ResizableTableCell,
    PageFooter,
    annotatedRows,
    DataTablePagination,
    pageCount,
    pageSizes,
    resolveGameLogPageSize,
    setPagination,
    PreviousInstancesTableDialog,
    previousInstancesOpen,
    setPreviousInstancesOpen,
    previousInstancesTitle,
    previousInstancesRows,
    setPreviousInstancesRows
}) {
    return (
        <PageScaffold embedded={embedded}>
            <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden">
                <PageToolbar>
                    <GameLogToolbar
                        viewMode={savedViewMode}
                        favoritesOnly={favoritesOnly}
                        availableFilterTypes={availableFilterTypes}
                        queryFilterTypes={queryFilterTypes}
                        onViewModeChange={changeViewMode}
                        onToggleFavoritesOnly={toggleFavoritesOnly}
                        onSelectedTypesChange={setActiveSelectedTypes}
                        sessionDatePopoverOpen={sessionDatePopoverOpen}
                        onSessionDatePopoverOpenChange={
                            handleSessionDatePopoverChange
                        }
                        sessionDateFrom={sessionDateFrom}
                        sessionDateTo={sessionDateTo}
                        sessionDateDraftFrom={sessionDateDraftFrom}
                        sessionDateDraftTo={sessionDateDraftTo}
                        sessionDateDraftRange={sessionDateDraftRange}
                        todayDate={todayDate}
                        onSessionDateRangeSelect={updateSessionDateDraftRange}
                        onSessionDateClear={clearSessionDateRange}
                        onSessionDateApply={applySessionDateRange}
                        searchDraft={searchDraft}
                        onSearchDraftChange={setSearchDraft}
                        onSearchCommit={commitSearchDraft}
                        onSearchClear={clearSearch}
                        canRefresh={Boolean(currentUserId) && !gameLogDisabled}
                        loadStatus={loadStatus}
                        onRefresh={refreshGameLog}
                        table={table}
                        t={t}
                    />
                    {detail ? (
                        <div className="text-muted-foreground text-sm">
                            {userFacingErrorMessage(
                                detail,
                                'Failed to load the game log snapshot.'
                            )}
                        </div>
                    ) : null}
                </PageToolbar>

                <PageBody>
                    {isLoading ? (
                        <LoadingState
                            label={t(
                                'view.game_log.generated.loading_the_game_log_snapshot'
                            )}
                        />
                    ) : isError ? (
                        <GameLogEmptyState
                            title={t(
                                'view.game_log.generated.game_log_failed_to_load'
                            )}
                            description={
                                detail || 'The game log query did not complete.'
                            }
                        />
                    ) : gameLogDisabled ? (
                        <GameLogEmptyState
                            title={t(
                                'view.game_log.generated.game_log_is_disabled'
                            )}
                            description={t(
                                'view.game_log.generated.enable_game_log_ingestion_in_settings_before_this_page_can_l'
                            )}
                        />
                    ) : savedViewMode === 'sessions' ? (
                        hasSessions ? (
                            <GameLogSessionsView
                                sessions={annotatedSessions}
                                isGameRunning={isGameRunning}
                                hasMore={hasMoreSessions}
                                isLoadingMore={isLoadingMoreSessions}
                                autoFill={
                                    Boolean(deferredSearchQuery.trim()) &&
                                    !sessionDateFrom &&
                                    !sessionDateTo
                                }
                                autoFillKey={`${deferredSearchQuery}:${sessionDateFrom}:${sessionDateTo}:${queryFilterTypes.join(',')}:${favoritesOnly}`}
                                onLoadMore={() =>
                                    setSessionLimit((current) =>
                                        Math.min(
                                            current + pagination.pageSize,
                                            1000
                                        )
                                    )
                                }
                            />
                        ) : (
                            <GameLogEmptyState
                                title={t(
                                    'view.game_log.generated.no_game_log_sessions_match_the_current_filters'
                                )}
                                description={
                                    favoritesOnly && !isFavoritesLoaded
                                        ? t(
                                              'view.game_log.generated.favorites_are_still_hydrating'
                                          )
                                        : t(
                                              'view.game_log.generated.broaden_the_filters_or_search_query_to_see_more_recent_sessions'
                                          )
                                }
                            />
                        )
                    ) : hasRows ? (
                        <div className="flex min-h-0 flex-1 flex-col gap-3">
                            <DataTableSurface className="overflow-x-hidden overflow-y-auto">
                                <table className="w-full table-fixed caption-bottom text-sm">
                                    <DataTableHeader
                                        table={table}
                                        getHeaderStyle={getGameLogColumnStyle}
                                    />
                                    <TableBody>
                                        {table.getRowModel().rows.map((row) => (
                                            <TableRow
                                                key={
                                                    row.original?.rowId != null
                                                        ? `${row.original.type}:${row.original.rowId}`
                                                        : row.id
                                                }
                                            >
                                                {row
                                                    .getVisibleCells()
                                                    .map((cell) => (
                                                        <ResizableTableCell
                                                            key={cell.id}
                                                            cell={cell}
                                                            style={getGameLogColumnStyle(
                                                                cell.column
                                                            )}
                                                        />
                                                    ))}
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </table>
                            </DataTableSurface>

                            <PageFooter>
                                <div className="text-muted-foreground text-sm">
                                    {t('view.game_log.generated.showing')}{' '}
                                    <span className="text-foreground font-medium">
                                        {table.getRowModel().rows.length}
                                    </span>{' '}
                                    {t('view.game_log.generated.of')}{' '}
                                    <span className="text-foreground font-medium">
                                        {annotatedRows.length}
                                    </span>{' '}
                                    {t('view.game_log.generated.game_log_row')}
                                    {annotatedRows.length === 1 ? '' : 's'}
                                </div>
                                <DataTablePagination
                                    table={table}
                                    pageIndex={pagination.pageIndex}
                                    pageCount={pageCount}
                                    pageSize={pagination.pageSize}
                                    pageSizes={pageSizes}
                                    pageSizeLabel={t(
                                        'table.pagination.rows_per_page'
                                    )}
                                    onPageSizeChange={(value) => {
                                        const nextPageSize =
                                            resolveGameLogPageSize(
                                                value,
                                                pageSizes,
                                                pagination.pageSize
                                            );
                                        setPagination({
                                            pageIndex: 0,
                                            pageSize: nextPageSize
                                        });
                                        setSessionLimit(nextPageSize);
                                    }}
                                />
                            </PageFooter>
                        </div>
                    ) : (
                        <GameLogEmptyState
                            title={t(
                                'view.game_log.generated.no_game_log_rows_match_the_current_filters'
                            )}
                            description={
                                favoritesOnly && !isFavoritesLoaded
                                    ? t(
                                          'view.game_log.generated.favorites_are_still_hydrating'
                                      )
                                    : t(
                                          'view.game_log.generated.broaden_the_filters_or_search_query_to_see_more_results'
                                      )
                            }
                        />
                    )}
                </PageBody>
            </div>
            <PreviousInstancesTableDialog
                open={previousInstancesOpen}
                onOpenChange={setPreviousInstancesOpen}
                title={previousInstancesTitle}
                instances={previousInstancesRows}
                variant="world"
                onRowsChange={setPreviousInstancesRows}
            />
        </PageScaffold>
    );
}
