import {
    getCoreRowModel,
    getSortedRowModel,
    useReactTable
} from '@tanstack/react-table';
import { useMemo, useRef, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { TableColumnVisibilityMenu } from '@/components/data-table/TableColumnVisibilityMenu.jsx';
import { LoadingState } from '@/components/layout/PageScaffold.jsx';
import { userFacingErrorMessage } from '@/lib/errorDisplay.js';
import { usePreferencesStore } from '@/state/preferencesStore.js';

import {
    PLAYER_LIST_COLUMN_IDS as COLUMN_IDS,
    readPersistedPlayerListState,
    sanitizePlayerListColumnOrder,
    sanitizePlayerListColumnSizing,
    sanitizePlayerListColumnVisibility,
    sanitizePlayerListSorting,
    writePersistedPlayerListState
} from '../playerListState.js';
import { buildPlayerListColumns } from './PlayerListColumns.jsx';
import {
    PlayerListEmptyState,
    PlayerListRows,
    PlayerListTableShell
} from './PlayerListViewParts.jsx';

export function PlayerListTableSection({
    detail,
    filteredRows,
    gameLogDisabled,
    isGameRunning,
    isPlayerListSourceUnavailable,
    loadStatus,
    onOpenPlayer,
    parsedLocation,
    playerSourceRows
}) {
    const { t } = useTranslation();
    const randomUserColours = usePreferencesStore(
        (state) => state.randomUserColours
    );
    const [persistedState] = useState(() => readPersistedPlayerListState());
    const hasWrittenSortingRef = useRef(false);
    const hasWrittenTableStateRef = useRef(false);

    const [sorting, setSorting] = useState(() =>
        sanitizePlayerListSorting(persistedState.sorting)
    );
    const [columnVisibility, setColumnVisibility] = useState(() =>
        sanitizePlayerListColumnVisibility(persistedState.columnVisibility)
    );
    const [columnOrder, setColumnOrder] = useState(() =>
        sanitizePlayerListColumnOrder(persistedState.columnOrder)
    );
    const [columnSizing, setColumnSizing] = useState(() =>
        sanitizePlayerListColumnSizing(persistedState.columnSizing)
    );
    const [columnOrderLocked, setColumnOrderLocked] = useState(
        () => persistedState.columnOrderLocked === true
    );

    useEffect(() => {
        if (!hasWrittenSortingRef.current) {
            hasWrittenSortingRef.current = true;
            return;
        }

        writePersistedPlayerListState({
            sorting: sanitizePlayerListSorting(sorting)
        });
    }, [sorting]);

    useEffect(() => {
        if (!hasWrittenTableStateRef.current) {
            hasWrittenTableStateRef.current = true;
            return;
        }

        writePersistedPlayerListState({
            columnVisibility:
                sanitizePlayerListColumnVisibility(columnVisibility),
            columnOrder: sanitizePlayerListColumnOrder(columnOrder),
            columnSizing: sanitizePlayerListColumnSizing(columnSizing),
            columnOrderLocked
        });
    }, [columnOrder, columnOrderLocked, columnSizing, columnVisibility]);

    const isDarkMode =
        typeof document !== 'undefined' &&
        document.documentElement.classList.contains('dark');
    const tableColumns = useMemo(
        () =>
            buildPlayerListColumns({
                isDarkMode,
                randomUserColours,
                t
            }),
        [isDarkMode, randomUserColours, t]
    );
    const table = useReactTable({
        data: filteredRows,
        columns: tableColumns,
        state: {
            columnOrder,
            columnSizing,
            columnVisibility,
            sorting
        },
        onSortingChange: setSorting,
        onColumnVisibilityChange: setColumnVisibility,
        onColumnOrderChange: setColumnOrder,
        onColumnSizingChange: setColumnSizing,
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getRowId: (row) =>
            `${row?.userId || row?.id || ''}:${row?.displayName || ''}`,
        enableColumnResizing: true,
        columnResizeMode: 'onChange',
        meta: {
            columnOrderLocked,
            setColumnOrderLocked
        }
    });

    function resetPlayerListTableLayout() {
        setColumnVisibility({});
        setColumnOrder([...COLUMN_IDS]);
        setColumnSizing({});
    }

    const hasRows = filteredRows.length > 0;
    const isLoading = loadStatus === 'running' && playerSourceRows.length === 0;
    const isError = loadStatus === 'error' && playerSourceRows.length === 0;

    return (
        <div className="current-instance-table flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="mb-2 flex justify-end">
                <TableColumnVisibilityMenu
                    table={table}
                    onResetLayout={resetPlayerListTableLayout}
                />
            </div>
            {isLoading ? (
                <LoadingState
                    label={t(
                        'view.player_list.generated.rebuilding_the_current_instance_roster_from_game_log_history'
                    )}
                />
            ) : isError ? (
                <PlayerListEmptyState
                    title={t(
                        'view.player_list.generated.current_players_failed_to_load'
                    )}
                    description={userFacingErrorMessage(
                        detail,
                        'Current players could not be rebuilt for the current instance.'
                    )}
                />
            ) : (
                <PlayerListTableShell
                    table={table}
                    onResetLayout={resetPlayerListTableLayout}
                >
                    <PlayerListRows
                        table={table}
                        hasRows={hasRows}
                        onOpenPlayer={onOpenPlayer}
                        emptyTitle={
                            gameLogDisabled
                                ? 'Game log is disabled'
                                : !isGameRunning
                                  ? 'VRChat is not running'
                                  : isPlayerListSourceUnavailable
                                    ? 'Current players are not available yet'
                                    : parsedLocation.isTraveling
                                      ? 'Currently traveling between instances'
                                      : parsedLocation.isOffline
                                        ? 'No current instance detected'
                                        : 'No players reconstructed for this instance yet'
                        }
                        emptyDescription={
                            gameLogDisabled
                                ? 'Enable game log ingestion in settings before current players can be reconstructed.'
                                : !isGameRunning
                                  ? 'Start VRChat and let VRCX-0 receive game-log events before this page can rebuild the current instance.'
                                  : isPlayerListSourceUnavailable
                                    ? 'Stay in the instance until local join/leave events are recorded, then this table will populate automatically.'
                                    : parsedLocation.isTraveling
                                      ? 'Current players follow live instance locations. They will repopulate after the next location event lands.'
                                      : 'The local join/leave history does not have any current players for the active location yet.'
                        }
                    />
                </PlayerListTableShell>
            )}
        </div>
    );
}
