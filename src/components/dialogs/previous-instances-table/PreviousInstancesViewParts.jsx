import { ArrowLeftIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useTranslation } from 'react-i18next';
import { timeToText } from '@/lib/dateTime.js';
import {
    gameLogRepository,
    userProfileRepository
} from '@/repositories/index.js';
import { openUserDialog } from '@/services/dialogService.js';
import { getResolvedThemeMode } from '@/services/themeService.js';
import { useFavoriteStore } from '@/state/favoriteStore.js';
import { useFriendRosterStore } from '@/state/friendRosterStore.js';
import { usePreferencesStore } from '@/state/preferencesStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { useShellStore } from '@/state/shellStore.js';
import { Alert, AlertDescription } from '@/ui/shadcn/alert';
import { Button } from '@/ui/shadcn/button';
import {
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyTitle
} from '@/ui/shadcn/empty';
import { Spinner } from '@/ui/shadcn/spinner';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from '@/ui/shadcn/table';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/shadcn/tabs';
import {
    INFO_CHART_BAR_WIDTH,
    buildInfoChartOption,
    buildInfoChartTooltipParts
} from './previousInstancesChart.js';
import {
    normalizeInfoChartRows,
    normalizePlayerRows,
    playerDisplayName,
    playerUserId,
    rowDuration,
    rowLocation,
    rowOwnerUserId
} from './previousInstancesRows.js';

export function formatDate(value) {
    if (!value) {
        return '-';
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return String(value);
    }
    return new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short'
    }).format(date);
}

export function DialogEmptyState({ title, description, className = '' }) {
    return (
        <Empty
            className={['min-h-52 border', className].filter(Boolean).join(' ')}
        >
            <EmptyHeader>
                <EmptyTitle>{title}</EmptyTitle>
                {description ? (
                    <EmptyDescription>{description}</EmptyDescription>
                ) : null}
            </EmptyHeader>
        </Empty>
    );
}

export function DialogErrorState({ children }) {
    return (
        <Alert variant="destructive">
            <AlertDescription>{children}</AlertDescription>
        </Alert>
    );
}

function createInfoChartTooltipElement(detailEntry, hour12) {
    const parts = buildInfoChartTooltipParts(detailEntry, hour12);
    const container = document.createElement('div');
    container.className = 'min-w-44';

    const title = document.createElement('div');
    title.style.fontWeight = '600';
    title.style.marginBottom = '4px';
    title.textContent = parts.title;
    container.appendChild(title);

    const timeRange = document.createElement('div');
    timeRange.textContent = parts.timeRange;
    container.appendChild(timeRange);

    const duration = document.createElement('div');
    duration.textContent = parts.duration;
    container.appendChild(duration);

    return container;
}

export function InstanceOwnerCell({ userId, location = '', endpoint = '' }) {
    const [displayName, setDisplayName] = useState(userId || '');

    useEffect(() => {
        let active = true;
        if (!userId) {
            setDisplayName('');
            return () => {
                active = false;
            };
        }

        setDisplayName(userId);
        userProfileRepository
            .getUserProfile({ userId, endpoint })
            .then((profile) => {
                if (!active) {
                    return;
                }
                setDisplayName(
                    profile?.displayName ||
                        profile?.username ||
                        profile?.name ||
                        userId
                );
            })
            .catch(() => {});

        return () => {
            active = false;
        };
    }, [endpoint, userId]);

    if (!userId) {
        return <span className="text-muted-foreground">-</span>;
    }

    return (
        <Button
            type="button"
            variant="ghost"
            className="h-auto max-w-full flex-col items-start justify-start gap-0 p-0 text-left text-xs hover:text-primary"
            title={[displayName || userId, userId, location]
                .filter(Boolean)
                .join('\n')}
            onClick={() =>
                openUserDialog({ userId, title: displayName || undefined })
            }
        >
            <span className="truncate">{displayName || userId}</span>
            {displayName && displayName !== userId ? (
                <span className="text-muted-foreground max-w-full truncate text-xs">
                    {userId}
                </span>
            ) : null}
        </Button>
    );
}

