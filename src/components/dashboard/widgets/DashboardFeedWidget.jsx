import { useEffect, useMemo, useRef, useState } from 'react';
import {
    BoxIcon,
    HeartIcon,
    LoaderCircleIcon,
    MapPinIcon,
    PencilIcon,
    SettingsIcon
} from 'lucide-react';

import { useI18n } from '@/app/hooks/use-i18n.js';
import { Location } from '@/components/Location.jsx';
import { FEED_FILTER_TYPES, feedRepository } from '@/repositories/index.js';
import { openUserDialog } from '@/services/dialogService.js';
import { useFavoriteStore } from '@/state/favoriteStore.js';
import { useFeedLiveStore } from '@/state/feedLiveStore.js';
import { useFriendRosterStore } from '@/state/friendRosterStore.js';
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

const FEED_WIDGET_MAX_ROWS = 100;
const UNKNOWN_FEED_USER_DISPLAY_NAME = 'Unknown';

function resolveFeedUserDisplayName(row, friend) {
    const userId = normalizeString(row?.userId);
    const rowDisplayName = normalizeString(row?.displayName);
    const friendDisplayName = normalizeString(friend?.displayName || friend?.username);
    if (rowDisplayName) {
        return rowDisplayName;
    }
    if (friendDisplayName) {
        return friendDisplayName;
    }
    return userId || UNKNOWN_FEED_USER_DISPLAY_NAME;
}

function openFeedUser(row, friend) {
    const userId = normalizeString(row?.userId);
    if (!userId) {
        return;
    }
    openUserDialog({
        userId,
        title: resolveFeedUserDisplayName(row, friend) || undefined,
        seedData: row
    });
}

function feedEntryMatchesWidget(row, { currentUserId, filters }) {
    if (!row || typeof row !== 'object') {
        return false;
    }
    if (row.ownerUserId && row.ownerUserId !== currentUserId) {
        return false;
    }
    return !Array.isArray(filters) || !filters.length || filters.includes(row.type);
}

function getFeedRowId(row) {
    if (row?.id != null) {
        return `id:${row.id}`;
    }
    if (row?.rowId != null) {
        return `row:${row.rowId}`;
    }
    const type = row?.type ?? '';
    const createdAt = row?.created_at ?? row?.createdAt ?? '';
    const userId = row?.userId ?? row?.senderUserId ?? '';
    const location = row?.location ?? row?.details?.location ?? '';
    const message = row?.message ?? '';
    return `${type}:${createdAt}:${userId}:${location}:${message}`;
}

