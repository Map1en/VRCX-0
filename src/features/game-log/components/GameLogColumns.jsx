import {
    CopyIcon,
    ExternalLinkIcon,
    FileTextIcon,
    Trash2Icon,
    XIcon
} from 'lucide-react';

import { formatDateFilter } from '@/lib/dateTime.js';
import { openExternalLink } from '@/lib/entityMedia.js';
import { openWorldDialog } from '@/services/dialogService.js';
import { Button } from '@/ui/shadcn/button';
import { Badge } from '@/ui/shadcn/badge';
import { Spinner } from '@/ui/shadcn/spinner';

import {
    canDeleteGameLogRow,
    describeGameLogDetail,
    GAME_LOG_DETAILLESS_TYPES,
    getGameLogCopyTarget,
    getGameLogExternalTarget,
    getGameLogRowKey,
    resolveGameLogWorldId as resolveWorldId,
    resolveGameLogWorldTarget as resolveWorldTarget,
    shouldLinkGameLogPrimaryDetailToWorld as shouldLinkPrimaryDetailToWorld
} from '../gameLogRows.js';
import {
    EmptyTableValue,
    GameLogLocationDetail,
    SortButton
} from './GameLogTableParts.jsx';

export function buildGameLogColumns({
    deletingGameLogKey,
    loadingPreviousInstancesKey,
    onCopyDetail,
    onDeleteRow,
    onOpenPreviousInstances,
    onOpenUser,
    shiftHeld,
    t
}) {
    return [
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
            accessorFn: (row) => row?.created_at || '',
            header: ({ column }) => (
                <SortButton column={column} label={t('table.gameLog.date')} />
            ),
            sortingFn: (rowA, rowB) => {
                const leftTs = Date.parse(rowA.original?.created_at ?? '');
                const rightTs = Date.parse(rowB.original?.created_at ?? '');
                if (
                    Number.isFinite(leftTs) &&
                    Number.isFinite(rightTs) &&
                    leftTs !== rightTs
                ) {
                    return leftTs - rightTs;
                }

                return (
                    (Number.parseInt(rowA.original?.rowId ?? 0, 10) || 0) -
                    (Number.parseInt(rowB.original?.rowId ?? 0, 10) || 0)
                );
            },
            cell: ({ row }) => {
                const createdAt = row.original?.created_at || '';
                return (
                    <span
                        className="text-sm"
                        title={formatDateFilter(createdAt, 'long')}
                    >
                        {formatDateFilter(createdAt, 'short')}
                    </span>
                );
            }
        },
        {
            id: 'type',
            size: 150,
            accessorFn: (row) => row?.type || '',
            header: ({ column }) => (
                <SortButton column={column} label={t('table.gameLog.type')} />
            ),
            cell: ({ row }) => {
                const worldTarget = resolveWorldTarget(row.original);
                const typeLabel = row.original?.type
                    ? t(`view.game_log.filters.${row.original.type}`)
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
                                        row.original?.worldName || worldTarget
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
            accessorFn: (row) => row?.displayName || row?.userId || '',
            header: ({ column }) => (
                <SortButton column={column} label={t('table.gameLog.user')} />
            ),
            sortingFn: (rowA, rowB) =>
                String(
                    rowA.original?.displayName || rowA.original?.userId || ''
                ).localeCompare(
                    String(
                        rowB.original?.displayName || rowB.original?.userId || ''
                    ),
                    undefined,
                    { sensitivity: 'base' }
                ),
            cell: ({ row }) => {
                const displayName = row.original?.displayName || '';
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
                                onClick={() => void onOpenUser(row.original)}
                            >
                                <span className="truncate">{displayName}</span>
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
            accessorFn: (row) => {
                const detailValue = describeGameLogDetail(row);
                return [detailValue.primary, detailValue.secondary]
                    .filter(Boolean)
                    .join(' ');
            },
            enableSorting: false,
            header: () => t('table.gameLog.detail'),
            cell: ({ row }) => {
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
                            onPreviousInstances={(targetRow) =>
                                void onOpenPreviousInstances(targetRow)
                            }
                        />
                    );
                }
                if (GAME_LOG_DETAILLESS_TYPES.has(row.original?.type)) {
                    return <EmptyTableValue />;
                }
                const canOpenWorld =
                    worldTarget && shouldLinkPrimaryDetailToWorld(row.original);
                const externalTarget = getGameLogExternalTarget(row.original);
                const copyTarget = getGameLogCopyTarget(row.original);
                if (
                    !detailValue.primary &&
                    !detailValue.secondary &&
                    !externalTarget &&
                    !copyTarget
                ) {
                    return <EmptyTableValue />;
                }
                return (
                    <div
                        className="flex min-w-0 items-center gap-1.5 text-sm"
                        title={[detailValue.primary, detailValue.secondary]
                            .filter(Boolean)
                            .join(' \u00b7 ')}
                    >
                        {canOpenWorld ? (
                            <Button
                                type="button"
                                variant="ghost"
                                className="hover:text-primary h-auto min-w-0 p-0 text-left text-sm"
                                onClick={() =>
                                    openWorldDialog({
                                        worldId: worldTarget,
                                        title:
                                            row.original?.worldName ||
                                            detailValue.primary ||
                                            worldTarget
                                    })
                                }
                            >
                                <span className="truncate">
                                    {detailValue.primary}
                                </span>
                            </Button>
                        ) : (
                            <span className="min-w-0 truncate">
                                {detailValue.primary}
                            </span>
                        )}
                        {detailValue.secondary ? (
                            <span className="text-muted-foreground min-w-0 truncate text-xs">
                                {detailValue.secondary}
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
                                            'view.game_log.generated.open_link'
                                        )}
                                        className="size-6 p-0"
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            void openExternalLink(
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
                                            'view.game_log.generated.copy_detail'
                                        )}
                                        className="size-6 p-0"
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            void onCopyDetail(row.original);
                                        }}
                                    >
                                        <CopyIcon data-icon="inline-start" />
                                    </Button>
                                ) : null}
                            </div>
                        ) : null}
                    </div>
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
            cell: ({ row }) => {
                const rowKey = getGameLogRowKey(row.original);
                const canDelete = canDeleteGameLogRow(row.original);
                const canShowPrevious =
                    row.original?.type === 'Location' &&
                    resolveWorldId(row.original);

                if (!canDelete && !canShowPrevious) {
                    return <EmptyTableValue align="right" />;
                }

                return (
                    <div className="flex items-center justify-end gap-2">
                        {canDelete ? (
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                aria-label={
                                    shiftHeld
                                        ? `${t('view.game_log.generated_modal.delete_game_log_row')} (${t('dialog.groups.generated.hold_shift')})`
                                        : t(
                                              'view.game_log.generated_modal.delete_game_log_row'
                                          )
                                }
                                className="text-muted-foreground hover:text-destructive size-6 p-0"
                                disabled={deletingGameLogKey === rowKey}
                                onClick={(event) =>
                                    void onDeleteRow(row.original, {
                                        skipConfirm: shiftHeld || event.shiftKey
                                    })
                                }
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
                                    'view.game_log.generated.show_instance_history'
                                )}
                                className="text-muted-foreground hover:text-foreground size-6 p-0"
                                disabled={loadingPreviousInstancesKey === rowKey}
                                onClick={() =>
                                    void onOpenPreviousInstances(row.original)
                                }
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
    ];
}
