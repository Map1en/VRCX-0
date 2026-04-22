import {
    ArrowDownIcon,
    ArrowUpDownIcon,
    ArrowUpIcon,
    ChevronRightIcon,
    CopyIcon,
    ExternalLinkIcon,
    LogInIcon,
    LogOutIcon,
    LogsIcon,
    VideoIcon
} from 'lucide-react';
import {
    memo,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState
} from 'react';
import { toast } from 'sonner';

import { useI18n } from '@/app/hooks/use-i18n.js';
import { EmptyState } from '@/components/layout/PageScaffold.jsx';
import { Location } from '@/components/Location.jsx';
import { formatDateFilter } from '@/lib/dateTime.js';
import { timeToText } from '@/lib/dateTime.js';
import { copyTextToClipboard, openExternalLink } from '@/lib/entityMedia.js';
import { cn } from '@/lib/utils.js';
import {
    gameLogRepository,
    vrchatSearchRepository
} from '@/repositories/index.js';
import { openUserDialog } from '@/services/dialogService.js';
import { useFriendRosterStore } from '@/state/friendRosterStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuGroup,
    ContextMenuItem,
    ContextMenuSeparator,
    ContextMenuTrigger
} from '@/ui/shadcn/context-menu';
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';
import { Spinner } from '@/ui/shadcn/spinner';

import {
    countGameLogSessionEvent as countSessionEvent,
    GAME_LOG_TYPE_LABELS as TYPE_LABELS,
    getGameLogLocationTarget,
    getGameLogSessionKey,
    resolveGameLogSessionDuration as resolveSessionDuration,
    resolveGameLogWorldTarget as resolveWorldTarget
} from '../gameLogRows.js';
import { appI18n } from '@/services/i18nService.js';

const SESSION_FILTER_TYPES = ['OnPlayerJoined', 'OnPlayerLeft', 'VideoPlay'];
function normalizeId(value) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

async function openGameLogUser(row) {
    const userId = normalizeId(row?.userId);
    const displayName = normalizeId(row?.displayName);
    if (userId) {
        openUserDialog({ userId, title: displayName || undefined });
        return;
    }
    if (!displayName) {
        return;
    }

    try {
        const lowerDisplayName = displayName.toLowerCase();
        const { auth } = useRuntimeStore.getState();
        const { friendsById } = useFriendRosterStore.getState();
        const localUser = [
            auth?.currentUserSnapshot,
            ...Object.values(friendsById || {})
        ].find((user) => {
            const name = normalizeId(
                user?.displayName || user?.username
            ).toLowerCase();
            return name && name === lowerDisplayName;
        });
        if (localUser?.id) {
            openUserDialog({
                userId: localUser.id,
                title: localUser.displayName || displayName,
                seedData: localUser
            });
            return;
        }

        const resolvedUserId = normalizeId(
            await gameLogRepository
                .getUserIdFromDisplayName(displayName)
                .catch(() => '')
        );
        if (resolvedUserId) {
            openUserDialog({ userId: resolvedUserId, title: displayName });
            return;
        }

        if (displayName.startsWith('ID:')) {
            toast.info(appI18n.t('view.game_log.generated_dynamic.no_user_id_was_found_for_value', { value: displayName }));
            return;
        }

        const response = await vrchatSearchRepository.getUsers(
            {
                search: displayName,
                n: 5,
                offset: 0
            },
            { endpoint: auth?.currentUserEndpoint || '' }
        );
        const rows = Array.isArray(response.json) ? response.json : [];
        const match = rows.find(
            (user) =>
                normalizeId(user?.displayName).toLowerCase() ===
                lowerDisplayName
        );
        if (match?.id) {
            openUserDialog({
                userId: match.id,
                title: match.displayName || displayName,
                seedData: match
            });
            return;
        }
        toast.info(appI18n.t('view.game_log.generated_dynamic.no_user_id_was_found_for_value', { value: displayName }));
    } catch (error) {
        toast.error(
            error instanceof Error
                ? error.message
                : appI18n.t('view.game_log.generated_toast.failed_to_look_up_value', { value: displayName })
        );
    }
}

