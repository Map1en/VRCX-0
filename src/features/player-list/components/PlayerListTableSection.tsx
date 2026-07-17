import {
    getCoreRowModel,
    getSortedRowModel,
    useReactTable
} from '@tanstack/react-table';
import type { TFunction } from 'i18next';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { LoadingState } from '@/components/layout/PageScaffold';
import { userFacingErrorMessage } from '@/lib/errorDisplay';

import {
    countPlayerListScopes,
    filterPlayerListRows,
    type PlayerListFilterScope
} from '../playerListFilters';
import type { PlayerListRow, PlayerListSourceRow } from '../playerListTypes';
import { usePlayerListTableState } from '../usePlayerListTableState';
import { usePlayerListColumns } from './PlayerListColumns';
import { PlayerListToolbar } from './PlayerListToolbar';
import {
    PlayerListEmptyState,
    PlayerListRows,
    PlayerListTableShell
} from './PlayerListViewParts';

type PlayerListParsedLocation = {
    isTraveling?: boolean;
    isOffline?: boolean;
};

function resolvePlayerListEmptyCopy({
    gameLogDisabled,
    isGameRunning,
    isPlayerListSourceUnavailable,
    parsedLocation,
    t
}: {
    gameLogDisabled: boolean;
    isGameRunning: boolean;
    isPlayerListSourceUnavailable: boolean;
    parsedLocation: PlayerListParsedLocation;
    t: TFunction;
}) {
    if (gameLogDisabled) {
        return {
            title: t('view.game_log.label.game_log_is_disabled'),
            description: t(
                'view.player_list.empty.enable_game_log_ingestion_in_settings_before_current_players_can_be_reconstructed'
            )
        };
    }

    if (!isGameRunning) {
        return {
            title: t('status_bar.game_stopped'),
            description: t(
                'view.player_list.empty.start_vrchat_and_let_vrcx_receive_game_log_events_before_this_page_can_rebuild_the_current_instance'
            )
        };
    }

    if (isPlayerListSourceUnavailable) {
        return {
            title: t(
                'view.dashboard.error.current_players_are_not_available_yet'
            ),
            description: t(
                'view.player_list.empty.stay_in_the_instance_until_local_join_leave_events_are_recorded'
            )
        };
    }

    if (parsedLocation.isTraveling) {
        return {
            title: t(
                'view.player_list.empty.currently_traveling_between_instances'
            ),
            description: t(
                'view.player_list.empty.current_players_follow_live_instance_locations'
            )
        };
    }

    if (parsedLocation.isOffline) {
        return {
            title: t('view.player_list.empty.no_current_instance_detected'),
            description: t(
                'view.player_list.empty.local_join_leave_history_has_no_current_players'
            )
        };
    }

    return {
        title: t(
            'view.player_list.empty.no_players_reconstructed_for_this_instance_yet'
        ),
        description: t(
            'view.player_list.empty.local_join_leave_history_has_no_current_players'
        )
    };
}

export function PlayerListTableSection({
    detail,
    filterContextKey,
    filteredRows,
    gameLogDisabled,
    isGameRunning,
    isPlayerListSourceUnavailable,
    loadStatus,
    onOpenPlayer,
    parsedLocation,
    playerSourceRows
}: {
    detail?: string;
    filterContextKey: string;
    filteredRows: PlayerListRow[];
    gameLogDisabled: boolean;
    isGameRunning: boolean;
    isPlayerListSourceUnavailable: boolean;
    loadStatus: string;
    onOpenPlayer: (row: PlayerListRow) => void;
    parsedLocation: PlayerListParsedLocation;
    playerSourceRows: readonly PlayerListSourceRow[];
}) {
    const { t } = useTranslation();
    const tableState = usePlayerListTableState();
    const tableColumns = usePlayerListColumns();
    const [query, setQuery] = useState('');
    const [filterScope, setFilterScope] =
        useState<PlayerListFilterScope>('all');

    useEffect(() => {
        setQuery('');
        setFilterScope('all');
    }, [filterContextKey]);

    const scopeCounts = useMemo(
        () => countPlayerListScopes(filteredRows),
        [filteredRows]
    );
    const visibleRows = useMemo(
        () => filterPlayerListRows(filteredRows, query, filterScope),
        [filterScope, filteredRows, query]
    );
    const table = useReactTable<PlayerListRow>({
        data: visibleRows,
        columns: tableColumns,
        state: {
            columnOrder: tableState.columnOrder,
            columnSizing: tableState.columnSizing,
            columnVisibility: tableState.columnVisibility,
            sorting: tableState.sorting
        },
        onSortingChange: tableState.setSorting,
        onColumnVisibilityChange: tableState.setColumnVisibility,
        onColumnOrderChange: tableState.setColumnOrder,
        onColumnSizingChange: tableState.setColumnSizing,
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getRowId: (row) =>
            `${row.userId || String(row.id || '')}:${row.displayName || ''}`,
        enableColumnResizing: true,
        columnResizeMode: 'onChange',
        meta: {
            columnOrderLocked: tableState.columnOrderLocked,
            setColumnOrderLocked: tableState.setColumnOrderLocked
        }
    });

    const hasSourceRows = filteredRows.length > 0;
    const hasVisibleRows = visibleRows.length > 0;
    const isLoading = loadStatus === 'running' && playerSourceRows.length === 0;
    const isError = loadStatus === 'error' && playerSourceRows.length === 0;
    const emptyCopy = resolvePlayerListEmptyCopy({
        gameLogDisabled,
        isGameRunning,
        isPlayerListSourceUnavailable,
        parsedLocation,
        t
    });

    return (
        <div className="current-instance-table flex min-h-0 min-w-0 flex-1 flex-col">
            {isLoading ? (
                <LoadingState
                    label={t(
                        'view.player_list.label.rebuilding_the_current_instance_roster_from_game_log_history'
                    )}
                />
            ) : isError ? (
                <PlayerListEmptyState
                    title={t(
                        'view.player_list.error.current_players_failed_to_load'
                    )}
                    description={userFacingErrorMessage(
                        detail,
                        'Current players could not be rebuilt for the current instance.'
                    )}
                />
            ) : !hasSourceRows ? (
                <PlayerListEmptyState
                    title={emptyCopy.title}
                    description={emptyCopy.description}
                    className="min-h-0 flex-1"
                />
            ) : (
                <>
                    <PlayerListToolbar
                        counts={scopeCounts}
                        onQueryChange={setQuery}
                        onResetLayout={tableState.resetLayout}
                        onScopeChange={setFilterScope}
                        query={query}
                        scope={filterScope}
                        table={table}
                    />
                    <PlayerListTableShell
                        table={table}
                        onResetLayout={tableState.resetLayout}
                    >
                        <PlayerListRows
                            table={table}
                            hasRows={hasVisibleRows}
                            emptyTitle={t('common.no_matching_records')}
                            onOpenPlayer={onOpenPlayer}
                        />
                    </PlayerListTableShell>
                </>
            )}
        </div>
    );
}