function collectMatchingLiveFeedEntries(entries, minSequence, context) {
    const unseenEntries = (Array.isArray(entries) ? entries : [])
        .filter((item) => item.sequence > minSequence);
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

function FeedUserName({ row, friend, className = '' }) {
    const displayName = resolveFeedUserDisplayName(row, friend);
    const userId = normalizeString(row?.userId);
    if (!userId) {
        return <span className={className}>{displayName}</span>;
    }

    return (
        <button
            type="button"
            className={`shrink-0 cursor-pointer text-left hover:underline ${className}`}
            onClick={() => openFeedUser(row, friend)}>
            {displayName}
        </button>
    );
}

function FeedLocation({ row }) {
    if (!row?.location) {
        return null;
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

function FeedStatusDot({ status = '' }) {
    const normalizedStatus = String(status || '').toLowerCase();
    const className = normalizedStatus === 'active'
        ? 'bg-[var(--status-online)]'
        : normalizedStatus === 'online'
            ? 'bg-[var(--status-online)]'
        : normalizedStatus === 'join me'
            ? 'bg-[var(--status-joinme)]'
            : normalizedStatus === 'ask me'
                ? 'bg-[var(--status-askme)]'
                : normalizedStatus === 'busy'
                    ? 'bg-[var(--status-busy)]'
                    : '';

    return className ? <span className={`mr-1 mt-1 size-2.5 shrink-0 rounded-full ${className}`} /> : null;
}

function FeedEntryContent({ row, friend, t }) {
    switch (row?.type) {
        case 'GPS':
            return (
                <div className="flex min-w-0 items-center">
                    <MapPinIcon className="mr-1 size-3.5 shrink-0 text-muted-foreground" />
                    <FeedUserName row={row} friend={friend} />
                    <span className="mx-1 shrink-0 text-muted-foreground">→</span>
                    <FeedLocation row={row} />
                </div>
            );
        case 'Online':
            return (
                <div className="flex min-w-0 items-center">
                    <FeedStatusDot status="online" />
                    <FeedUserName row={row} friend={friend} />
                    {row?.location ? (
                        <>
                            <span className="mx-1 shrink-0 text-muted-foreground">→</span>
                            <FeedLocation row={row} />
                        </>
                    ) : null}
                </div>
            );
        case 'Offline':
            return (
                <div className="flex min-w-0 items-center">
                    <FeedUserName row={row} friend={friend} />
                </div>
            );
        case 'Status':
            return (
                <div className="flex min-w-0 items-center">
                    <FeedStatusDot status={row?.status} />
                    <FeedUserName row={row} friend={friend} />
                    <span className="ml-1 min-w-0 truncate text-muted-foreground">
                        {row?.statusDescription || ''}
                    </span>
                </div>
            );
        case 'Avatar':
            return (
                <div className="flex min-w-0 items-center">
                    <BoxIcon className="mr-1 size-3.5 shrink-0 text-muted-foreground" />
                    <FeedUserName row={row} friend={friend} />
                    <span className="ml-1 min-w-0 truncate text-muted-foreground">
                        {row?.avatarName ? `→ ${row.avatarName}` : ''}
                    </span>
                </div>
            );
        case 'Bio':
            return (
                <div className="flex min-w-0 items-center">
                    <PencilIcon className="mr-1 size-3.5 shrink-0 text-muted-foreground" />
                    <FeedUserName row={row} friend={friend} />
                    <span className="ml-1 text-muted-foreground">
                        {t('dashboard.widget.feed_bio')}
                    </span>
                </div>
            );
        default:
            return (
                <div className="flex min-w-0 items-center">
                    <FeedUserName row={row} friend={friend} />
                    <span className="ml-1 min-w-0 truncate text-muted-foreground">
                        {row?.type || ''}
                    </span>
                </div>
            );
    }
}

export function DashboardFeedWidget({ config = {}, configUpdater = null }) {
    const { t } = useI18n();
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const addGameLogEventCount = useRuntimeStore(
        (state) => state.backendEvents.addGameLogEvent.count
    );
    const liveFeedEntries = useFeedLiveStore((state) => state.entries);
    const remoteFavoriteFriendIds = useFavoriteStore((state) => state.favoriteFriendIds);
    const localFriendFavorites = useFavoriteStore((state) => state.localFriendFavorites);
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
            lastLiveFeedSequenceRef.current = useFeedLiveStore.getState().version;
            setRows([]);
            setLoadStatus('idle');
            setDetail('');
            return () => {
                active = false;
            };
        }

        setLoadStatus('running');
        setDetail('');

        const liveFeedSequenceAtRequestStart = useFeedLiveStore.getState().version;
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
                const { matchingEntries, maxSequence } = collectMatchingLiveFeedEntries(
                    liveFeedSnapshot.entries,
                    liveFeedSequenceAtRequestStart,
                    liveFeedContext
                );
                if (maxSequence > lastLiveFeedSequenceRef.current) {
                    lastLiveFeedSequenceRef.current = maxSequence;
                }

                setRows(mergeLiveFeedEntries(nextRows, matchingEntries, FEED_WIDGET_MAX_ROWS));
                setLoadStatus('ready');
                setDetail('');
            })
            .catch((error) => {
                if (!active) {
                    return;
                }

                setRows([]);
                setLoadStatus('error');
                setDetail(error instanceof Error ? error.message : 'Failed to load feed widget.');
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
        setRows((current) => mergeLiveFeedEntries(current, matchingEntries, FEED_WIDGET_MAX_ROWS));
    }, [activeFilters, currentUserId, liveFeedEntries]);

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

    const showType = Boolean(config.showType);
    const settingsMenu = configUpdater ? (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button type="button" variant="ghost" size="icon-sm">
                    <SettingsIcon className="size-3.5" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
                {FEED_FILTER_TYPES.map((filterType) => (
                    <DropdownMenuCheckboxItem
                        key={filterType}
                        checked={isDashboardWidgetFilterActive(config, filterType)}
                        onSelect={(event) => event.preventDefault()}
                        onCheckedChange={() =>
                            configUpdater(
                                getNextDashboardWidgetFilterConfig(config, filterType, FEED_FILTER_TYPES)
                            )
                        }>
                        {t(`view.feed.filters.${filterType}`)}
                    </DropdownMenuCheckboxItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuCheckboxItem
                    checked={showType}
                    onSelect={(event) => event.preventDefault()}
                    onCheckedChange={(checked) => configUpdater({ ...config, showType: Boolean(checked) })}>
                    {t('dashboard.widget.config.show_type')}
                </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
        </DropdownMenu>
    ) : null;
    const renderShell = (children) => (
        <div className="flex h-full min-h-0 flex-col">
            <DashboardWidgetHeader title={t('dashboard.widget.feed')} icon="ri-rss-line" path="/feed">
                {settingsMenu}
            </DashboardWidgetHeader>
            {children}
        </div>
    );

    if (!currentUserId) {
        return renderShell(
            <DashboardWidgetEmptyState
                title="Feed unavailable"
                description="Sign in before the dashboard can query feed rows."
            />
        );
    }

    if (loadStatus === 'error') {
        return renderShell(
            <DashboardWidgetEmptyState
                title="Feed widget failed"
                description={detail || 'The local feed query did not complete.'}
            />
        );
    }

    if (loadStatus === 'running' && annotatedRows.length === 0) {
        return renderShell(
            <div className="flex min-h-[180px] flex-1 items-center justify-center text-sm text-muted-foreground">
                <LoaderCircleIcon className="mr-2 size-4 animate-spin" />
                Loading feed widget
            </div>
        );
    }

    if (!annotatedRows.length) {
        return renderShell(
            <DashboardWidgetEmptyState
                title="No feed rows"
                description="The current filter set did not return any recent feed activity."
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
                        : 'All feed types'}
                </span>
                {showType ? <span>Type column enabled</span> : null}
            </div>

            <div className="min-h-0 flex-1 overflow-auto">
                <Table className="vrcx-data-table table-fixed">
                    <TableBody>
                        {annotatedRows.map((row, index) => (
                            <TableRow
                                key={`${row.type || 'feed'}-${row.created_at || index}-${index}`}>
                                <TableCell
                                    className="w-24 align-top text-[11px] tabular-nums text-muted-foreground"
                                    title={formatWidgetExactTime(row.created_at)}>
                                    {formatWidgetTime(row.created_at)}
                                </TableCell>
                                {showType ? (
                                    <TableCell className="w-20 align-top text-[11px] text-muted-foreground">
                                        {row.type || ''}
                                    </TableCell>
                                ) : null}
                                <TableCell className="align-top">
                                    <div className="flex min-w-0 items-center gap-2 text-sm">
                                        <div className="min-w-0 flex-1 truncate">
                                            <FeedEntryContent
                                                row={row}
                                                friend={friendsById?.[normalizeString(row?.userId)]}
                                                t={t}
                                            />
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
                        ))}
                    </TableBody>
                </Table>
            </div>
        </>
    );
}