function SortButton({ column, label }) {
    const direction = column.getIsSorted();

    return (
        <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-foreground h-auto justify-start px-0 py-0 text-left text-xs font-medium tracking-wide uppercase"
            onClick={() => column.toggleSorting(direction === 'asc')}
        >
            <span>{label}</span>
            {direction === 'asc' ? (
                <ArrowUpIcon data-icon="inline-end" />
            ) : direction === 'desc' ? (
                <ArrowDownIcon data-icon="inline-end" />
            ) : (
                <ArrowUpDownIcon data-icon="inline-end" />
            )}
        </Button>
    );
}

function GameLogEmptyState({ title, description }) {
    return <EmptyState title={title} description={description} />;
}

function EmptyTableValue() {
    return null;
}

function GameLogLocationDetail({
    row,
    detailValue,
    worldTarget,
    onPreviousInstances
}) {
    const location = getGameLogLocationTarget(row);
    const targetLocation = location || worldTarget;

    if (!targetLocation) {
        return (
            <div
                className="flex min-w-0 items-center gap-1.5 text-sm"
                title={[detailValue.primary, detailValue.secondary]
                    .filter(Boolean)
                    .join(' · ')}
            >
                <span className="min-w-0 truncate">{detailValue.primary}</span>
                {detailValue.secondary ? (
                    <span className="text-muted-foreground min-w-0 truncate text-xs">
                        {detailValue.secondary}
                    </span>
                ) : null}
            </div>
        );
    }

    return (
        <div
            className="flex min-w-0 items-center gap-1.5 text-sm"
            title={[detailValue.primary, detailValue.secondary]
                .filter(Boolean)
                .join(' · ')}
        >
            <Location
                location={targetLocation}
                hint={row?.worldName || detailValue.primary}
                grouphint={row?.groupName || ''}
                enableContextMenu
                showLaunchActions
                onShowPreviousInstances={() => void onPreviousInstances?.(row)}
                className="text-sm"
            />
            {detailValue.secondary ? (
                <span className="text-muted-foreground min-w-0 truncate text-xs">
                    {detailValue.secondary}
                </span>
            ) : null}
        </div>
    );
}

