import { useTranslation } from 'react-i18next';

import { PreviousInstancesTableDialog } from '@/components/dialogs/PreviousInstancesTableDialog';
import {
    LoadingState,
    PageBody,
    PageScaffold,
    PageToolbar
} from '@/components/layout/PageScaffold';
import { userFacingErrorMessage } from '@/lib/errorDisplay';

import { GameLogSessionsView } from './components/GameLogSessionsView';
import { GameLogEmptyState } from './components/GameLogTableParts';
import { GameLogTableShell } from './components/GameLogTableShell';
import { GameLogToolbar } from './components/GameLogToolbar';
import { useGameLogPageController } from './useGameLogPageController';

export function GameLogPage({ embedded = false }: { embedded?: boolean } = {}) {
    const { t } = useTranslation();
    const {
        annotations,
        filters,
        isError,
        isGameRunning,
        isLoading,
        isLoadingMoreSessions,
        hasMoreSessions,
        pageCount,
        previousInstancesDialog,
        rowsState,
        table,
        tableState
    } = useGameLogPageController();
    const hasSessions = annotations.annotatedSessions.length > 0;
    const hasRows = annotations.annotatedRows.length > 0;

    return (
        <PageScaffold embedded={embedded}>
            <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden">
                <PageToolbar>
                    <GameLogToolbar
                        filterModel={filters}
                        refreshModel={{
                            canRefresh:
                                Boolean(rowsState.currentUserId) &&
                                !rowsState.gameLogDisabled,
                            loadStatus: rowsState.loadStatus,
                            onRefresh: filters.refreshGameLog
                        }}
                        table={table}
                    />
                    {rowsState.detail ? (
                        <div className="text-muted-foreground text-sm">
                            {userFacingErrorMessage(
                                rowsState.detail,
                                'Failed to load the game log snapshot.'
                            )}
                        </div>
                    ) : null}
                </PageToolbar>

                <PageBody>
                    {isLoading ? (
                        <LoadingState
                            label={t(
                                'view.game_log.loading.loading_the_game_log_snapshot'
                            )}
                        />
                    ) : isError ? (
                        <GameLogEmptyState
                            title={t(
                                'view.game_log.error.game_log_failed_to_load'
                            )}
                            description={
                                rowsState.detail ||
                                'The game log query did not complete.'
                            }
                        />
                    ) : rowsState.gameLogDisabled ? (
                        <GameLogEmptyState
                            title={t(
                                'view.game_log.label.game_log_is_disabled'
                            )}
                            description={t(
                                'view.game_log.action.enable_game_log_ingestion_in_settings_before_this_page_can_load_local_vrchat_activity'
                            )}
                        />
                    ) : filters.viewMode === 'sessions' ? (
                        hasSessions ? (
                            <GameLogSessionsView
                                sessions={annotations.annotatedSessions}
                                isGameRunning={isGameRunning}
                                hasMore={hasMoreSessions}
                                isLoadingMore={isLoadingMoreSessions}
                                autoFill={
                                    Boolean(
                                        filters.deferredSearchQuery.trim()
                                    ) &&
                                    !filters.sessionDateFrom &&
                                    !filters.sessionDateTo
                                }
                                autoFillKey={`${filters.deferredSearchQuery}:${filters.sessionDateFrom}:${filters.sessionDateTo}:${filters.queryFilterTypes.join(',')}:${filters.favoritesOnly}`}
                                onLoadMore={tableState.loadMoreSessions}
                            />
                        ) : (
                            <GameLogEmptyState
                                title={t(
                                    'view.game_log.empty.no_game_log_sessions_match_the_current_filters'
                                )}
                                description={
                                    filters.favoritesOnly &&
                                    !rowsState.isFavoritesLoaded
                                        ? t(
                                              'view.game_log.description.favorites_are_still_hydrating'
                                          )
                                        : t(
                                              'view.game_log.description.broaden_the_filters_or_search_query_to_see_more_recent_sessions'
                                          )
                                }
                            />
                        )
                    ) : hasRows ? (
                        <GameLogTableShell
                            table={table}
                            rows={annotations.annotatedRows}
                            pageCount={pageCount}
                            pageSizes={tableState.pageSizes}
                            setPagination={tableState.setPagination}
                            setSessionLimit={tableState.setSessionLimit}
                        />
                    ) : (
                        <GameLogEmptyState
                            title={t(
                                'view.game_log.empty.no_game_log_rows_match_the_current_filters'
                            )}
                            description={
                                filters.favoritesOnly &&
                                !rowsState.isFavoritesLoaded
                                    ? t(
                                          'view.game_log.description.favorites_are_still_hydrating'
                                      )
                                    : t(
                                          'view.game_log.description.broaden_the_filters_or_search_query_to_see_more_results'
                                      )
                            }
                        />
                    )}
                </PageBody>
            </div>
            <PreviousInstancesTableDialog
                open={previousInstancesDialog.open}
                onOpenChange={previousInstancesDialog.setOpen}
                title={previousInstancesDialog.title}
                instances={previousInstancesDialog.rows}
                variant="world"
                onRowsChange={previousInstancesDialog.setRows}
            />
        </PageScaffold>
    );
}
