import {
    HeartIcon,
    LogInIcon,
    LogOutIcon,
    MapPinIcon,
    PlayIcon,
    SettingsIcon,
    WaypointsIcon
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Location } from '@/components/Location';
import { userFacingErrorMessage } from '@/lib/errorDisplay';
import { cn } from '@/lib/utils';
import { GAME_LOG_FILTER_TYPES } from '@/repositories/gameLogRepository';
import gameLogRepository from '@/repositories/gameLogRepository';
import { openUserDialog } from '@/services/dialogService';
import { openExternalLink } from '@/services/entityMediaService';
import { normalizeString } from '@/shared/utils/string';
import { useFavoriteStore } from '@/state/favoriteStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';
import { Spinner } from '@/ui/shadcn/spinner';
import { Table, TableBody, TableCell, TableRow } from '@/ui/shadcn/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import { DashboardWidgetEmptyState } from './DashboardWidgetEmptyState';
import { DashboardWidgetHeader } from './DashboardWidgetHeader';
import {
    buildFavoriteIdSet,
    formatWidgetExactTime,
    formatWidgetTime,
    getNextDashboardWidgetFilterConfig,
    isDashboardWidgetFilterActive
} from './dashboardWidgetUtils';

const GAME_LOG_WIDGET_MAX_ROWS = 200;

function openGameLogWidgetUser(row: any) {
    const userId = normalizeString(row?.userId);
    if (!userId) {
        return;
    }
    openUserDialog({
        userId,
        title: row?.displayName || undefined,
        seedData: row
    });
}

function GameLogWidgetUserName({ row, className = '' }: any) {
    const displayName = row?.displayName || '';
    const userId = normalizeString(row?.userId);
    if (!userId) {
        return <span className={className}>{displayName}</span>;
    }

    return (
        <Button
            type="button"
            variant="ghost"
            className={cn(
                'hover:text-primary h-auto min-w-0 cursor-pointer justify-start p-0 text-left font-normal',
                className
            )}
            onClick={() => openGameLogWidgetUser(row)}
        >
            {displayName}
        </Button>
    );
}

function GameLogWidgetLocation({ row }: any) {
    if (!row?.location) {
        return (
            <span className="text-muted-foreground">
                {row?.worldName || ''}
            </span>
        );
    }

    return (
        <div className="min-w-0 flex-1 truncate">
            <Location
                location={row.location}
                hint={row.worldName || ''}
                grouphint={row.groupName || ''}
                enableContextMenu
                disableTooltip
            />
        </div>
    );
}

function GameLogEntryContent({ row, showDetail }: any) {
    switch (row?.type) {
        case 'Location':
            return (
                <div className="flex min-w-0 items-center">
                    <MapPinIcon className="text-muted-foreground mr-1 size-3.5 shrink-0" />
                    <GameLogWidgetLocation row={row} />
                </div>
            );
        case 'OnPlayerJoined':
            return (
                <div className="flex min-w-0 items-center">
                    <LogInIcon className="text-muted-foreground mr-1 size-3.5 shrink-0" />
                    <GameLogWidgetUserName row={row} />
                    {row?.isFriend ? (
                        <span className="ml-1">
                            {row?.isFavorite ? '⭐' : '💚'}
                        </span>
                    ) : null}
                </div>
            );
        case 'OnPlayerLeft':
            return (
                <div className="flex min-w-0 items-center">
                    <LogOutIcon className="text-muted-foreground mr-1 size-3.5 shrink-0" />
                    <GameLogWidgetUserName
                        row={row}
                        className="text-muted-foreground/70"
                    />
                    {row?.isFriend ? (
                        <span className="ml-1">
                            {row?.isFavorite ? '⭐' : '💚'}
                        </span>
                    ) : null}
                </div>
            );
        case 'PortalSpawn':
            return (
                <div className="flex min-w-0 items-center">
                    <WaypointsIcon className="text-muted-foreground mr-1 size-3.5 shrink-0" />
                    <GameLogWidgetUserName row={row} />
                    <span className="text-muted-foreground mx-1 shrink-0">
                        →
                    </span>
                    <GameLogWidgetLocation row={row} />
                </div>
            );
        case 'VideoPlay': {
            const videoLabel = row?.videoName || row?.videoUrl || '';
            const canOpenVideo = Boolean(
                row?.videoUrl &&
                row?.videoId !== 'LSMedia' &&
                row?.videoId !== 'PopcornPalace'
            );
            return (
                <Tooltip>
                    <TooltipTrigger asChild>
                        <div className="flex min-w-0 items-center">
                            <PlayIcon className="text-muted-foreground mr-1 size-3.5 shrink-0" />
                            {row?.videoId ? (
                                <span className="text-muted-foreground mr-1 shrink-0">
                                    {row.videoId}:
                                </span>
                            ) : null}
                            {canOpenVideo ? (
                                <Button
                                    type="button"
                                    variant="link"
                                    className="text-muted-foreground h-auto min-w-0 justify-start p-0 text-left font-normal"
                                    onClick={() => {
                                        openExternalLink(row.videoUrl);
                                    }}
                                >
                                    <span className="truncate">
                                        {videoLabel}
                                    </span>
                                </Button>
                            ) : (
                                <span className="text-muted-foreground min-w-0 truncate">
                                    {videoLabel}
                                </span>
                            )}
                        </div>
                    </TooltipTrigger>
                    <TooltipContent>
                        {row?.videoId
                            ? `${row.videoId}: ${videoLabel}`
                            : videoLabel}
                    </TooltipContent>
                </Tooltip>
            );
        }
        default:
            return (
                <div className="flex min-w-0 items-center">
                    <span className="truncate">{row?.displayName || ''}</span>
                    <span className="text-muted-foreground ml-1 shrink-0">
                        {row?.type || ''}
                    </span>
                    {showDetail && (row?.data || row?.message) ? (
                        <span className="text-muted-foreground ml-1 min-w-0 truncate">
                            — {row.data || row.message}
                        </span>
                    ) : null}
                </div>
            );
    }
}

