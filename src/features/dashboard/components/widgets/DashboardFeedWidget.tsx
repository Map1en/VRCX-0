import { SettingsIcon } from 'lucide-react';
import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode
} from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';

import { AffinityBadge } from '@/components/affinity/AffinityBadge';
import type { FeedRow } from '@/components/feed/feedTypes';
import { buildFavoriteIdSet } from '@/domain/favorites/favoriteIdSet';
import type { FeedReadModelResult } from '@/domain/feed/readModel';
import { FeedPersistenceDisabledIndicator } from '@/features/feed/components/FeedPersistenceDisabledIndicator';
import { userFacingErrorMessage } from '@/lib/errorDisplay';
import {
    FEED_FILTER_TYPES,
    isFeedFilterType
} from '@/repositories/feedRepository';
import type { FeedFilterType } from '@/repositories/feedRepository';
import feedRepository from '@/repositories/feedRepository';
import { mergeFeedRowsWithSnapshot } from '@/services/feedLiveMergeService';
import { normalizeString } from '@/shared/utils/string';
import { useFavoriteStore } from '@/state/favoriteStore';
import { useFeedLiveStore } from '@/state/feedLiveStore';
import { useFriendRosterStore } from '@/state/friendRosterStore';
import { usePreferencesStore } from '@/state/preferencesStore';
import { useRuntimeStore } from '@/state/runtimeStore';
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

import { FeedEntryContent, getFeedRowKey } from './DashboardFeedEntryContent';
import { DashboardWidgetEmptyState } from './DashboardWidgetEmptyState';
import { DashboardWidgetHeader } from './DashboardWidgetHeader';
import { DashboardWidgetTimelineRow } from './DashboardWidgetTimeline';
import {
    getNextDashboardWidgetFilterConfig,
    isDashboardWidgetFilterActive
} from './dashboardWidgetUtils';

const FEED_WIDGET_MAX_ROWS = 100;
type DashboardFeedWidgetRow = FeedRow & {
    isFavorite: boolean;
};

type DashboardFeedWidgetProps = {
    config?: Record<string, unknown>;
    configUpdater?: ((nextConfig: Record<string, unknown>) => void) | null;
};

