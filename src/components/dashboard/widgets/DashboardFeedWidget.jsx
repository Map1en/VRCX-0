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

import {
    FeedEntryContent,
    getFeedRowId,
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

function feedEntryMatchesWidget(row, { currentUserId, filters }) {
    if (!row || typeof row !== 'object') {
        return false;
    }
    if (row.ownerUserId && row.ownerUserId !== currentUserId) {
        return false;
    }
    return (
        !Array.isArray(filters) || !filters.length || filters.includes(row.type)
    );
}

function collectMatchingLiveFeedEntries(entries, minSequence, context) {
    const unseenEntries = (Array.isArray(entries) ? entries : []).filter(
        (item) => item.sequence > minSequence
    );
    if (!unseenEntries.length) {
        return {
            matchingEntries: [],
            maxSequence: minSequence
        };
    }

    const matchingEntries = unseenEntries
        .map((item) => item.entry)
        .filter((entry) => feedEntryMatchesWidget(entry, context));

    return {
        matchingEntries,
        maxSequence: Math.max(...unseenEntries.map((item) => item.sequence))
    };
}

function mergeLiveFeedEntries(rows, matchingEntries, maxRows) {
    const nextRowsById = new Map();
    for (const entry of [...matchingEntries].reverse()) {
        nextRowsById.set(getFeedRowId(entry), entry);
    }
    for (const row of Array.isArray(rows) ? rows : []) {
        const rowId = getFeedRowId(row);
        if (!nextRowsById.has(rowId)) {
            nextRowsById.set(rowId, row);
        }
    }
    return Array.from(nextRowsById.values()).slice(0, maxRows);
}

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
        const liveFeedContext = {
            currentUserId,
            filters: activeFilters
        };

        feedRepository
            .queryFeed({
                userId: currentUserId,
                filters: activeFilters
            })
            .then((nextRows) => {
                if (!active) {
                    return;
                }

                const liveFeedSnapshot = useFeedLiveStore.getState();
                const { matchingEntries, maxSequence } =
                    collectMatchingLiveFeedEntries(
                        liveFeedSnapshot.entries,
                        liveFeedSequenceAtRequestStart,
                        liveFeedContext
                    );
                if (maxSequence > lastLiveFeedSequenceRef.current) {
                    lastLiveFeedSequenceRef.current = maxSequence;
                }

                setRows(
                    mergeLiveFeedEntries(
                        nextRows,
                        matchingEntries,
                        FEED_WIDGET_MAX_ROWS
                    )
                );
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
        if (!currentUserId || liveFeedEntries.length === 0) {
            return;
        }
        const { matchingEntries, maxSequence } = collectMatchingLiveFeedEntries(
            liveFeedEntries,
            lastLiveFeedSequenceRef.current,
            {
                currentUserId,
                filters: activeFilters
            }
        );
        if (maxSequence > lastLiveFeedSequenceRef.current) {
            lastLiveFeedSequenceRef.current = maxSequence;
        }
        if (!matchingEntries.length) {
            return;
        }
        setRows((current) =>
            mergeLiveFeedEntries(current, matchingEntries, FEED_WIDGET_MAX_ROWS)
        );
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
                title={t('view.dashboard.generated.feed_unavailable')}
                description={t(
                    'view.dashboard.generated.sign_in_before_the_dashboard_can_query_feed_rows'
                )}
            />
        );
    }

    if (loadStatus === 'error') {
        return renderShell(
            <DashboardWidgetEmptyState
                title={t('view.dashboard.generated.feed_widget_failed')}
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
                {t('view.dashboard.generated.loading_feed_widget')}
            </div>
        );
    }

    if (!annotatedRows.length) {
        return renderShell(
            <DashboardWidgetEmptyState
                title={t('view.dashboard.generated.no_feed_rows')}
                description={t(
                    'view.dashboard.generated.the_current_filter_set_did_not_return_any_recent_feed_activi'
                )}
            />
        );
    }

    return renderShell(
        <>
            <div className="text-muted-foreground flex flex-wrap gap-2 px-3 pt-3 text-xs">
                <span>
                    {annotatedRows.length}{' '}
                    {t('view.dashboard.generated.recent_rows')}
                </span>
                <span>
                    {Array.isArray(config.filters) && config.filters.length
                        ? `${config.filters.length} type filters`
                        : 'All feed types'}
                </span>
                {showType ? (
                    <span>
                        {t('view.dashboard.generated.type_column_enabled')}
                    </span>
                ) : null}
            </div>

            <div className="min-h-0 flex-1 overflow-auto">
                <Table className="app-data-table table-fixed">
                    <TableBody>
                        {annotatedRows.map((row) => (
                            <TableRow key={getFeedRowKey(row)}>
                                <TableCell
                                    className="text-muted-foreground w-24 align-top text-xs tabular-nums"
                                    title={formatWidgetExactTime(
                                        row.created_at
                                    )}
                                >
                                    {formatWidgetTime(row.created_at)}
                                </TableCell>
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
                                                    'view.dashboard.generated.favorite'
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