function PreviousInstanceInfoChart({ rows }) {
    const { t } = useTranslation();

    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const friendsById = useFriendRosterStore((state) => state.friendsById);
    const favoriteFriendIds = useFavoriteStore(
        (state) => state.favoriteFriendIds
    );
    const localFriendFavoritesList = useFavoriteStore(
        (state) => state.localFriendFavoritesList
    );
    const shellThemeMode = useShellStore((state) => state.themeMode);
    const resolvedTheme = getResolvedThemeMode(shellThemeMode);
    const hour12 = usePreferencesStore((state) => state.dtHour12);

    const [chartElement, setChartElement] = useState(null);
    const chartElementRef = useRef(null);
    const chartInstanceRef = useRef(null);
    const chartThemeRef = useRef(null);
    const echartsRef = useRef(null);
    const resizeObserverRef = useRef(null);

    const favoriteIdSet = useMemo(
        () =>
            new Set(
                [
                    ...(favoriteFriendIds || []),
                    ...(localFriendFavoritesList || [])
                ].filter(Boolean)
            ),
        [favoriteFriendIds, localFriendFavoritesList]
    );
    const chartRows = useMemo(
        () =>
            normalizeInfoChartRows(
                rows,
                currentUserId,
                friendsById,
                favoriteIdSet
            ),
        [currentUserId, favoriteIdSet, friendsById, rows]
    );
    const chartPayload = useMemo(
        () =>
            buildInfoChartOption({
                rows: chartRows,
                hour12,
                tooltipFormatter: createInfoChartTooltipElement
            }),
        [chartRows, hour12]
    );

    const setInfoChartElementRef = useCallback((node) => {
        if (chartElementRef.current && chartElementRef.current !== node) {
            resizeObserverRef.current?.disconnect();
            chartInstanceRef.current?.dispose();
            resizeObserverRef.current = null;
            chartInstanceRef.current = null;
            chartThemeRef.current = null;
        }
        chartElementRef.current = node;
        setChartElement(node);
    }, []);

    useEffect(
        () => () => {
            resizeObserverRef.current?.disconnect();
            chartInstanceRef.current?.dispose();
            resizeObserverRef.current = null;
            chartInstanceRef.current = null;
            chartThemeRef.current = null;
        },
        []
    );

    useEffect(() => {
        if (!chartElement) {
            return;
        }

        let cancelled = false;

        async function renderChart() {
            const echarts =
                echartsRef.current || (await import('echarts'));
            if (cancelled || chartElementRef.current !== chartElement) {
                return;
            }
            echartsRef.current = echarts;

            const themeName = resolvedTheme === 'dark' ? 'dark' : null;
            let chart = chartInstanceRef.current;

            if (!chart || chartThemeRef.current !== themeName) {
                resizeObserverRef.current?.disconnect();
                chart?.dispose();

                chart = echarts.init(chartElement, themeName || undefined, {
                    useDirtyRect: chartRows.length > 80
                });
                chartInstanceRef.current = chart;
                chartThemeRef.current = themeName;

                resizeObserverRef.current = new ResizeObserver(() => {
                    chart.resize();
                });
                resizeObserverRef.current.observe(chartElement);
            }

            const chartRowCount =
                chartPayload?.firstEntries.length || chartRows.length;
            const chartHeight = Math.max(
                220,
                chartRowCount * (INFO_CHART_BAR_WIDTH + 10) + 200
            );
            chartElement.style.height = `${chartHeight}px`;
            chart.resize({ height: chartHeight });
            chart.off('click');

            if (!chartPayload) {
                chart.clear();
                return;
            }

            chart.clear();
            chart.setOption(chartPayload.option, { notMerge: true });
            chart.on('click', (params) => {
                if (params.componentType !== 'yAxis') {
                    return;
                }
                const entry = chartPayload.firstEntries[params.dataIndex];
                if (entry?.userId) {
                    openUserDialog({
                        userId: entry.userId,
                        title: entry.displayName || undefined
                    });
                }
            });
        }

        renderChart().catch((error) => {
            console.error(
                '[PreviousInstancesTableDialog] Failed to load chart renderer.',
                error
            );
        });

        return () => {
            cancelled = true;
        };
    }, [chartElement, chartPayload, chartRows.length, resolvedTheme]);

    if (!chartRows.length) {
        return (
            <DialogEmptyState
                title={t(
                    'dialog.previous_instances.generated.no_player_detail_rows'
                )}
                description={t(
                    'dialog.previous_instances.generated.there_are_no_timeline_rows_for_this_instance'
                )}
            />
        );
    }

    return (
        <div ref={setInfoChartElementRef} className="w-full bg-transparent" />
    );
}

