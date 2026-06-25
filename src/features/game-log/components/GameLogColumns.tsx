import type { Column, Row } from '@tanstack/react-table';
import {
    CopyIcon,
    ExternalLinkIcon,
    FileTextIcon,
    Trash2Icon,
    XIcon
} from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { formatDateFilter } from '@/lib/dateTime';
import { openWorldDialog } from '@/services/dialogService';
import { openExternalLink } from '@/services/entityMediaService';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Spinner } from '@/ui/shadcn/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import {
    canDeleteGameLogRow,
    describeGameLogDetail,
    GAME_LOG_DETAILLESS_TYPES,
    getGameLogCopyTarget,
    getGameLogExternalTarget,
    getGameLogRowKey,
    normalizeGameLogId as normalizeId,
    resolveGameLogWorldId as resolveWorldId,
    resolveGameLogWorldTarget as resolveWorldTarget,
    shouldLinkGameLogPrimaryDetailToWorld as shouldLinkPrimaryDetailToWorld
} from '../gameLogRows';
import type { GameLogColumns, GameLogRow } from '../gameLogTypes';
import { openGameLogUser } from '../gameLogUserLookup';
import {
    EmptyTableValue,
    GameLogLocationDetail,
    SortButton
} from './GameLogTableParts';

type UseGameLogColumnsOptions = {
    deletingGameLogKey: string;
    loadingPreviousInstancesKey: string;
    onCopyDetail(row: GameLogRow): void;
    onDeleteRow(row: GameLogRow, options?: { skipConfirm?: boolean }): void;
    onOpenPreviousInstances(row: GameLogRow): void;
    shiftHeld: boolean;
};

function DateCell({ row }: { row: Row<GameLogRow> }) {
    const createdAt = row.original?.created_at || '';
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <span className="text-sm">
                    {formatDateFilter(createdAt, 'short')}
                </span>
            </TooltipTrigger>
            <TooltipContent>
                {formatDateFilter(createdAt, 'long')}
            </TooltipContent>
        </Tooltip>
    );
}

