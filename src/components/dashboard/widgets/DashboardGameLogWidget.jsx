import { useEffect, useMemo, useState } from 'react';
import {
    HeartIcon,
    LoaderCircleIcon,
    LogInIcon,
    LogOutIcon,
    MapPinIcon,
    PlayIcon,
    SettingsIcon,
    WaypointsIcon
} from 'lucide-react';

import { useI18n } from '@/app/hooks/use-i18n.js';
import { Location } from '@/components/Location.jsx';
import { openExternalLink } from '@/lib/entityMedia.js';
import { GAME_LOG_FILTER_TYPES, gameLogRepository } from '@/repositories/index.js';
import { openUserDialog } from '@/services/dialogService.js';
import { useFavoriteStore } from '@/state/favoriteStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { Badge } from '@/ui/shadcn/badge.jsx';
import { Button } from '@/ui/shadcn/button.jsx';
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu.jsx';
import {
    Table,
    TableBody,
    TableCell,
    TableRow
} from '@/ui/shadcn/table.jsx';

import {
    buildFavoriteIdSet,
    formatWidgetExactTime,
    formatWidgetTime,
    getNextDashboardWidgetFilterConfig,
    isDashboardWidgetFilterActive,
    normalizeString
} from './shared.js';
import { DashboardWidgetEmptyState } from './DashboardWidgetEmptyState.jsx';
import { DashboardWidgetHeader } from './DashboardWidgetHeader.jsx';

const GAME_LOG_WIDGET_MAX_ROWS = 200;