export function PreviousInstanceDetailsPanel({
    row,
    onBack = null,
    showTitle = true,
    className = ''
}) {
    const { t } = useTranslation();

    const currentEndpoint = useRuntimeStore(
        (state) => state.auth.currentUserEndpoint
    );
    const [detailsViewMode, setDetailsViewMode] = useState('players');
    const [infoData, setInfoData] = useState({
        status: 'idle',
        error: '',
        players: [],
        details: []
    });

    useEffect(() => {
        setDetailsViewMode('players');
    }, [row]);

    useEffect(() => {
        if (!row) {
            setInfoData({
                status: 'idle',
                error: '',
                players: [],
                details: []
            });
            return undefined;
        }

        const location = rowLocation(row);
        if (!location) {
            setInfoData({
                status: 'ready',
                error: '',
                players: [],
                details: []
            });
            return undefined;
        }

        let active = true;
        setInfoData({ status: 'running', error: '', players: [], details: [] });

        Promise.all([
            gameLogRepository.getPlayersFromInstance(location),
            gameLogRepository.getPlayerDetailFromInstance(location)
        ])
            .then(([players, details]) => {
                if (!active) {
                    return;
                }
                setInfoData({
                    status: 'ready',
                    error: '',
                    players: normalizePlayerRows(players),
                    details: Array.isArray(details) ? details : []
                });
            })
            .catch((error) => {
                if (!active) {
                    return;
                }
                setInfoData({
                    status: 'error',
                    error:
                        error instanceof Error
                            ? error.message
                            : 'Failed to load instance details.',
                    players: [],
                    details: []
                });
            });

        return () => {
            active = false;
        };
    }, [currentEndpoint, row]);

    if (!row) {
        return (
            <DialogEmptyState
                title={t(
                    'dialog.previous_instances.generated.no_instance_selected'
                )}
                description={t(
                    'dialog.previous_instances.generated.select_an_instance_row_to_view_its_details'
                )}
                className={className}
            />
        );
    }

    return (
        <div
            className={['flex min-h-0 flex-col gap-4 overflow-auto', className]
                .filter(Boolean)
                .join(' ')}
        >
            {showTitle || onBack ? (
                <div className="flex flex-wrap items-start justify-between gap-3">
                    {showTitle ? (
                        <div className="min-w-0">
                            <h3 className="text-base font-semibold">
                                {t('dialog.previous_instances.info')}
                            </h3>
                            <p className="text-muted-foreground truncate text-sm">
                                {rowLocation(row) || 'Instance details'}
                            </p>
                        </div>
                    ) : null}
                    {onBack ? (
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={onBack}
                        >
                            <ArrowLeftIcon data-icon="inline-start" />
                            {t(
                                'dialog.previous_instances.generated.back'
                            )}
                        </Button>
                    ) : null}
                </div>
            ) : null}
            <div className="grid gap-2 text-sm sm:grid-cols-2">
                <div>
                    <span className="text-muted-foreground">
                        {t(
                            'dialog.previous_instances.generated.created'
                        )}
                    </span>
                    <div>{formatDate(row?.created_at || row?.createdAt)}</div>
                </div>
                <div>
                    <span className="text-muted-foreground">
                        {t(
                            'dialog.previous_instances.generated.duration'
                        )}
                    </span>
                    <div>{rowDuration(row)}</div>
                </div>
                <div>
                    <span className="text-muted-foreground">
                        {t('dialog.previous_instances.generated.world')}
                    </span>
                    <div>{row?.worldName || '-'}</div>
                </div>
                <div>
                    <span className="text-muted-foreground">
                        {t('dialog.previous_instances.generated.group')}
                    </span>
                    <div>{row?.groupName || '-'}</div>
                </div>
                <div>
                    <span className="text-muted-foreground">
                        {t(
                            'dialog.previous_instances.generated.creator'
                        )}
                    </span>
                    <div>
                        <InstanceOwnerCell
                            userId={rowOwnerUserId(row)}
                            location={rowLocation(row)}
                            endpoint={currentEndpoint}
                        />
                    </div>
                </div>
            </div>
            <Tabs
                value={detailsViewMode}
                onValueChange={setDetailsViewMode}
                className="min-h-0"
            >
                <div className="flex items-center justify-between gap-3">
                    <TabsList variant="line">
                        <TabsTrigger value="players">
                            {t(
                                'dialog.previous_instances.generated.players'
                            )}
                        </TabsTrigger>
                        <TabsTrigger value="timeline">
                            {t('dialog.previous_instances.chart_view')}
                        </TabsTrigger>
                    </TabsList>
                    <span className="text-muted-foreground text-xs">
                        {infoData.players.length}{' '}
                        {t('dashboard.widget.instance_players')}
                    </span>
                </div>
                {infoData.status === 'running' ? (
                    <div className="text-muted-foreground flex items-center gap-2 rounded-md border border-dashed p-4 text-sm">
                        <Spinner className="size-4" />
                        <span>
                            {t(
                                'dialog.previous_instances.generated.loading_instance_details'
                            )}
                        </span>
                    </div>
                ) : null}
                {infoData.status === 'error' ? (
                    <DialogErrorState>{infoData.error}</DialogErrorState>
                ) : null}
                {infoData.status === 'ready' ? (
                    <>
                        <TabsContent value="players" className="mt-2">
                            <div className="max-h-80 overflow-auto rounded-md border">
                                <Table>
                                    <TableHeader className="bg-background sticky top-0">
                                        <TableRow>
                                            <TableHead>
                                                {t(
                                                    'dialog.previous_instances.generated.name'
                                                )}
                                            </TableHead>
                                            <TableHead>
                                                {t(
                                                    'dialog.previous_instances.generated.user_id'
                                                )}
                                            </TableHead>
                                            <TableHead className="w-24">
                                                {t(
                                                    'dialog.world.info.visits'
                                                )}
                                            </TableHead>
                                            <TableHead className="w-28">
                                                {t(
                                                    'table.previous_instances.time'
                                                )}
                                            </TableHead>
                                            <TableHead className="w-44">
                                                {t(
                                                    'dialog.previous_instances.generated.first_seen'
                                                )}
                                            </TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {infoData.players.length ? (
                                            infoData.players.map(
                                                (player, index) => (
                                                    <TableRow
                                                        key={`${playerDisplayName(player)}:${playerUserId(player)}:${index}`}
                                                    >
                                                        <TableCell className="align-top">
                                                            {playerDisplayName(
                                                                player
                                                            )}
                                                        </TableCell>
                                                        <TableCell className="text-muted-foreground align-top font-mono text-xs">
                                                            {playerUserId(
                                                                player
                                                            ) || '-'}
                                                        </TableCell>
                                                        <TableCell className="align-top text-xs tabular-nums">
                                                            {player?.count ||
                                                                '-'}
                                                        </TableCell>
                                                        <TableCell className="align-top text-xs tabular-nums">
                                                            {Number(
                                                                player?.time ||
                                                                    0
                                                            ) > 0
                                                                ? timeToText(
                                                                      Number(
                                                                          player.time
                                                                      )
                                                                  )
                                                                : '-'}
                                                        </TableCell>
                                                        <TableCell className="text-muted-foreground align-top text-xs">
                                                            {formatDate(
                                                                player?.created_at ||
                                                                    player?.createdAt
                                                            )}
                                                        </TableCell>
                                                    </TableRow>
                                                )
                                            )
                                        ) : (
                                            <TableRow>
                                                <TableCell
                                                    colSpan={5}
                                                    className="py-6 text-center"
                                                >
                                                    {t(
                                                        'dialog.previous_instances.generated.no_player_detail_rows_for_this_instance'
                                                    )}
                                                </TableCell>
                                            </TableRow>
                                        )}
                                    </TableBody>
                                </Table>
                            </div>
                        </TabsContent>
                        <TabsContent
                            value="timeline"
                            className="mt-2 max-h-[52vh] overflow-auto rounded-md border p-2"
                        >
                            <PreviousInstanceInfoChart rows={infoData.details} />
                        </TabsContent>
                    </>
                ) : null}
            </Tabs>
            {detailsViewMode === 'players' && infoData.details.length ? (
                <details className="rounded-md border p-3">
                    <summary className="cursor-pointer text-sm font-medium">
                        {t(
                            'dialog.previous_instances.generated.leave_details'
                        )}{' '}
                        ({infoData.details.length})
                    </summary>
                    <div className="mt-3 max-h-48 overflow-auto">
                        <Table>
                            <TableHeader className="bg-background sticky top-0">
                                <TableRow>
                                    <TableHead className="h-8 px-2 py-1 text-xs">
                                        {t(
                                            'dialog.previous_instances.generated.left_at'
                                        )}
                                    </TableHead>
                                    <TableHead className="h-8 px-2 py-1 text-xs">
                                        {t(
                                            'dialog.previous_instances.generated.name'
                                        )}
                                    </TableHead>
                                    <TableHead className="h-8 px-2 py-1 text-xs">
                                        {t(
                                            'dialog.previous_instances.generated.duration'
                                        )}
                                    </TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {infoData.details.map((detailRow, index) => (
                                    <TableRow
                                        key={`${detailRow?.created_at}:${detailRow?.user_id}:${index}`}
                                    >
                                        <TableCell className="text-muted-foreground px-2 py-1 text-xs">
                                            {formatDate(detailRow?.created_at)}
                                        </TableCell>
                                        <TableCell className="px-2 py-1 text-xs">
                                            {playerDisplayName(detailRow)}
                                        </TableCell>
                                        <TableCell className="px-2 py-1 text-xs tabular-nums">
                                            {Number(detailRow?.time || 0) > 0
                                                ? timeToText(
                                                      Number(detailRow.time)
                                                  )
                                                : '-'}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                </details>
            ) : null}
            {detailsViewMode === 'players' ? (
                <pre className="bg-muted/20 max-h-[45vh] overflow-auto rounded-md border p-3 text-xs">
                    {JSON.stringify(row ?? null, null, 2)}
                </pre>
            ) : null}
        </div>
    );
}