export function useGameLogColumns({
    deletingGameLogKey,
    loadingPreviousInstancesKey,
    onCopyDetail,
    onDeleteRow,
    onOpenPreviousInstances,
    shiftHeld
}: UseGameLogColumnsOptions): GameLogColumns {
    const { t } = useTranslation();

    return useMemo(
        () => [
            {
                id: 'spacer',
                size: 20,
                minSize: 0,
                maxSize: 20,
                enableSorting: false,
                enableResizing: false,
                header: () => null,
                cell: () => null
            },
            {
                id: 'created_at',
                size: 140,
                accessorFn: (row: GameLogRow) => row?.created_at || '',
                header: ({
                    column
                }: {
                    column: Column<GameLogRow, unknown>;
                }) => (
                    <SortButton
                        column={column}
                        label={t('table.gameLog.date')}
                    />
                ),
                sortingFn: (rowA: Row<GameLogRow>, rowB: Row<GameLogRow>) => {
                    const leftTs = Date.parse(
                        String(rowA.original?.created_at ?? '')
                    );
                    const rightTs = Date.parse(
                        String(rowB.original?.created_at ?? '')
                    );
                    if (
                        Number.isFinite(leftTs) &&
                        Number.isFinite(rightTs) &&
                        leftTs !== rightTs
                    ) {
                        return leftTs - rightTs;
                    }

                    return (
                        (Number.parseInt(
                            String(rowA.original?.rowId ?? 0),
                            10
                        ) || 0) -
                        (Number.parseInt(
                            String(rowB.original?.rowId ?? 0),
                            10
                        ) || 0)
                    );
                },
                cell: ({ row }: { row: Row<GameLogRow> }) => (
                    <DateCell row={row} />
                )
            },
            {
                id: 'type',
                size: 150,
                accessorFn: (row: GameLogRow) => row?.type || '',
                header: ({
                    column
                }: {
                    column: Column<GameLogRow, unknown>;
                }) => (
                    <SortButton
                        column={column}
                        label={t('table.gameLog.type')}
                    />
                ),
                cell: ({ row }: { row: Row<GameLogRow> }) => {
                    const worldTarget = resolveWorldTarget(row.original);
                    const typeLabel = row.original?.type
                        ? t(
                              `view.game_log.filters.${String(row.original.type)}`
                          )
                        : '';
                    if (row.original?.type !== 'Location' && worldTarget) {
                        return (
                            <Button
                                type="button"
                                variant="ghost"
                                className="h-auto p-0"
                                onClick={(event) => {
                                    event.stopPropagation();
                                    openWorldDialog({
                                        worldId: worldTarget,
                                        title:
                                            String(
                                                row.original?.worldName || ''
                                            ) || worldTarget
                                    });
                                }}
                            >
                                <Badge
                                    variant="outline"
                                    className="text-muted-foreground"
                                >
                                    {typeLabel}
                                </Badge>
                            </Button>
                        );
                    }

                    return (
                        <Badge
                            variant="outline"
                            className="text-muted-foreground"
                        >
                            {typeLabel}
                        </Badge>
                    );
                }
            },
            {
                id: 'displayName',
                size: 200,
                accessorFn: (row: GameLogRow) =>
                    row?.displayName || row?.userId || '',
                enableSorting: false,
                header: () => t('table.gameLog.user'),
                cell: ({ row }: { row: Row<GameLogRow> }) => {
                    const displayName = normalizeId(row.original?.displayName);
                    const canOpenUser = Boolean(
                        displayName &&
                        (row.original?.userId || row.original?.displayName)
                    );

                    return (
                        <div className="flex min-w-0 items-center gap-1 text-sm">
                            {canOpenUser ? (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    className="hover:text-primary h-auto min-w-0 p-0 text-left text-sm"
                                    onClick={() => {
                                        openGameLogUser(row.original, t);
                                    }}
                                >
                                    <span className="truncate">
                                        {displayName}
                                    </span>
                                </Button>
                            ) : (
                                <span className="truncate">{displayName}</span>
                            )}
                            {row.original?.isFriend ? (
                                <span className="shrink-0">
                                    {row.original?.isFavorite
                                        ? '\u2b50'
                                        : '\ud83d\udc9a'}
                                </span>
                            ) : null}
                        </div>
                    );
                }
            },
            {
                id: 'detail',
                minSize: 150,
                accessorFn: (row: GameLogRow) => {
                    const detailValue = describeGameLogDetail(row);
                    return [detailValue.primary, detailValue.secondary]
                        .filter(Boolean)
                        .join(' ');
                },
                enableSorting: false,
                header: () => t('table.gameLog.detail'),
                cell: ({ row }: { row: Row<GameLogRow> }) => {
                    const detailValue = describeGameLogDetail(row.original);
                    const worldTarget = resolveWorldTarget(row.original);
                    if (
                        row.original?.type === 'Location' ||
                        row.original?.type === 'PortalSpawn'
                    ) {
                        return (
                            <GameLogLocationDetail
                                row={row.original}
                                detailValue={detailValue}
                                worldTarget={worldTarget}
                                onPreviousInstances={(targetRow) => {
                                    onOpenPreviousInstances(targetRow);
                                }}
                            />
                        );
                    }
                    if (
                        GAME_LOG_DETAILLESS_TYPES.has(
                            String(row.original?.type)
                        )
                    ) {
                        return <EmptyTableValue />;
                    }
                    const canOpenWorld =
                        worldTarget &&
                        shouldLinkPrimaryDetailToWorld(row.original);
                    const externalTarget = getGameLogExternalTarget(
                        row.original
                    );
                    const copyTarget = getGameLogCopyTarget(row.original);
                    if (
                        !detailValue.primary &&
                        !detailValue.secondary &&
                        !externalTarget &&
                        !copyTarget
                    ) {
                        return <EmptyTableValue />;
                    }
                    const primary = String(detailValue.primary || '');
                    const secondary = String(detailValue.secondary || '');
                    return (
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <div className="flex min-w-0 items-center gap-1.5 text-sm">
                                    {canOpenWorld ? (
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            className="hover:text-primary h-auto min-w-0 p-0 text-left text-sm"
                                            onClick={() =>
                                                openWorldDialog({
                                                    worldId: worldTarget,
                                                    title:
                                                        String(
                                                            row.original
                                                                ?.worldName ||
                                                                ''
                                                        ) ||
                                                        primary ||
                                                        worldTarget
                                                })
                                            }
                                        >
                                            <span className="truncate">
                                                {primary}
                                            </span>
                                        </Button>
                                    ) : (
                                        <span className="min-w-0 truncate">
                                            {primary}
                                        </span>
                                    )}
                                    {secondary ? (
                                        <span className="text-muted-foreground min-w-0 truncate text-xs">
                                            {secondary}
                                        </span>
                                    ) : null}
                                    {externalTarget || copyTarget ? (
                                        <div className="ml-auto flex shrink-0 items-center gap-1">
                                            {externalTarget ? (
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="icon"
                                                    aria-label={t(
                                                        'view.game_log.action.open_link'
                                                    )}
                                                    className="size-6 p-0"
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        openExternalLink(
                                                            externalTarget
                                                        );
                                                    }}
                                                >
                                                    <ExternalLinkIcon data-icon="inline-start" />
                                                </Button>
                                            ) : null}
                                            {copyTarget ? (
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="icon"
                                                    aria-label={t(
                                                        'view.game_log.action.copy_detail'
                                                    )}
                                                    className="size-6 p-0"
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        onCopyDetail(
                                                            row.original
                                                        );
                                                    }}
                                                >
                                                    <CopyIcon data-icon="inline-start" />
                                                </Button>
                                            ) : null}
                                        </div>
                                    ) : null}
                                </div>
                            </TooltipTrigger>
                            <TooltipContent>
                                {[primary, secondary]
                                    .filter(Boolean)
                                    .join(' \u00b7 ')}
                            </TooltipContent>
                        </Tooltip>
                    );
                }
            },
            {
                id: 'action',
                size: 90,
                minSize: 90,
                maxSize: 90,
                header: () => t('table.gameLog.action'),
                enableSorting: false,
                cell: ({ row }: { row: Row<GameLogRow> }) => {
                    const rowKey = getGameLogRowKey(row.original);
                    const canDelete = canDeleteGameLogRow(row.original);
                    const canShowPrevious = Boolean(
                        row.original?.type === 'Location' &&
                        resolveWorldId(row.original)
                    );

                    if (!canDelete && !canShowPrevious) {
                        return <EmptyTableValue />;
                    }

                    return (
                        <div className="flex items-center justify-end gap-2">
                            {canDelete ? (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    aria-label={t(
                                        'view.game_log.modal.delete_game_log_row'
                                    )}
                                    className="text-muted-foreground hover:text-destructive size-6 p-0"
                                    disabled={deletingGameLogKey === rowKey}
                                    onClick={(event) => {
                                        onDeleteRow(row.original, {
                                            skipConfirm:
                                                shiftHeld || event.shiftKey
                                        });
                                    }}
                                >
                                    {deletingGameLogKey === rowKey ? (
                                        <Spinner data-icon="inline-start" />
                                    ) : shiftHeld ? (
                                        <XIcon
                                            data-icon="inline-start"
                                            className="text-destructive"
                                        />
                                    ) : (
                                        <Trash2Icon data-icon="inline-start" />
                                    )}
                                </Button>
                            ) : null}
                            {canShowPrevious ? (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    aria-label={t(
                                        'view.game_log.action.show_instance_history'
                                    )}
                                    className="text-muted-foreground hover:text-foreground size-6 p-0"
                                    disabled={
                                        loadingPreviousInstancesKey === rowKey
                                    }
                                    onClick={() => {
                                        onOpenPreviousInstances(row.original);
                                    }}
                                >
                                    {loadingPreviousInstancesKey === rowKey ? (
                                        <Spinner data-icon="inline-start" />
                                    ) : (
                                        <FileTextIcon data-icon="inline-start" />
                                    )}
                                </Button>
                            ) : null}
                        </div>
                    );
                }
            }
        ],
        [
            deletingGameLogKey,
            loadingPreviousInstancesKey,
            onCopyDetail,
            onDeleteRow,
            onOpenPreviousInstances,
            shiftHeld,
            t
        ]
    );
}