function openGameLogWidgetUser(row) {
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

function GameLogWidgetUserName({ row, className = '' }) {
    const displayName = row?.displayName || '';
    const userId = normalizeString(row?.userId);
    if (!userId) {
        return <span className={className}>{displayName}</span>;
    }

    return (
        <button
            type="button"
            className={`cursor-pointer text-left hover:underline ${className}`}
            onClick={() => openGameLogWidgetUser(row)}>
            {displayName}
        </button>
    );
}

function GameLogWidgetLocation({ row }) {
    if (!row?.location) {
        return <span className="text-muted-foreground">{row?.worldName || ''}</span>;
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

function GameLogEntryContent({ row, showDetail }) {
    switch (row?.type) {
        case 'Location':
            return (
                <div className="flex min-w-0 items-center">
                    <MapPinIcon className="mr-1 size-3.5 shrink-0 text-muted-foreground" />
                    <GameLogWidgetLocation row={row} />
                </div>
            );
        case 'OnPlayerJoined':
            return (
                <div className="flex min-w-0 items-center">
                    <LogInIcon className="mr-1 size-3.5 shrink-0 text-muted-foreground" />
                    <GameLogWidgetUserName row={row} />
                    {row?.isFriend ? <span className="ml-1">{row?.isFavorite ? '⭐' : '💚'}</span> : null}
                </div>
            );
        case 'OnPlayerLeft':
            return (
                <div className="flex min-w-0 items-center">
                    <LogOutIcon className="mr-1 size-3.5 shrink-0 text-muted-foreground" />
                    <GameLogWidgetUserName row={row} className="text-muted-foreground/70" />
                    {row?.isFriend ? <span className="ml-1">{row?.isFavorite ? '⭐' : '💚'}</span> : null}
                </div>
            );
        case 'PortalSpawn':
            return (
                <div className="flex min-w-0 items-center">
                    <WaypointsIcon className="mr-1 size-3.5 shrink-0 text-muted-foreground" />
                    <GameLogWidgetUserName row={row} />
                    <span className="mx-1 shrink-0 text-muted-foreground">→</span>
                    <GameLogWidgetLocation row={row} />
                </div>
            );
        case 'VideoPlay': {
            const videoLabel = row?.videoName || row?.videoUrl || '';
            const canOpenVideo = Boolean(row?.videoUrl && row?.videoId !== 'LSMedia' && row?.videoId !== 'PopcornPalace');
            return (
                <div
                    className="flex min-w-0 items-center"
                    title={row?.videoId ? `${row.videoId}: ${videoLabel}` : videoLabel}>
                    <PlayIcon className="mr-1 size-3.5 shrink-0 text-muted-foreground" />
                    {row?.videoId ? <span className="mr-1 shrink-0 text-muted-foreground">{row.videoId}:</span> : null}
                    {canOpenVideo ? (
                        <button
                            type="button"
                            className="min-w-0 truncate text-left text-muted-foreground hover:underline"
                            onClick={() => void openExternalLink(row.videoUrl)}>
                            {videoLabel}
                        </button>
                    ) : (
                        <span className="min-w-0 truncate text-muted-foreground">{videoLabel}</span>
                    )}
                </div>
            );
        }
        default:
            return (
                <div className="flex min-w-0 items-center">
                    <span className="truncate">{row?.displayName || ''}</span>
                    <span className="ml-1 shrink-0 text-muted-foreground">{row?.type || ''}</span>
                    {showDetail && (row?.data || row?.message) ? (
                        <span className="ml-1 min-w-0 truncate text-muted-foreground">
                            — {row.data || row.message}
                        </span>
                    ) : null}
                </div>
            );
    }
}

export function DashboardGameLogWidget({ config = {}, configUpdater = null }) {
    const { t } = useI18n();
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const addGameLogEventCount = useRuntimeStore(
        (state) => state.backendEvents.addGameLogEvent.count
    );
    const remoteFavoriteFriendIds = useFavoriteStore((state) => state.favoriteFriendIds);
    const localFriendFavorites = useFavoriteStore((state) => state.localFriendFavorites);

    const [rows, setRows] = useState([]);
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
                filters: Array.isArray(config.filters) ? config.filters : []
            })
            .then((nextRows) => {
                if (!active) {
                    return;
                }

                setRows(Array.isArray(nextRows) ? nextRows.slice(0, GAME_LOG_WIDGET_MAX_ROWS) : []);
                setLoadStatus('ready');
                setDetail('');
            })
            .catch((error) => {
                if (!active) {
                    return;
                }

                setRows([]);
                setLoadStatus('error');
                setDetail(
                    error instanceof Error ? error.message : 'Failed to load game-log widget.'
                );
            });

        return () => {
            active = false;
        };
    }, [addGameLogEventCount, config.filters, currentUserId]);

    const annotatedRows = useMemo(
        () =>
            rows.map((row) => {
                const normalizedUserId = normalizeString(row?.userId);
                return {
                    ...row,
                    isFavorite: normalizedUserId ? favoriteIdSet.has(normalizedUserId) : false
                };
            }),
        [favoriteIdSet, rows]
    );

    const showDetail = Boolean(config.showDetail);
    const settingsMenu = configUpdater ? (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button type="button" variant="ghost" size="icon-sm">
                    <SettingsIcon className="size-3.5" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
                {GAME_LOG_FILTER_TYPES.map((filterType) => (
                    <DropdownMenuCheckboxItem
                        key={filterType}
                        checked={isDashboardWidgetFilterActive(config, filterType)}
                        onSelect={(event) => event.preventDefault()}
                        onCheckedChange={() =>
                            configUpdater(
                                getNextDashboardWidgetFilterConfig(config, filterType, GAME_LOG_FILTER_TYPES)
                            )
                        }>
                        {t(`view.game_log.filters.${filterType}`)}
                    </DropdownMenuCheckboxItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuCheckboxItem
                    checked={showDetail}
                    onSelect={(event) => event.preventDefault()}
                    onCheckedChange={(checked) => configUpdater({ ...config, showDetail: Boolean(checked) })}>
                    {t('dashboard.widget.config.detail')}
                </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
        </DropdownMenu>
    ) : null;
    const renderShell = (children) => (
        <div className="flex h-full min-h-0 flex-col">
            <DashboardWidgetHeader title={t('dashboard.widget.game_log')} icon="ri-history-line" path="/game-log">
                {settingsMenu}
            </DashboardWidgetHeader>
            {children}
        </div>
    );

    if (!currentUserId) {
        return renderShell(
            <DashboardWidgetEmptyState
                title="Game log unavailable"
                description="Sign in before the dashboard can query game-log rows."
            />
        );
    }

    if (loadStatus === 'error') {
        return renderShell(
            <DashboardWidgetEmptyState
                title="Game log widget failed"
                description={detail || 'The local game-log query did not complete.'}
            />
        );
    }

    if (loadStatus === 'running' && annotatedRows.length === 0) {
        return renderShell(
            <div className="flex min-h-[180px] flex-1 items-center justify-center text-sm text-muted-foreground">
                <LoaderCircleIcon className="mr-2 size-4 animate-spin" />
                Loading game log widget
            </div>
        );
    }

    if (!annotatedRows.length) {
        return renderShell(
            <DashboardWidgetEmptyState
                title="No game-log rows"
                description="The current filter set did not return any recent game-log activity."
            />
        );
    }

    return renderShell(
        <>

            <div className="flex flex-wrap gap-2 px-3 pt-3 text-xs text-muted-foreground">
                <span>{annotatedRows.length} recent rows</span>
                <span>
                    {Array.isArray(config.filters) && config.filters.length
                        ? `${config.filters.length} type filters`
                        : 'All game-log types'}
                </span>
                {showDetail ? <span>Detail expanded</span> : null}
            </div>

            <div className="min-h-0 flex-1 overflow-auto">
                <Table className="vrcx-data-table table-fixed">
                    <TableBody>
                        {annotatedRows.map((row, index) => {
                            return (
                                <TableRow
                                    key={`${row.type || 'gamelog'}-${row.created_at || index}-${index}`}>
                                    <TableCell
                                        className="w-24 align-top text-[11px] tabular-nums text-muted-foreground"
                                        title={formatWidgetExactTime(row.created_at)}>
                                        {formatWidgetTime(row.created_at)}
                                    </TableCell>
                                    <TableCell className="w-24 align-top">
                                        <Badge variant="outline" className="text-[11px]">
                                            {row.type || ''}
                                        </Badge>
                                    </TableCell>
                                    <TableCell className="align-top">
                                        <div className="flex min-w-0 items-center gap-2 text-sm">
                                            <div className="min-w-0 flex-1 truncate">
                                                <GameLogEntryContent row={row} showDetail={showDetail} />
                                            </div>
                                            {row.isFavorite ? (
                                                <Badge variant="secondary" className="shrink-0 gap-1 px-1.5">
                                                    <HeartIcon className="size-3 fill-current" />
                                                    Favorite
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
