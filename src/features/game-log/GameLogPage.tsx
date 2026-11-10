import { HistoryIcon, SearchXIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { PreviousInstancesTableDialog } from '@/components/dialogs/PreviousInstancesTableDialog';
import {
    EmptyState,
    LoadingState,
    PageBody,
    PageScaffold
} from '@/components/layout/PageScaffold';
import { userFacingErrorMessage } from '@/lib/errorDisplay';
import { getSettingDeepLinkPath } from '@/shared/constants/settingsManifest';
import { useRuntimeStore } from '@/state/runtimeStore';
import { Alert, AlertDescription, AlertTitle } from '@/ui/shadcn/alert';
import { Button } from '@/ui/shadcn/button';

import { GameLogSessionsView } from './components/GameLogSessionsView';
import { GameLogTableShell } from './components/GameLogTableShell';
import { GameLogToolbar } from './components/GameLogToolbar';
import { GameLogFilterCommandsContext } from './gameLogFilterCommands';
import { GameLogSessionAffinityContext } from './gameLogSessionAffinity';
import { useGameLogPageController } from './useGameLogPageController';
import { useGameLogSessionExpansion } from './useGameLogSessionExpansion';

const GAME_LOG_IMPORT_ACTION = {
    labelKey:
        'view.settings.advanced.advanced_ui.import_recovery.game_log.label',
    settingId: 'advanced.import-recovery.gamelog-import'
};

function resolveNoHistoryCopy({
    ingestSupported,
    ingestAvailable,
    gameLogDisabled
}: {
    ingestSupported: boolean;
    ingestAvailable: boolean;
    gameLogDisabled: boolean;
}): {
    descriptionKey: string;
    action: { labelKey: string; settingId: string } | null;
} {
    if (!ingestSupported) {
        return {
            descriptionKey: 'empty_state.game_log_unsupported_description',
            action: null
        };
    }
    if (gameLogDisabled) {
        return {
            descriptionKey: 'empty_state.game_log_disabled_description',
            action: {
                labelKey: 'empty_state.game_log_enable_action',
                settingId: 'advanced.storage.gamelog'
            }
        };
    }
    if (!ingestAvailable) {
        return {
            descriptionKey: 'empty_state.game_log_unavailable_description',
            action: GAME_LOG_IMPORT_ACTION
        };
    }
    return {
        descriptionKey: 'empty_state.game_log_description',
        action: GAME_LOG_IMPORT_ACTION
    };
}

export function GameLogPage({ embedded = false }: { embedded?: boolean } = {}) {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const gameLogIngestSupported = useRuntimeStore(
        (state) => state.hostCapabilities.runtimeGameLogIngest.supported
    );
    const gameLogIngestAvailable = useRuntimeStore(
        (state) => state.hostCapabilities.runtimeGameLogIngest.available
    );
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
        rowFilterCommands,
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
    const showsNoHistory =
        !hasActiveFilters &&
        (filters.viewMode === 'sessions' ? !hasSessions : !hasRows);
    let emptyState: ReactNode;
    if (hasActiveFilters) {
        const sessionsMode = filters.viewMode === 'sessions';
        emptyState = (
            <EmptyState
                icon={SearchXIcon}
                title={t(
                    sessionsMode
                        ? 'view.game_log.empty.no_game_log_sessions_match_the_current_filters'
                        : 'view.game_log.empty.no_game_log_rows_match_the_current_filters'
                )}
                description={
                    filters.favoritesOnly && !rowsState.isFavoritesLoaded
                        ? t(
                              'view.game_log.description.favorites_are_still_hydrating'
                          )
                        : t(
                              sessionsMode
                                  ? 'view.game_log.description.broaden_the_filters_or_search_query_to_see_more_recent_sessions'
                                  : 'view.game_log.description.broaden_the_filters_or_search_query_to_see_more_results'
                          )
                }
            />
        );
    } else {
        const { action, descriptionKey } = resolveNoHistoryCopy({
            ingestSupported: gameLogIngestSupported,
            ingestAvailable: gameLogIngestAvailable,
            gameLogDisabled: rowsState.gameLogDisabled
        });
        emptyState = (
            <EmptyState
                icon={HistoryIcon}
                title={t('empty_state.game_log_title')}
                description={t(descriptionKey)}
            >
                {action ? (
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                            navigate(getSettingDeepLinkPath(action.settingId))
                        }
                    >
                        {t(action.labelKey)}
                    </Button>
                ) : null}
            </EmptyState>
        );
    }

    return (
        <PageScaffold embedded={embedded}>
            <GameLogToolbar
                detail={
                    rowsState.detail
                        ? userFacingErrorMessage(
                              rowsState.detail,
                              t('view.game_log.error.game_log_failed_to_load')
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

            {rowsState.gameLogDisabled && !showsNoHistory ? (
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

            <GameLogFilterCommandsContext value={rowFilterCommands}>
                <PageBody>
                    {isLoading ? (
                        <LoadingState
                            label={t(
                                'view.game_log.loading.loading_the_game_log_snapshot'
                            )}
                        />
                    ) : isError ? (
                        <EmptyState
                            title={t(
                                'view.game_log.error.game_log_failed_to_load'
                            )}
                            description={
                                rowsState.detail ||
                                t('common.error.failed_to_load_data')
                            }
                        />
<<<<<<< HEAD
                    )
                ) : hasRows ? (
                    <GameLogTableShell
                        table={table}
                        rows={rowsState.rows}
                        pageCount={pageCount}
                        pageSizes={tableState.pageSizes}
                        setPagination={tableState.setPagination}
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
=======
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
                            emptyState
                        )
                    ) : hasRows ? (
                        <GameLogTableShell
                            table={table}
                            rows={rowsState.rows}
                            pageCount={pageCount}
                            pageSizes={tableState.pageSizes}
                            setPagination={tableState.setPagination}
                        />
                    ) : (
                        emptyState
                    )}
                </PageBody>
            </GameLogFilterCommandsContext>
>>>>>>> 8c88c5b0c9d6bec0a5241580c3343dc29fdc9c4d
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
