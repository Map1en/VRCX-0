import {
    ChevronRightIcon,
    ChevronsDownUpIcon,
    ChevronsUpDownIcon
} from 'lucide-react';
import {
    Fragment,
    memo,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState
} from 'react';
import { useTranslation } from 'react-i18next';

import { Location } from '@/components/Location';
import { UserHoverCard } from '@/components/user-hover-card/UserHoverCard';
import { formatDateFilter, timeToText } from '@/lib/dateTime';
import { cn } from '@/lib/utils';
import gameLogRepository from '@/repositories/gameLogRepository';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger
} from '@/ui/shadcn/collapsible';
import { Separator } from '@/ui/shadcn/separator';
import { Spinner } from '@/ui/shadcn/spinner';

import {
    collectGameLogSessionFriends,
    getGameLogSessionKey,
    resolveGameLogSessionDuration as resolveSessionDuration,
    resolveGameLogWorldTarget as resolveWorldTarget
} from '../gameLogRows';
import {
    buildGameLogSessionDurationDetails,
    createEmptyGameLogSessionDurationDetails,
    type GameLogSessionDurationDetails
} from '../gameLogSessionDurations';
import { openGameLogUser } from '../gameLogUserLookup';
import { SessionEventGroups } from './GameLogSessionEventRow';

const EMPTY_DURATION_BY_KEY = new Map<string, number>();
const FACEPILE_CLASSES = [
    'bg-rose-800 text-rose-100',
    'bg-orange-800 text-orange-100',
    'bg-amber-800 text-amber-100',
    'bg-emerald-800 text-emerald-100',
    'bg-teal-800 text-teal-100',
    'bg-cyan-800 text-cyan-100',
    'bg-sky-800 text-sky-100',
    'bg-blue-800 text-blue-100',
    'bg-indigo-800 text-indigo-100',
    'bg-violet-800 text-violet-100',
    'bg-fuchsia-800 text-fuchsia-100',
    'bg-pink-800 text-pink-100'
];

function facepileClass(key: string) {
    let hash = 0;
    for (let index = 0; index < key.length; index += 1) {
        hash = (hash * 31 + key.charCodeAt(index)) | 0;
    }
    return FACEPILE_CLASSES[Math.abs(hash) % FACEPILE_CLASSES.length];
}

function facepileInitial(name: string) {
    const trimmed = String(name || '').trim();
    if (!trimmed) {
        return '?';
    }
    return Array.from(trimmed)[0].toUpperCase();
}

function SessionFriendFacepile({ friends }: { friends: any[] }) {
    const { t } = useTranslation();
    const shown = friends.slice(0, 3);
    const extra = friends.length - shown.length;

    return (
        <div
            className="flex shrink-0 items-center"
            aria-label={t('view.game_log.sessions.friends_count', {
                count: friends.length
            })}
        >
            {shown.map((friend: any) => (
                <UserHoverCard
                    key={friend.key}
                    userId={friend.userId}
                    seed={friend}
                >
                    <button
                        type="button"
                        title={friend.displayName}
                        aria-label={friend.displayName}
                        onClick={(event: any) => {
                            event.stopPropagation();
                            openGameLogUser(friend, t);
                        }}
                        className={cn(
                            'border-background relative -ml-1.5 flex size-[18px] cursor-pointer items-center justify-center rounded-full border text-[0.625rem] font-medium first:ml-0 hover:z-10',
                            facepileClass(friend.key)
                        )}
                    >
                        {facepileInitial(friend.displayName)}
                    </button>
                </UserHoverCard>
            ))}
            {extra > 0 ? (
                <span className="text-muted-foreground ml-1 text-xs tabular-nums">
                    +{extra}
                </span>
            ) : null}
        </div>
    );
}
const sessionDurationDetailsCache = new Map<
    string,
    GameLogSessionDurationDetails
>();

type PlayerDurationDetailsState = GameLogSessionDurationDetails & {
    location: string;
};

