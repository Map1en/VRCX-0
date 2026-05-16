import { HeartIcon, SettingsIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { userFacingErrorMessage } from '@/lib/errorDisplay.js';
import { FEED_FILTER_TYPES, feedRepository } from '@/repositories/index.js';
import { useFavoriteStore } from '@/state/favoriteStore.js';
import { useFeedLiveStore } from '@/state/feedLiveStore.js';
import { useFriendRosterStore } from '@/state/friendRosterStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
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

import {
    FeedEntryContent,
    getFeedRowKey
} from './DashboardFeedEntryContent.jsx';
import { DashboardWidgetEmptyState } from './DashboardWidgetEmptyState.jsx';
import { DashboardWidgetHeader } from './DashboardWidgetHeader.jsx';
import {
    buildFavoriteIdSet,
    formatWidgetExactTime,
    formatWidgetTime,
    getNextDashboardWidgetFilterConfig,
    isDashboardWidgetFilterActive,
    normalizeString
} from './dashboardWidgetUtils.js';

const FEED_WIDGET_MAX_ROWS = 100;

export function DashboardFeedWidget({ config = {}, configUpdater = null }) {
    const { t } = useTranslation();
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const addGameLogEventCount = useRuntimeStore(
        (state) => state.backendEvents.addGameLogEvent.count
    );
    const liveFeedEntries = useFeedLiveStore((state) => state.entries);
    const remoteFavoriteFriendIds = useFavoriteStore(
        (state) => state.favoriteFriendIds
    );
    const localFriendFavorites = useFavoriteStore(
        (state) => state.localFriendFavorites
    );
    const friendsById = useFriendRosterStore((state) => state.friendsById);

    const lastLiveFeedSequenceRef = useRef(0);
    const rowsRef = useRef([]);
    const liveMergeRequestIdRef = useRef(0);
    const [rows, setRows] = useState([]);
    const [loadStatus, setLoadStatus] = useState('idle');
    const [detail, setDetail] = useState('');

    const activeFilters = useMemo(
        () => (Array.isArray(config.filters) ? config.filters : []),
        [config.filters]
    );

    const favoriteIdSet = useMemo(
        () => buildFavoriteIdSet(remoteFavoriteFriendIds, localFriendFavorites),
        [localFriendFavorites, remoteFavoriteFriendIds]
    );

    useEffect(() => {
        lastLiveFeedSequenceRef.current = useFeedLiveStore.getState().version;
    }, [currentUserId]);

    useEffect(() => {
        rowsRef.current = rows;
    }, [rows]);

    async function mergeWidgetRowsWithLatestLive({
        rows,
        minLiveSequence,
        requestIsCurrent
    }) {
        let result = {
            rows,
            maxSequence: minLiveSequence
        };
        let previousMaxSequence = minLiveSequence;
        while (requestIsCurrent()) {
            const liveFeedSnapshot = useFeedLiveStore.getState();
            result = await feedRepository.mergeLiveRows({
                rows: result.rows,
                userId: currentUserId,
                filters: activeFilters,
                liveEntries: liveFeedSnapshot.entries,
                minLiveSequence: result.maxSequence,
                maxRows: FEED_WIDGET_MAX_ROWS
            });
            if (!requestIsCurrent()) {
                return null;
            }
            const liveVersion = useFeedLiveStore.getState().version;
            if (
                liveVersion <= result.maxSequence ||
                result.maxSequence <= previousMaxSequence
            ) {
                return result;
            }
            previousMaxSequence = result.maxSequence;
        }
        return null;
    }

    async function prepareWidgetRowsForCommit({ result, requestIsCurrent }) {
        let nextResult = result;
        while (requestIsCurrent()) {
            liveMergeRequestIdRef.current += 1;
            if (
                useFeedLiveStore.getState().version <= nextResult.maxSequence
            ) {
                return nextResult;
            }
            const mergedResult = await mergeWidgetRowsWithLatestLive({
                rows: nextResult.rows,
                minLiveSequence: nextResult.maxSequence,
                requestIsCurrent
            });
            if (!mergedResult) {
                return null;
            }
            nextResult = mergedResult;
        }
        return null;
    }

    useEffect(() => {
        let active = true;

        if (!currentUserId) {
            lastLiveFeedSequenceRef.current =
                useFeedLiveStore.getState().version;
            setRows([]);
            setLoadStatus('idle');
            setDetail('');
            return () => {
                active = false;
            };
        }

        setLoadStatus('running');
        setDetail('');

        const liveFeedSequenceAtRequestStart =
            useFeedLiveStore.getState().version;
        feedRepository
            .queryFeedReadModel({
                userId: currentUserId,
                filters: activeFilters,
                liveEntries: [],
                minLiveSequence: liveFeedSequenceAtRequestStart,
                maxRows: FEED_WIDGET_MAX_ROWS
            })
            .then(async (result) => {
                if (!active) {
                    return;
                }

                const mergedResult = await mergeWidgetRowsWithLatestLive({
                    rows: result.rows,
                    minLiveSequence: result.maxSequence,
                    requestIsCurrent: () => active
                });
                if (!active || !mergedResult) {
                    return;
                }
                const commitResult = await prepareWidgetRowsForCommit({
                    result: mergedResult,
                    requestIsCurrent: () => active
                });
                if (!active || !commitResult) {
                    return;
                }
                const maxSequence = Math.max(
                    commitResult.maxSequence,
                    liveFeedSequenceAtRequestStart
                );
                if (maxSequence > lastLiveFeedSequenceRef.current) {
                    lastLiveFeedSequenceRef.current = maxSequence;
                }

                rowsRef.current = commitResult.rows;
                setRows(commitResult.rows);
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
                    userFacingErrorMessage(error, 'Failed to load feed widget.')
                );
            });

        return () => {
            active = false;
        };
    }, [activeFilters, addGameLogEventCount, currentUserId]);

    useEffect(() => {
        liveMergeRequestIdRef.current += 1;
        if (!currentUserId || liveFeedEntries.length === 0) {
            return;
        }
        const mergeRequestId = liveMergeRequestIdRef.current + 1;
        liveMergeRequestIdRef.current = mergeRequestId;
        const minLiveSequence = lastLiveFeedSequenceRef.current;
        void mergeWidgetRowsWithLatestLive({
            rows: rowsRef.current,
            minLiveSequence,
            requestIsCurrent: () =>
                liveMergeRequestIdRef.current === mergeRequestId
        })
            .then((result) => {
                if (!result) {
                    return;
                }
                if (liveMergeRequestIdRef.current !== mergeRequestId) {
                    return;
                }
                if (result.maxSequence > lastLiveFeedSequenceRef.current) {
                    lastLiveFeedSequenceRef.current = result.maxSequence;
                }
                rowsRef.current = result.rows;
                setRows(result.rows);
            })
            .catch((error) => {
                setDetail(
                    userFacingErrorMessage(
                        error,
                        'Failed to merge feed widget update.'
                    )
                );
            });
    }, [activeFilters, currentUserId, liveFeedEntries]);

    const annotatedRows = useMemo(
        () =>
            rows.map((row) => {
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

    const showType = Boolean(config.showType);
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
                    {FEED_FILTER_TYPES.map((filterType) => (
                        <DropdownMenuCheckboxItem
                            key={filterType}
                            checked={isDashboardWidgetFilterActive(
                                config,
                                filterType
                            )}
                            onSelect={(event) => event.preventDefault()}
                            onCheckedChange={() =>
                                configUpdater(
                                    getNextDashboardWidgetFilterConfig(
                                        config,
                                        filterType,
                                        FEED_FILTER_TYPES
                                    )
                                )
                            }
                        >
                            {t(`view.feed.filters.${filterType}`)}
                        </DropdownMenuCheckboxItem>
                    ))}
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                    <DropdownMenuCheckboxItem
                        checked={showType}
                        onSelect={(event) => event.preventDefault()}
                        onCheckedChange={(checked) =>
                            configUpdater({
                                ...config,
                                showType: Boolean(checked)
                            })
                        }
                    >
                        {t('dashboard.widget.config.show_type')}
                    </DropdownMenuCheckboxItem>
                </DropdownMenuGroup>
            </DropdownMenuContent>
        </DropdownMenu>
    ) : null;
    const renderShell = (children) => (
        <div className="flex h-full min-h-0 flex-col">
            <DashboardWidgetHeader
                title={t('dashboard.widget.feed')}
                icon="ri-rss-line"
                path="/feed"
            >
                {settingsMenu}
            </DashboardWidgetHeader>
            {children}
        </div>
    );

    if (!currentUserId) {
        return renderShell(
            <DashboardWidgetEmptyState
                title={t('view.dashboard.error.feed_unavailable')}
                description={t(
                    'view.dashboard.label.sign_in_before_the_dashboard_can_query_feed_rows'
                )}
            />
        );
    }

    if (loadStatus === 'error') {
        return renderShell(
            <DashboardWidgetEmptyState
                title={t('view.dashboard.error.feed_widget_failed')}
                description={userFacingErrorMessage(
                    detail,
                    'The local feed query did not complete.'
                )}
            />
        );
    }

    if (loadStatus === 'running' && annotatedRows.length === 0) {
        return renderShell(
            <div className="text-muted-foreground flex min-h-[180px] flex-1 items-center justify-center gap-2 text-sm">
                <Spinner />
                {t('view.dashboard.loading.loading_feed_widget')}
            </div>
        );
    }

    if (!annotatedRows.length) {
        return renderShell(
            <DashboardWidgetEmptyState
                title={t('view.dashboard.empty.no_feed_rows')}
                description={t(
                    'view.dashboard.label.the_current_filter_set_did_not_return_any_recent_feed_activity'
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
                        : 'All feed types'}
                </span>
                {showType ? (
                    <span>
                        {t('view.dashboard.label.type_column_enabled')}
                    </span>
                ) : null}
            </div>

            <div className="min-h-0 flex-1 overflow-auto">
                <Table className="app-data-table table-fixed">
                    <TableBody>
                        {annotatedRows.map((row) => (
                            <TableRow key={getFeedRowKey(row)}>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <TableCell className="text-muted-foreground w-24 align-top text-xs tabular-nums">
                                            {formatWidgetTime(row.created_at)}
                                        </TableCell>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                        {formatWidgetExactTime(row.created_at)}
                                    </TooltipContent>
                                </Tooltip>
                                {showType ? (
                                    <TableCell className="text-muted-foreground w-20 align-top text-xs">
                                        {row.type || ''}
                                    </TableCell>
                                ) : null}
                                <TableCell className="align-top">
                                    <div className="flex min-w-0 items-center gap-2 text-sm">
                                        <div className="min-w-0 flex-1 truncate">
                                            <FeedEntryContent
                                                row={row}
                                                friend={
                                                    friendsById?.[
                                                        normalizeString(
                                                            row?.userId
                                                        )
                                                    ]
                                                }
                                                t={t}
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
                        ))}
                    </TableBody>
                </Table>
            </div>
        </>
    );
}