export function DashboardFeedWidget({
    config = {},
    configUpdater = null
}: DashboardFeedWidgetProps) {
    const { t } = useTranslation();
    const { currentUserId, addGameLogEventCount } = useRuntimeStore(
        useShallow((state) => ({
            currentUserId: state.auth.currentUserId,
            addGameLogEventCount: state.runtimeEvents.addGameLogEvent.count
        }))
    );
    const { liveFeedEntries, liveFeedPatches, liveFeedVersion } =
        useFeedLiveStore(
            useShallow((state) => ({
                liveFeedEntries: state.entries,
                liveFeedPatches: state.patches,
                liveFeedVersion: state.version
            }))
        );
    const { remoteFavoriteFriendIds, localFriendFavorites } = useFavoriteStore(
        useShallow((state) => ({
            remoteFavoriteFriendIds: state.favoriteFriendIds,
            localFriendFavorites: state.localFriendFavorites
        }))
    );
    const friendsById = useFriendRosterStore((state) => state.friendsById);
    const feedPersistenceDisabled = usePreferencesStore(
        (state) => state.feedPersistenceDisabled
    );
    const lastLiveFeedSequenceRef = useRef(0);
    const liveFeedSnapshotRef = useRef({
        entries: liveFeedEntries,
        patches: liveFeedPatches,
        version: liveFeedVersion
    });
    const rowsRef = useRef<FeedRow[]>([]);
    const liveMergeRequestIdRef = useRef(0);
    const [rows, setRows] = useState<FeedRow[]>([]);
    const [loadStatus, setLoadStatus] = useState('idle');
    const [detail, setDetail] = useState('');

    const activeFilters = useMemo<FeedFilterType[]>(
        () =>
            (Array.isArray(config.filters) ? config.filters : []).filter(
                isFeedFilterType
            ),
        [config.filters]
    );

    const favoriteIdSet = useMemo(
        () => buildFavoriteIdSet(remoteFavoriteFriendIds, localFriendFavorites),
        [localFriendFavorites, remoteFavoriteFriendIds]
    );

    useEffect(() => {
        liveFeedSnapshotRef.current = {
            entries: liveFeedEntries,
            patches: liveFeedPatches,
            version: liveFeedVersion
        };
    }, [liveFeedEntries, liveFeedPatches, liveFeedVersion]);

    useEffect(() => {
        lastLiveFeedSequenceRef.current = liveFeedSnapshotRef.current.version;
    }, [currentUserId, feedPersistenceDisabled]);

    useEffect(() => {
        rowsRef.current = rows;
    }, [rows]);

    useEffect(() => {
        rowsRef.current = [];
        setRows([]);
    }, [feedPersistenceDisabled]);

    const mergeWidgetRowsWithLatestLive = useCallback(
        async ({
            rows,
            minLiveSequence,
            requestIsCurrent
        }: {
            rows: FeedRow[];
            minLiveSequence: number;
            requestIsCurrent(): boolean;
        }): Promise<FeedReadModelResult<FeedRow> | null> => {
            let result: FeedReadModelResult<FeedRow> = {
                rows,
                maxSequence: minLiveSequence
            };
            let previousMaxSequence = minLiveSequence;
            while (requestIsCurrent()) {
                const liveFeedSnapshot = liveFeedSnapshotRef.current;
                result = mergeFeedRowsWithSnapshot({
                    buildMergeOptions: ({ rows }) => ({
                        rows,
                        userId: currentUserId || '',
                        filters: activeFilters,
                        maxRows: FEED_WIDGET_MAX_ROWS
                    }),
                    liveEntries: liveFeedSnapshot.entries,
                    livePatches: liveFeedSnapshot.patches,
                    minLiveSequence: result.maxSequence,
                    rows: result.rows
                });
                if (!requestIsCurrent()) {
                    return null;
                }
                const liveVersion = liveFeedSnapshotRef.current.version;
                if (
                    liveVersion <= result.maxSequence ||
                    result.maxSequence <= previousMaxSequence
                ) {
                    return result;
                }
                previousMaxSequence = result.maxSequence;
            }
            return null;
        },
        [activeFilters, currentUserId]
    );

    const prepareWidgetRowsForCommit = useCallback(
        async ({
            result,
            requestIsCurrent
        }: {
            result: FeedReadModelResult<FeedRow>;
            requestIsCurrent(): boolean;
        }): Promise<FeedReadModelResult<FeedRow> | null> => {
            let nextResult = result;
            while (requestIsCurrent()) {
                liveMergeRequestIdRef.current += 1;
                if (
                    liveFeedSnapshotRef.current.version <=
                    nextResult.maxSequence
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
        },
        [mergeWidgetRowsWithLatestLive]
    );

    useEffect(() => {
        let active = true;

        if (!currentUserId) {
            lastLiveFeedSequenceRef.current =
                liveFeedSnapshotRef.current.version;
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
            liveFeedSnapshotRef.current.version;
        feedRepository
            .queryFeedLatest({
                userId: currentUserId,
                filters: activeFilters,
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
                lastLiveFeedSequenceRef.current = maxSequence;

                rowsRef.current = commitResult.rows;
                setRows(commitResult.rows);
                setLoadStatus('ready');
                setDetail('');
            })
            .catch((error: unknown) => {
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
    }, [
        activeFilters,
        addGameLogEventCount,
        currentUserId,
        feedPersistenceDisabled,
        mergeWidgetRowsWithLatestLive,
        prepareWidgetRowsForCommit
    ]);

    useEffect(() => {
        liveMergeRequestIdRef.current += 1;
        if (
            !currentUserId ||
            liveFeedVersion <= lastLiveFeedSequenceRef.current
        ) {
            return;
        }
        const mergeRequestId = liveMergeRequestIdRef.current + 1;
        liveMergeRequestIdRef.current = mergeRequestId;
        const minLiveSequence = lastLiveFeedSequenceRef.current;
        mergeWidgetRowsWithLatestLive({
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
            .catch((error: unknown) => {
                setDetail(
                    userFacingErrorMessage(
                        error,
                        'Failed to merge feed widget update.'
                    )
                );
            });
    }, [
        activeFilters,
        currentUserId,
        liveFeedEntries,
        liveFeedPatches,
        liveFeedVersion,
        mergeWidgetRowsWithLatestLive
    ]);

    const annotatedRows = useMemo(
        () =>
            rows.map((row): DashboardFeedWidgetRow => {
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
            <DropdownMenuTrigger
                render={
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={'Widget settings'}
                    >
                        <SettingsIcon data-icon="inline-start" />
                    </Button>
                }
            />
            <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuGroup>
                    {FEED_FILTER_TYPES.map((filterType) => (
                        <DropdownMenuCheckboxItem
                            key={filterType}
                            checked={isDashboardWidgetFilterActive(
                                config,
                                filterType
                            )}
                            onClick={(event) => event.preventDefault()}
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
                        onClick={(event) => event.preventDefault()}
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
    const renderShell = (children: ReactNode) => (
        <div className="flex h-full min-h-0 flex-col">
            <DashboardWidgetHeader
                title={t('dashboard.registry.feed')}
                icon="ri-rss-line"
                path="/feed"
                meta={annotatedRows.length || null}
            >
                {feedPersistenceDisabled ? (
                    <FeedPersistenceDisabledIndicator />
                ) : null}
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
        <div className="min-h-0 flex-1 overflow-auto">
            {annotatedRows.map((row, index) => {
                return (
                    <DashboardWidgetTimelineRow
                        key={getFeedRowKey(row)}
                        value={row.created_at}
                        previousValue={annotatedRows[index - 1]?.created_at}
                        isFirst={index === 0}
                    >
                        <div className="flex min-w-0 items-center gap-2">
                            <div className="min-w-0 flex-1 truncate">
                                <FeedEntryContent
                                    row={row}
                                    friend={
                                        friendsById?.[
                                            normalizeString(row?.userId)
                                        ]
                                    }
                                />
                            </div>
                            {showType ? (
                                <span className="text-muted-foreground max-w-24 shrink-0 truncate text-xs">
                                    {t(
                                        `view.feed.filters.${normalizeString(row.type)}`,
                                        {
                                            defaultValue: normalizeString(
                                                row.type
                                            )
                                        }
                                    )}
                                </span>
                            ) : null}
                            {row.isFavorite ? (
                                <AffinityBadge isFriend isFavorite iconOnly />
                            ) : null}
                        </div>
                    </DashboardWidgetTimelineRow>
                );
            })}
        </div>
    );
}