function createPlayerDurationDetailsState({
    details = createEmptyGameLogSessionDurationDetails(),
    location
}: {
    details?: GameLogSessionDurationDetails;
    location: string;
}): PlayerDurationDetailsState {
    return {
        ...details,
        location
    };
}

function sessionStartValue(session: any) {
    return session?.created_at || session?.createdAt || '';
}

function sessionDayKey(session: any) {
    const value = sessionStartValue(session);
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return String(value || '').slice(0, 10);
    }
    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0')
    ].join('-');
}

function SessionDayDivider({ session }: any) {
    const value = sessionStartValue(session);
    const label = formatDateFilter(value, 'date');

    return (
        <div className="bg-background flex items-center gap-3 px-3 pt-2.5 pb-1">
            <span className="text-muted-foreground shrink-0 text-xs font-medium tracking-wide tabular-nums">
                {label}
            </span>
            <Separator className="flex-1 opacity-60" />
        </div>
    );
}

function formatSessionEventRange(summary: any, fallbackCreatedAt: any) {
    const firstEventAt = summary?.firstEventAt;
    const lastEventAt = summary?.lastEventAt;
    if (firstEventAt && lastEventAt && firstEventAt !== lastEventAt) {
        return `${formatDateFilter(firstEventAt, 'short')} - ${formatDateFilter(lastEventAt, 'short')}`;
    }
    return formatDateFilter(firstEventAt || fallbackCreatedAt, 'long');
}

function buildSessionSummary(events: any[] = []) {
    let firstEventAt = '';
    let lastEventAt = '';

    for (const event of events) {
        const eventTime = String(event?.created_at || '');
        if (!eventTime) {
            continue;
        }
        const eventEpoch = Date.parse(eventTime);
        const firstEpoch = Date.parse(firstEventAt);
        const lastEpoch = Date.parse(lastEventAt);
        if (
            !firstEventAt ||
            (Number.isFinite(eventEpoch) &&
                (!Number.isFinite(firstEpoch) || eventEpoch < firstEpoch))
        ) {
            firstEventAt = eventTime;
        }
        if (
            !lastEventAt ||
            (Number.isFinite(eventEpoch) &&
                (!Number.isFinite(lastEpoch) || eventEpoch > lastEpoch))
        ) {
            lastEventAt = eventTime;
        }
    }

    return {
        firstEventAt,
        lastEventAt
    };
}

