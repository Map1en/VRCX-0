import {
    ChevronRightIcon,
    LogInIcon,
    LogOutIcon,
    VideoIcon
} from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Location } from '@/components/Location.jsx';
import { formatDateFilter, timeToText } from '@/lib/dateTime.js';
import { cn } from '@/lib/utils.js';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Spinner } from '@/ui/shadcn/spinner';

import {
    countGameLogSessionEvent as countSessionEvent,
    GAME_LOG_TYPE_LABELS as TYPE_LABELS,
    getGameLogSessionKey,
    resolveGameLogSessionDuration as resolveSessionDuration,
    resolveGameLogWorldTarget as resolveWorldTarget
} from '../gameLogRows.js';
import { SessionEventRow } from './GameLogSessionEventRow.jsx';

const GameLogSessionSegment = memo(function GameLogSessionSegment({
    sessionKey,
    session,
    isLast,
    isLatest,
    isGameRunning,
    collapsed = false,
    onCollapsedChange
}) {
    const { t } = useTranslation();
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
                                        title={t(
                                            'view.game_log.generated.time_spent_in_this_instance'
                                        )}
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

export function GameLogSessionsView({
    sessions,
    isGameRunning,
    hasMore = false,
    isLoadingMore = false,
    autoFill = false,
    autoFillKey = '',
    onLoadMore
}) {
    const { t } = useTranslation();
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
