import { HistoryIcon, SearchXIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { PreviousInstancesTableDialog } from '@/components/dialogs/PreviousInstancesTableDialog';
import {
    LoadingState,
    PageBody,
    PageScaffold
} from '@/components/layout/PageScaffold';
import { userFacingErrorMessage } from '@/lib/errorDisplay';
import { Alert, AlertDescription, AlertTitle } from '@/ui/shadcn/alert';

import { GameLogSessionsView } from './components/GameLogSessionsView';
import { GameLogEmptyState } from './components/GameLogTableParts';
import { GameLogTableShell } from './components/GameLogTableShell';
import { GameLogToolbar } from './components/GameLogToolbar';
import { GameLogSessionAffinityContext } from './gameLogSessionAffinity';
import { useGameLogPageController } from './useGameLogPageController';
import { useGameLogSessionExpansion } from './useGameLogSessionExpansion';

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
    const hasSessions = rowsState.sessions.length > 0;
    const hasRows = rowsState.rows.length > 0;
    const sessionsVisible =
        filters.viewMode === 'sessions' &&
        hasSessions &&
        !isLoading &&
        !isError;
    const sessionExpansion = useGameLogSessionExpansion(
        rowsState.sessions,
        sessionsVisible
    );
    const hasActiveFilters = Boolean(
        filters.deferredSearchQuery.trim() ||
        filters.favoritesOnly ||
        filters.queryFilterTypes.length ||
        (filters.viewMode === 'sessions' &&
            (filters.sessionDateFrom || filters.sessionDateTo))
    );
    const emptyIcon = hasActiveFilters ? SearchXIcon : HistoryIcon;
    let emptyTitleKey = 'empty_state.game_log_title';
    let emptyDescriptionKey = 'empty_state.game_log_description';
    if (hasActiveFilters) {
        if (filters.viewMode === 'sessions') {
            emptyTitleKey =
                'view.game_log.empty.no_game_log_sessions_match_the_current_filters';
            emptyDescriptionKey =
                'view.game_log.description.broaden_the_filters_or_search_query_to_see_more_recent_sessions';
        } else {
            emptyTitleKey =
                'view.game_log.empty.no_game_log_rows_match_the_current_filters';
            emptyDescriptionKey =
                'view.game_log.description.broaden_the_filters_or_search_query_to_see_more_results';
        }
    }

    return (
        <PageScaffold embedded={embedded}>
            <div className="flex h-full min-h-0 flex-col overflow-hidden">
                <GameLogToolbar
                    detail={
                        rowsState.detail
                            ? userFacingErrorMessage(
                                  rowsState.detail,
                                  'Failed to load the game log snapshot.'
                              )
                            : ''
                    }
                    filterModel={filters}
                    refreshModel={{
                        canRefresh: Boolean(rowsState.currentUserId),
                        loadStatus: rowsState.loadStatus,
                        onRefresh: filters.refreshGameLog
                    }}
                    table={table}
                    sessionControls={{
                        allOpen: sessionExpansion.allSessionsOpen,
                        canToggle: sessionsVisible,
                        onToggle: sessionExpansion.toggleAll
                    }}
                />

                {rowsState.gameLogDisabled ? (
                    <Alert className="mb-3">
                        <AlertTitle>
                            {t('view.game_log.label.game_log_is_disabled')}
                        </AlertTitle>
                        <AlertDescription>
                            {t(
                                'view.game_log.action.enable_game_log_ingestion_in_settings_before_this_page_can_load_local_vrchat_activity'
                            )}
                        </AlertDescription>
                    </Alert>
                ) : null}

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
                    ) : filters.viewMode === 'sessions' ? (
                        hasSessions ? (
                            <GameLogSessionAffinityContext
                                value={annotations.affinity}
                            >
                                <GameLogSessionsView
                                    sessions={rowsState.sessions}
                                    defaultOpen={sessionExpansion.defaultOpen}
                                    sessionOpenOverrides={
                                        sessionExpansion.sessionOpenOverrides
                                    }
                                    onSessionOpenChange={
                                        sessionExpansion.onSessionOpenChange
                                    }
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
                            </GameLogSessionAffinityContext>
                        ) : (
                            <GameLogEmptyState
                                icon={emptyIcon}
                                title={t(emptyTitleKey)}
                                description={
                                    filters.favoritesOnly &&
                                    !rowsState.isFavoritesLoaded
                                        ? t(
                                              'view.game_log.description.favorites_are_still_hydrating'
                                          )
                                        : t(emptyDescriptionKey)
                                }
                            />
                        )
                    ) : hasRows ? (
                        <GameLogTableShell
                            table={table}
                            rows={rowsState.rows}
                            pageCount={pageCount}
                            pageSizes={tableState.pageSizes}
                            setPagination={tableState.setPagination}
                            setSessionLimit={tableState.setSessionLimit}
                        />
                    ) : (
                        <GameLogEmptyState
                            icon={emptyIcon}
                            title={t(emptyTitleKey)}
                            description={
                                filters.favoritesOnly &&
                                !rowsState.isFavoritesLoaded
                                    ? t(
                                          'view.game_log.description.favorites_are_still_hydrating'
                                      )
                                    : t(emptyDescriptionKey)
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