const GameLogSessionSegment = memo(function GameLogSessionSegment({
    sessionKey,
    session,
    isLast,
    isLatest,
    isGameRunning,
    isOpen = false,
    onOpenChange
}: any) {
    const { t } = useTranslation();
    const worldTarget = resolveWorldTarget(session);
    const durationMs = resolveSessionDuration(session);
    const sessionStartedAt = Date.parse(session?.created_at);
    const sessionLocation = session.location || '';
    const shouldLoadDurationDetails =
        Boolean(sessionLocation) && (isOpen || durationMs <= 0);
    const [playerDurationDetails, setPlayerDurationDetails] =
        useState<PlayerDurationDetailsState>(() =>
            createPlayerDurationDetailsState({
                location: ''
            })
        );
    const playerMaxDurationMs =
        playerDurationDetails.location === sessionLocation
            ? playerDurationDetails.maxDurationMs
            : 0;
    const effectiveDurationMs = Math.max(durationMs, playerMaxDurationMs);
    const shouldShowLiveDuration =
        effectiveDurationMs <= 0 &&
        isLatest &&
        isGameRunning &&
        Number.isFinite(sessionStartedAt);
    const [liveNow, setLiveNow] = useState(() => Date.now());
    const liveDurationMs = shouldShowLiveDuration
        ? Math.max(0, liveNow - sessionStartedAt)
        : 0;
    const durationText =
        effectiveDurationMs > 0
            ? timeToText(effectiveDurationMs)
            : liveDurationMs > 0
              ? timeToText(liveDurationMs)
              : '';
    const summary = useMemo(
        () => buildSessionSummary(session?.events ?? []),
        [session?.events]
    );
    const eventRangeText = formatSessionEventRange(summary, session.created_at);
    const sessionFriends = useMemo(
        () => collectGameLogSessionFriends(session?.events ?? []),
        [session?.events]
    );
    const durationByKey =
        playerDurationDetails.location === sessionLocation
            ? playerDurationDetails.durationByKey
            : EMPTY_DURATION_BY_KEY;
    const handleOpenChange = (nextOpen: any) => {
        if (sessionKey) {
            onOpenChange?.(sessionKey, nextOpen);
        }
    };

    useEffect(() => {
        if (!sessionLocation) {
            setPlayerDurationDetails(
                createPlayerDurationDetailsState({
                    location: ''
                })
            );
            return undefined;
        }

        if (!shouldLoadDurationDetails) {
            return undefined;
        }

        const cachedDetails = sessionDurationDetailsCache.get(sessionLocation);
        if (cachedDetails) {
            setPlayerDurationDetails(
                createPlayerDurationDetailsState({
                    details: cachedDetails,
                    location: sessionLocation
                })
            );
            return undefined;
        }

        let active = true;
        setPlayerDurationDetails(
            createPlayerDurationDetailsState({
                location: sessionLocation
            })
        );

        gameLogRepository
            .getPlayerDetailFromInstance(sessionLocation)
            .then((rows: unknown) => {
                if (!active) {
                    return;
                }
                const details = buildGameLogSessionDurationDetails(
                    Array.isArray(rows) ? rows : []
                );
                sessionDurationDetailsCache.set(sessionLocation, details);
                setPlayerDurationDetails(
                    createPlayerDurationDetailsState({
                        details,
                        location: sessionLocation
                    })
                );
            })
            .catch(() => {
                if (!active) {
                    return;
                }
                const details = createEmptyGameLogSessionDurationDetails();
                sessionDurationDetailsCache.set(sessionLocation, details);
                setPlayerDurationDetails(
                    createPlayerDurationDetailsState({
                        details,
                        location: sessionLocation
                    })
                );
            });

        return () => {
            active = false;
        };
    }, [sessionLocation, shouldLoadDurationDetails]);

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
        <Collapsible
            open={isOpen}
            onOpenChange={handleOpenChange}
            className={cn('border-border border-b', isLast && 'border-b-0')}
        >
            <div className="border-border bg-muted/80 sticky top-0 z-[5] border-b transition-colors">
                <div className="flex min-h-9 w-full items-center gap-2 px-3 py-1.5 text-left">
                    <CollapsibleTrigger asChild>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            aria-label={t(
                                isOpen
                                    ? 'view.game_log.sessions.collapse_session'
                                    : 'view.game_log.sessions.expand_session'
                            )}
                            className="-ml-1 shrink-0"
                        >
                            <ChevronRightIcon
                                data-icon="inline-start"
                                className={cn(
                                    'text-muted-foreground shrink-0 transition-transform duration-150',
                                    isOpen && 'rotate-90'
                                )}
                            />
                        </Button>
                    </CollapsibleTrigger>
                    <div className="min-w-0 flex-1">
                        {sessionLocation ? (
                            <Location
                                location={sessionLocation}
                                hint={session.worldName || worldTarget}
                                grouphint={session.groupName || ''}
                                enableContextMenu
                                stopPropagation
                                className="min-w-0 text-sm font-normal"
                            />
                        ) : (
                            <span className="truncate text-sm" />
                        )}
                    </div>
                    {sessionFriends.length ? (
                        <SessionFriendFacepile friends={sessionFriends} />
                    ) : null}
                    {!durationText && isLatest && isGameRunning ? (
                        <Badge
                            variant="outline"
                            className="h-4 shrink-0 px-1 text-xs"
                        >
                            {t('common.current_session')}
                        </Badge>
                    ) : null}
                    <span className="text-muted-foreground ml-auto shrink-0 text-xs tabular-nums">
                        {durationText
                            ? `${eventRangeText} · ${durationText}`
                            : eventRangeText}
                    </span>
                </div>
            </div>

            <CollapsibleContent>
                <SessionEventGroups
                    durationByKey={durationByKey}
                    events={session.events}
                />
            </CollapsibleContent>
        </Collapsible>
    );
});