function TypeFilterDropdown({ types, selectedTypes, onSelectedTypesChange }) {
    const { t } = useI18n();

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    type="button"
                    variant="outline"
                    className="min-w-44 justify-between"
                >
                    <span>
                        {selectedTypes.length
                            ? `${selectedTypes.length}/${types.length}`
                            : t('view.game_log.filter_placeholder')}
                    </span>
                    <ChevronRightIcon
                        data-icon="inline-end"
                        className="text-muted-foreground rotate-90"
                    />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
                <DropdownMenuGroup>
                    <DropdownMenuItem
                        onSelect={() => onSelectedTypesChange([])}
                    >
                        {t('view.search.avatar.all')}
                    </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                    {types.map((type) => (
                        <DropdownMenuCheckboxItem
                            key={type}
                            checked={selectedTypes.includes(type)}
                            onSelect={(event) => event.preventDefault()}
                            onCheckedChange={(checked) => {
                                onSelectedTypesChange(
                                    checked
                                        ? [...selectedTypes, type]
                                        : selectedTypes.filter(
                                              (entry) => entry !== type
                                          )
                                );
                            }}
                        >
                            {t(`view.game_log.filters.${type}`)}
                        </DropdownMenuCheckboxItem>
                    ))}
                </DropdownMenuGroup>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

function TypeFilterToggleGroup({
    types,
    selectedTypes,
    onSelectedTypesChange,
    className = 'flex min-w-0 flex-wrap items-center gap-1'
}) {
    const { t } = useI18n();

    function toggleType(type) {
        const nextTypes = selectedTypes.includes(type)
            ? selectedTypes.filter((entry) => entry !== type)
            : [...selectedTypes, type];

        onSelectedTypesChange(
            nextTypes.length === types.length ? [] : nextTypes
        );
    }

    return (
        <div className={className}>
            <Button
                type="button"
                variant={selectedTypes.length === 0 ? 'default' : 'outline'}
                size="sm"
                onClick={() => onSelectedTypesChange([])}
            >
                {t('view.search.avatar.all')}
            </Button>
            {types.map((type) => (
                <Button
                    key={type}
                    type="button"
                    variant={
                        selectedTypes.includes(type) ? 'default' : 'outline'
                    }
                    size="sm"
                    onClick={() => toggleType(type)}
                >
                    {t(`view.game_log.filters.${type}`)}
                </Button>
            ))}
        </div>
    );
}

function renderSessionMember(member) {
    const displayName = member?.displayName || '';
    const userId = normalizeId(member?.userId);
    const canOpenUser = Boolean(userId || member?.displayName);

    return (
        <div
            key={`${userId}:${member?.created_at || displayName}`}
            className="text-muted-foreground hover:bg-muted/30 flex items-center gap-1 rounded px-2 py-px text-sm"
        >
            {canOpenUser ? (
                <Button
                    type="button"
                    variant="ghost"
                    className="hover:text-primary h-auto p-0 text-sm"
                    onClick={() => void openGameLogUser(member)}
                >
                    {displayName}
                </Button>
            ) : (
                <span>{displayName}</span>
            )}
            {member?.isFriend ? (
                <span>{member?.isFavorite ? '⭐' : '💚'}</span>
            ) : null}
        </div>
    );
}

function SessionEventRow({ event }) {
    const { t } = useI18n();
    const isJoin =
        event.type === 'OnPlayerJoined' || event.type === 'JoinGroup';
    const isLeave = event.type === 'OnPlayerLeft' || event.type === 'LeftGroup';
    const isVideo = event.type === 'VideoPlay';
    const [isExpanded, setIsExpanded] = useState(false);
    const userId = normalizeId(event?.userId);
    const displayName = event?.displayName || '';
    const eventLabel =
        event.type === 'JoinGroup'
            ? TYPE_LABELS.OnPlayerJoined
            : event.type === 'LeftGroup'
              ? TYPE_LABELS.OnPlayerLeft
              : TYPE_LABELS[event.type] || event.type || '';
    const EventIcon = isJoin
        ? LogInIcon
        : isLeave
          ? LogOutIcon
          : isVideo
            ? VideoIcon
            : LogsIcon;
    const groupMembers = Array.isArray(event?.members) ? event.members : [];
    const isGroup = event.type === 'JoinGroup' || event.type === 'LeftGroup';
    const videoLabel =
        event?.videoName ||
        event?.videoUrl ||
        event?.videoId ||
        'Unknown Video';
    const showVideoLink =
        isVideo &&
        event?.videoUrl &&
        event.videoId !== 'LSMedia' &&
        event.videoId !== 'PopcornPalace';

    if (isGroup) {
        const count = groupMembers.length || event?.count || 0;

        return (
            <div className="py-0.5">
                <Button
                    type="button"
                    variant="ghost"
                    className="text-muted-foreground hover:bg-muted/50 flex min-h-7 w-full cursor-pointer items-center gap-1.5 rounded border-none bg-transparent px-2 py-0.5 text-left text-sm"
                    onClick={() => setIsExpanded((current) => !current)}
                >
                    <span className="text-muted-foreground min-w-[5.5rem] shrink-0 text-xs tabular-nums">
                        {formatDateFilter(event?.created_at, 'short')}
                    </span>
                    <div className="min-w-[7rem] shrink-0">
                        <Badge
                            variant="outline"
                            className="text-muted-foreground justify-center"
                        >
                            {eventLabel}
                        </Badge>
                    </div>
                    <span className="flex-1 font-medium">
                        {count} {t('view.game_log.generated.player')}{count === 1 ? '' : 's'}{' '}
                        {isJoin ? 'joined' : 'left'}
                    </span>
                    <ChevronRightIcon
                        data-icon="inline-end"
                        className={cn(
                            'text-muted-foreground shrink-0 transition-transform duration-150',
                            isExpanded && 'rotate-90'
                        )}
                    />
                </Button>
                {isExpanded ? (
                    <div className="py-0.5 pb-1 pl-20">
                        {groupMembers.map(renderSessionMember)}
                    </div>
                ) : null}
            </div>
        );
    }

    return (
        <div className={cn('py-0.5', isLeave && 'text-muted-foreground')}>
            <div className="hover:bg-muted/50 flex min-h-7 items-center gap-1.5 rounded px-2 py-0.5 text-sm">
                <span className="text-muted-foreground min-w-[5.5rem] shrink-0 text-xs tabular-nums">
                    {formatDateFilter(event?.created_at, 'short')}
                </span>
                <div className="min-w-[7rem] shrink-0">
                    <Badge
                        variant="outline"
                        className="text-muted-foreground justify-center"
                    >
                        {eventLabel}
                    </Badge>
                </div>

                {isVideo ? (
                    <ContextMenu>
                        <ContextMenuTrigger asChild>
                            <div className="flex min-w-0 flex-1 cursor-default items-center gap-1 truncate text-left">
                                <VideoIcon className="shrink-0 text-xs" />
                                {showVideoLink ? (
                                    <Button
                                        type="button"
                                        variant="link"
                                        className="text-foreground h-auto min-w-0 justify-start p-0 text-left font-normal"
                                        onClick={(eventObject) => {
                                            eventObject.stopPropagation();
                                            void openExternalLink(
                                                event.videoUrl
                                            );
                                        }}
                                    >
                                        <span className="truncate">
                                            {videoLabel}
                                        </span>
                                    </Button>
                                ) : (
                                    <span className="truncate">
                                        {videoLabel}
                                    </span>
                                )}
                                {event?.playCount > 1 ? (
                                    <Badge
                                        variant="secondary"
                                        className="h-4 shrink-0 px-1 text-xs"
                                    >
                                        {t(
                                            'view.game_log.sessions.play_count',
                                            { count: event.playCount }
                                        )}
                                    </Badge>
                                ) : null}
                            </div>
                        </ContextMenuTrigger>
                        <ContextMenuContent>
                            {showVideoLink ? (
                                <>
                                    <ContextMenuGroup>
                                        <ContextMenuItem
                                            onSelect={() =>
                                                void openExternalLink(
                                                    event.videoUrl
                                                )
                                            }
                                        >
                                            <ExternalLinkIcon data-icon="inline-start" />
                                            {t('common.actions.open_link')}
                                        </ContextMenuItem>
                                    </ContextMenuGroup>
                                    <ContextMenuSeparator />
                                </>
                            ) : null}
                            <ContextMenuGroup>
                                <ContextMenuItem
                                    onSelect={() =>
                                        void copyTextToClipboard(
                                            event?.videoUrl || videoLabel
                                        )
                                    }
                                >
                                    <CopyIcon data-icon="inline-start" />
                                    {t('common.actions.copy')}
                                </ContextMenuItem>
                            </ContextMenuGroup>
                        </ContextMenuContent>
                    </ContextMenu>
                ) : (
                    <Button
                        type="button"
                        variant="ghost"
                        className={cn(
                            'h-auto min-w-0 flex-1 justify-start gap-1 px-0 py-0 text-left font-normal',
                            userId || event?.displayName
                                ? 'cursor-pointer'
                                : 'cursor-default'
                        )}
                        onClick={() => void openGameLogUser(event)}
                    >
                        <EventIcon data-icon="inline-start" />
                        <span className="truncate">{displayName}</span>
                        {event?.isFriend ? (
                            <span className="ml-1">
                                {event?.isFavorite ? '⭐' : '💚'}
                            </span>
                        ) : null}
                    </Button>
                )}

                {isVideo && event?.displayName ? (
                    <span className="text-muted-foreground shrink-0 text-xs">
                        {event.displayName}
                    </span>
                ) : null}
            </div>
        </div>
    );
}

const GameLogSessionSegment = memo(function GameLogSessionSegment({
    sessionKey,
    session,
    isLast,
    isLatest,
    isGameRunning,
    collapsed = false,
    onCollapsedChange
}) {
    const { t } = useI18n();
    const worldTarget = resolveWorldTarget(session);
    const joinedCount = countSessionEvent(session.events, 'OnPlayerJoined');
    const leftCount = countSessionEvent(session.events, 'OnPlayerLeft');
    const videoCount = countSessionEvent(session.events, 'VideoPlay');
    const durationMs = resolveSessionDuration(session);
    const sessionStartedAt = Date.parse(session?.created_at);
    const shouldShowLiveDuration =
        durationMs <= 0 &&
        isLatest &&
        isGameRunning &&
        Number.isFinite(sessionStartedAt);
    const [liveNow, setLiveNow] = useState(() => Date.now());
    const liveDurationMs = shouldShowLiveDuration
        ? Math.max(0, liveNow - sessionStartedAt)
        : 0;
    const durationText =
        durationMs > 0
            ? timeToText(durationMs)
            : liveDurationMs > 0
              ? timeToText(liveDurationMs)
              : '';
    const sessionLocation = session.location || '';
    const toggleCollapsed = () => {
        if (sessionKey) {
            onCollapsedChange?.(sessionKey, !collapsed);
        }
    };

    useEffect(() => {
        if (!shouldShowLiveDuration) {
            return undefined;
        }
        const timerId = window.setInterval(
            () => setLiveNow(Date.now()),
            30_000
        );
        return () => {
            window.clearInterval(timerId);
        };
    }, [shouldShowLiveDuration]);

    return (
        <div className={cn('border-border border-b', isLast && 'border-b-0')}>
            <div className="border-border bg-muted/80 sticky top-0 z-[5] border-b transition-colors">
                <Button
                    type="button"
                    variant="ghost"
                    aria-expanded={!collapsed}
                    aria-label={
                        collapsed
                            ? 'Expand game log session'
                            : 'Collapse game log session'
                    }
                    className="hover:bg-muted absolute inset-0 z-0 h-full w-full rounded-none p-0"
                    onClick={toggleCollapsed}
                >
                    <span className="sr-only">
                        {collapsed
                            ? 'Expand game log session'
                            : 'Collapse game log session'}
                    </span>
                </Button>
                <div className="pointer-events-none relative z-10 flex w-full items-center gap-2 px-3 py-2 text-left">
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-expanded={!collapsed}
                        aria-label={
                            collapsed
                                ? 'Expand game log session'
                                : 'Collapse game log session'
                        }
                        className="pointer-events-auto -ml-1 size-6 shrink-0"
                        onClick={(event) => {
                            event.stopPropagation();
                            toggleCollapsed();
                        }}
                    >
                        <ChevronRightIcon
                            data-icon="inline-start"
                            className={cn(
                                'text-muted-foreground shrink-0 transition-transform duration-150',
                                !collapsed && 'rotate-90'
                            )}
                        />
                    </Button>
                    <div className="min-w-0 flex-1">
                        {sessionLocation ? (
                            <div className="flex min-w-0 items-center gap-1.5">
                                <Location
                                    location={sessionLocation}
                                    hint={session.worldName || worldTarget}
                                    grouphint={session.groupName || ''}
                                    enableContextMenu
                                    stopPropagation
                                    className="pointer-events-auto min-w-0 text-sm"
                                />
                                {durationText ? (
                                    <Badge
                                        variant="outline"
                                        className="h-4 shrink-0 px-1 text-xs tabular-nums"
                                        title={t('view.game_log.generated.time_spent_in_this_instance')}
                                    >
                                        {durationText}
                                    </Badge>
                                ) : null}
                            </div>
                        ) : (
                            <span className="truncate text-sm" />
                        )}
                    </div>
                    <span className="text-muted-foreground shrink-0 text-xs">
                        {formatDateFilter(session.created_at, 'long')}
                    </span>
                    {!durationText && isLatest && isGameRunning ? (
                        <Badge
                            variant="outline"
                            className="h-4 shrink-0 px-1 text-xs"
                        >
                            {t('common.current_session')}
                        </Badge>
                    ) : null}
                    <div className="text-muted-foreground ml-auto flex max-w-full min-w-0 shrink-0 items-center justify-end gap-2 text-xs">
                        {session.events?.length ? (
                            <>
                                {joinedCount ? (
                                    <span
                                        className="flex items-center gap-0.5"
                                        title={TYPE_LABELS.OnPlayerJoined}
                                    >
                                        <LogInIcon className="size-3" />{' '}
                                        {joinedCount}
                                    </span>
                                ) : null}
                                {leftCount ? (
                                    <span
                                        className="flex items-center gap-0.5"
                                        title={TYPE_LABELS.OnPlayerLeft}
                                    >
                                        <LogOutIcon className="size-3" />{' '}
                                        {leftCount}
                                    </span>
                                ) : null}
                                {videoCount ? (
                                    <span
                                        className="flex items-center gap-0.5"
                                        title={TYPE_LABELS.VideoPlay}
                                    >
                                        <VideoIcon className="size-3" />{' '}
                                        {videoCount}
                                    </span>
                                ) : null}
                            </>
                        ) : null}
                    </div>
                </div>
            </div>

            {!collapsed && session.events?.length ? (
                <div className="px-1 py-1">
                    {session.events.map((event, index) => (
                        <SessionEventRow
                            key={`${event.type}:${event.created_at}:${event.userId || event.videoUrl || index}`}
                            event={event}
                        />
                    ))}
                </div>
            ) : null}
        </div>
    );
});

function GameLogSessionsView({
    sessions,
    isGameRunning,
    hasMore = false,
    isLoadingMore = false,
    autoFill = false,
    autoFillKey = '',
    onLoadMore
}) {
    const { t } = useI18n();
    const scrollRef = useRef(null);
    const sentinelRef = useRef(null);
    const [autoFillAttempts, setAutoFillAttempts] = useState(0);
    const [collapsedSessionIds, setCollapsedSessionIds] = useState(
        () => new Set()
    );
    const sessionKeys = useMemo(
        () =>
            sessions
                .map((session) => getGameLogSessionKey(session))
                .filter(Boolean),
        [sessions]
    );
    const handleSessionCollapsedChange = useCallback(
        (sessionKey, nextCollapsed) => {
            if (!sessionKey) {
                return;
            }
            setCollapsedSessionIds((current) => {
                const isCollapsed = current.has(sessionKey);
                if (isCollapsed === nextCollapsed) {
                    return current;
                }

                const next = new Set(current);
                if (nextCollapsed) {
                    next.add(sessionKey);
                } else {
                    next.delete(sessionKey);
                }
                return next;
            });
        },
        []
    );

    useEffect(() => {
        setAutoFillAttempts(0);
    }, [autoFillKey]);

    useEffect(() => {
        setCollapsedSessionIds((current) => {
            const nextKeys = new Set(sessionKeys);
            let changed = false;
            const nextCollapsedIds = new Set();

            for (const key of current) {
                if (nextKeys.has(key)) {
                    nextCollapsedIds.add(key);
                } else {
                    changed = true;
                }
            }

            return changed ? nextCollapsedIds : current;
        });
    }, [sessionKeys]);

    useEffect(() => {
        if (!hasMore || isLoadingMore || typeof onLoadMore !== 'function') {
            return undefined;
        }

        const root = scrollRef.current;
        const sentinel = sentinelRef.current;
        if (!root || !sentinel || typeof IntersectionObserver !== 'function') {
            return undefined;
        }

        const observer = new IntersectionObserver(
            (entries) => {
                for (const entry of entries) {
                    if (entry.isIntersecting) {
                        onLoadMore();
                    }
                }
            },
            {
                root,
                rootMargin: '240px'
            }
        );

        observer.observe(sentinel);

        return () => {
            observer.disconnect();
        };
    }, [hasMore, isLoadingMore, onLoadMore, sessions.length]);

    useEffect(() => {
        if (
            !autoFill ||
            !hasMore ||
            isLoadingMore ||
            autoFillAttempts >= 3 ||
            typeof onLoadMore !== 'function'
        ) {
            return undefined;
        }

        const root = scrollRef.current;
        if (!root) {
            return undefined;
        }

        const timeoutId = window.setTimeout(() => {
            if (root.scrollHeight <= root.clientHeight + 16) {
                setAutoFillAttempts((current) => current + 1);
                onLoadMore();
            }
        }, 0);

        return () => {
            window.clearTimeout(timeoutId);
        };
    }, [
        autoFill,
        autoFillAttempts,
        hasMore,
        isLoadingMore,
        onLoadMore,
        sessions.length
    ]);

    return (
        <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-md border">
            <div
                ref={scrollRef}
                className="flex-1 overflow-x-hidden overflow-y-auto"
            >
                {sessions.map((session, index) => {
                    const sessionKey = getGameLogSessionKey(session);
                    return (
                        <GameLogSessionSegment
                            key={sessionKey || `session:${index}`}
                            sessionKey={sessionKey}
                            session={session}
                            isLatest={index === 0}
                            isLast={index === sessions.length - 1}
                            isGameRunning={isGameRunning}
                            collapsed={collapsedSessionIds.has(sessionKey)}
                            onCollapsedChange={handleSessionCollapsedChange}
                        />
                    );
                })}
                <div
                    ref={sentinelRef}
                    className="text-muted-foreground flex items-center justify-center py-4 pb-6 text-sm"
                >
                    {isLoadingMore ? (
                        <>
                            <Spinner
                                data-icon="inline-start"
                                className="mr-2"
                            />
                            {t('common.load_more')}...
                        </>
                    ) : hasMore ? (
                        <span>{t('common.load_more')}...</span>
                    ) : (
                        <span>{t('common.no_more')}</span>
                    )}
                </div>
            </div>
        </div>
    );
}
export {
    EmptyTableValue,
    GameLogEmptyState,
    GameLogLocationDetail,
    GameLogSessionsView,
    SESSION_FILTER_TYPES,
    SortButton,
    TypeFilterDropdown,
    TypeFilterToggleGroup,
    normalizeId,
    openGameLogUser
};