export function DashboardGameLogWidget({
    config = {},
    configUpdater = null
}: any) {
    const { t } = useTranslation();
    const currentUserId = useRuntimeStore(
        (state: any) => state.auth.currentUserId
    );
    const addGameLogEventCount = useRuntimeStore(
        (state: any) => state.runtimeEvents.addGameLogEvent.count
    );
    const remoteFavoriteFriendIds = useFavoriteStore(
        (state: any) => state.favoriteFriendIds
    );
    const localFriendFavorites = useFavoriteStore(
        (state: any) => state.localFriendFavorites
    );

    const [rows, setRows] = useState<any[]>([]);
    const [loadStatus, setLoadStatus] = useState('idle');
    const [detail, setDetail] = useState('');

    const favoriteIdSet = useMemo(
        () => buildFavoriteIdSet(remoteFavoriteFriendIds, localFriendFavorites),
        [localFriendFavorites, remoteFavoriteFriendIds]
    );

    useEffect(() => {
        let active = true;

        if (!currentUserId) {
            setRows([]);
            setLoadStatus('idle');
            setDetail('');
            return () => {
                active = false;
            };
        }

        setLoadStatus('running');
        setDetail('');

        gameLogRepository
            .queryGameLog({
                currentUserId,
                filters: Array.isArray(config.filters) ? config.filters : []
            })
            .then((nextRows: any) => {
                if (!active) {
                    return;
                }

                setRows(
                    Array.isArray(nextRows)
                        ? nextRows.slice(0, GAME_LOG_WIDGET_MAX_ROWS)
                        : []
                );
                setLoadStatus('ready');
                setDetail('');
            })
            .catch((error: any) => {
                if (!active) {
                    return;
                }

                setRows([]);
                setLoadStatus('error');
                setDetail(
                    userFacingErrorMessage(
                        error,
                        'Failed to load game-log widget.'
                    )
                );
            });

        return () => {
            active = false;
        };
    }, [addGameLogEventCount, config.filters, currentUserId]);

    const annotatedRows = useMemo(
        () =>
            rows.map((row: any) => {
                const normalizedUserId = normalizeString(row?.userId);
                return {
                    ...row,
                    isFavorite: normalizedUserId
                        ? favoriteIdSet.has(normalizedUserId)
                        : false
                };
            }),
        [favoriteIdSet, rows]
    );

    const showDetail = Boolean(config.showDetail);
    const settingsMenu = configUpdater ? (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={'Widget settings'}
                >
                    <SettingsIcon data-icon="inline-start" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuGroup>
                    {GAME_LOG_FILTER_TYPES.map((filterType: any) => (
                        <DropdownMenuCheckboxItem
                            key={filterType}
                            checked={isDashboardWidgetFilterActive(
                                config,
                                filterType
                            )}
                            onSelect={(event: any) => event.preventDefault()}
                            onCheckedChange={() =>
                                configUpdater(
                                    getNextDashboardWidgetFilterConfig(
                                        config,
                                        filterType,
                                        GAME_LOG_FILTER_TYPES
                                    )
                                )
                            }
                        >
                            {t(`view.game_log.filters.${filterType}`)}
                        </DropdownMenuCheckboxItem>
                    ))}
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                    <DropdownMenuCheckboxItem
                        checked={showDetail}
                        onSelect={(event: any) => event.preventDefault()}
                        onCheckedChange={(checked: any) =>
                            configUpdater({
                                ...config,
                                showDetail: Boolean(checked)
                            })
                        }
                    >
                        {t('dashboard.widget.config.detail')}
                    </DropdownMenuCheckboxItem>
                </DropdownMenuGroup>
            </DropdownMenuContent>
        </DropdownMenu>
    ) : null;
    const renderShell = (children: any) => (
        <div className="flex h-full min-h-0 flex-col">
            <DashboardWidgetHeader
                title={t('dashboard.widget.game_log')}
                icon="ri-history-line"
                path="/game-log"
            >
                {settingsMenu}
            </DashboardWidgetHeader>
            {children}
        </div>
    );

    if (!currentUserId) {
        return renderShell(
            <DashboardWidgetEmptyState
                title={t('view.dashboard.error.game_log_unavailable')}
                description={t(
                    'view.dashboard.label.sign_in_before_the_dashboard_can_query_game_log_rows'
                )}
            />
        );
    }

    if (loadStatus === 'error') {
        return renderShell(
            <DashboardWidgetEmptyState
                title={t('view.dashboard.error.game_log_widget_failed')}
                description={userFacingErrorMessage(
                    detail,
                    'The local game-log query did not complete.'
                )}
            />
        );
    }

    if (loadStatus === 'running' && annotatedRows.length === 0) {
        return renderShell(
            <div className="text-muted-foreground flex min-h-[180px] flex-1 items-center justify-center gap-2 text-sm">
                <Spinner />
                {t('view.dashboard.loading.loading_game_log_widget')}
            </div>
        );
    }

    if (!annotatedRows.length) {
        return renderShell(
            <DashboardWidgetEmptyState
                title={t('view.dashboard.empty.no_game_log_rows')}
                description={t(
                    'view.dashboard.label.the_current_filter_set_did_not_return_any_recent_game_log_activity'
                )}
            />
        );
    }

    return renderShell(
        <>
            <div className="text-muted-foreground flex flex-wrap gap-2 px-3 pt-3 text-xs">
                <span>
                    {annotatedRows.length}{' '}
                    {t('view.dashboard.label.recent_rows')}
                </span>
                <span>
                    {Array.isArray(config.filters) && config.filters.length
                        ? `${config.filters.length} type filters`
                        : 'All game-log types'}
                </span>
                {showDetail ? (
                    <span>{t('view.dashboard.label.detail_expanded')}</span>
                ) : null}
            </div>

            <div className="min-h-0 flex-1 overflow-auto">
                <Table className="app-data-table table-fixed">
                    <TableBody>
                        {annotatedRows.map((row: any, index: any) => {
                            return (
                                <TableRow
                                    key={`${row.type || 'gamelog'}-${row.created_at || index}-${index}`}
                                >
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <TableCell className="text-muted-foreground w-24 align-top text-xs tabular-nums">
                                                {formatWidgetTime(
                                                    row.created_at
                                                )}
                                            </TableCell>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                            {formatWidgetExactTime(
                                                row.created_at
                                            )}
                                        </TooltipContent>
                                    </Tooltip>
                                    <TableCell className="w-24 align-top">
                                        <Badge
                                            variant="outline"
                                            className="text-xs"
                                        >
                                            {row.type || ''}
                                        </Badge>
                                    </TableCell>
                                    <TableCell className="align-top">
                                        <div className="flex min-w-0 items-center gap-2 text-sm">
                                            <div className="min-w-0 flex-1 truncate">
                                                <GameLogEntryContent
                                                    row={row}
                                                    showDetail={showDetail}
                                                />
                                            </div>
                                            {row.isFavorite ? (
                                                <Badge
                                                    variant="secondary"
                                                    className="shrink-0 gap-1 px-1.5"
                                                >
                                                    <HeartIcon className="size-3 fill-current" />
                                                    {t(
                                                        'view.dashboard.label.favorite'
                                                    )}
                                                </Badge>
                                            ) : null}
                                        </div>
                                    </TableCell>
                                </TableRow>
                            );
                        })}
                    </TableBody>
                </Table>
            </div>
        </>
    );
}