export function GameLogSessionsView({
    sessions,
    isGameRunning,
    hasMore = false,
    isLoadingMore = false,
    autoFill = false,
    autoFillKey = '',
    onLoadMore
}: any) {
    const { t } = useTranslation();
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const sentinelRef = useRef(null);
    const [autoFillAttempts, setAutoFillAttempts] = useState(0);
    const [sessionOpenOverrides, setSessionOpenOverrides] = useState(
        () => new Map()
    );
    const [defaultOpen, setDefaultOpen] = useState(true);
    const collapseAll = useCallback(() => {
        setSessionOpenOverrides(new Map());
        setDefaultOpen(false);
    }, []);
    const expandAll = useCallback(() => {
        setSessionOpenOverrides(new Map());
        setDefaultOpen(true);
    }, []);
    const allSessionsOpen = useMemo(
        () =>
            sessions.every((session: any) => {
                const sessionKey = getGameLogSessionKey(session);
                return sessionKey
                    ? (sessionOpenOverrides.get(sessionKey) ?? defaultOpen)
                    : defaultOpen;
            }),
        [defaultOpen, sessionOpenOverrides, sessions]
    );
    const handleSessionOpenChange = useCallback(
        (sessionKey: any, nextOpen: any) => {
            if (!sessionKey) {
                return;
            }
            setSessionOpenOverrides((current: any) => {
                if (current.get(sessionKey) === nextOpen) {
                    return current;
                }

                const next = new Map(current);
                next.set(sessionKey, nextOpen);
                return next;
            });
        },
        []
    );

    useEffect(() => {
        setAutoFillAttempts(0);
    }, [autoFillKey]);

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
            (entries: any) => {
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
                setAutoFillAttempts((current: any) => current + 1);
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
            {sessions.length ? (
                <div className="border-border flex shrink-0 items-center justify-end border-b px-2 py-1">
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground h-7 gap-1.5"
                        onClick={allSessionsOpen ? collapseAll : expandAll}
                    >
                        {allSessionsOpen ? (
                            <ChevronsDownUpIcon data-icon="inline-start" />
                        ) : (
                            <ChevronsUpDownIcon data-icon="inline-start" />
                        )}
                        {t(
                            allSessionsOpen
                                ? 'view.game_log.sessions.collapse_all'
                                : 'view.game_log.sessions.expand_all'
                        )}
                    </Button>
                </div>
            ) : null}
            <div
                ref={scrollRef}
                className="flex-1 overflow-x-hidden overflow-y-auto"
            >
                {sessions.map((session: any, index: any) => {
                    const sessionKey = getGameLogSessionKey(session);
                    const currentDayKey = sessionDayKey(session);
                    const previousDayKey =
                        index > 0 ? sessionDayKey(sessions[index - 1]) : '';
                    const showDayDivider =
                        Boolean(currentDayKey) &&
                        currentDayKey !== previousDayKey;
                    const isOpen = sessionKey
                        ? (sessionOpenOverrides.get(sessionKey) ?? defaultOpen)
                        : defaultOpen;
                    return (
                        <Fragment key={sessionKey || `session:${index}`}>
                            {showDayDivider ? (
                                <SessionDayDivider session={session} />
                            ) : null}
                            <GameLogSessionSegment
                                sessionKey={sessionKey}
                                session={session}
                                isLatest={index === 0}
                                isLast={index === sessions.length - 1}
                                isGameRunning={isGameRunning}
                                isOpen={isOpen}
                                onOpenChange={handleSessionOpenChange}
                            />
                        </Fragment>
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
