// @ts-nocheck
import { ChevronRightIcon } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Location } from '@/components/Location';
import { formatDateFilter, timeToText } from '@/lib/dateTime.js';
import { cn } from '@/lib/utils.js';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger
} from '@/ui/shadcn/collapsible';
import { Spinner } from '@/ui/shadcn/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import {
    getGameLogSessionKey,
    resolveGameLogSessionDuration as resolveSessionDuration,
    resolveGameLogWorldTarget as resolveWorldTarget
} from '../gameLogRows.js';
import { SessionEventGroups } from './GameLogSessionEventRow';

const DEFAULT_OPEN_SESSION_COUNT = 3;

const GameLogSessionSegment = memo(function GameLogSessionSegment({
    sessionKey,
    session,
    isLast,
    isLatest,
    isGameRunning,
    isOpen = false,
    onOpenChange
}) {
    const { t } = useTranslation();
    const worldTarget = resolveWorldTarget(session);
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
    const handleOpenChange = (nextOpen) => {
        if (sessionKey) {
            onOpenChange?.(sessionKey, nextOpen);
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
                            <div className="flex min-w-0 items-center gap-1.5">
                                <Location
                                    location={sessionLocation}
                                    hint={session.worldName || worldTarget}
                                    grouphint={session.groupName || ''}
                                    enableContextMenu
                                    stopPropagation
                                    className="min-w-0 text-sm font-medium"
                                />
                                {durationText ? (
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Badge
                                                variant="outline"
                                                className="h-4 shrink-0 px-1 text-xs tabular-nums"
                                            >
                                                {durationText}
                                            </Badge>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                            {t(
                                                'view.game_log.label.time_spent_in_this_instance'
                                            )}
                                        </TooltipContent>
                                    </Tooltip>
                                ) : null}
                            </div>
                        ) : (
                            <span className="truncate text-sm" />
                        )}
                    </div>
                    {!durationText && isLatest && isGameRunning ? (
                        <Badge
                            variant="outline"
                            className="h-4 shrink-0 px-1 text-xs"
                        >
                            {t('common.current_session')}
                        </Badge>
                    ) : null}
                    <span className="text-muted-foreground ml-auto shrink-0 text-xs">
                        {formatDateFilter(session.created_at, 'long')}
                    </span>
                </div>
            </div>

            <CollapsibleContent>
                <SessionEventGroups events={session.events} />
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
}) {
    const { t } = useTranslation();
    const scrollRef = useRef(null);
    const sentinelRef = useRef(null);
    const [autoFillAttempts, setAutoFillAttempts] = useState(0);
    const [sessionOpenOverrides, setSessionOpenOverrides] = useState(
        () => new Map()
    );
    const handleSessionOpenChange = useCallback((sessionKey, nextOpen) => {
        if (!sessionKey) {
            return;
        }
        setSessionOpenOverrides((current) => {
            if (current.get(sessionKey) === nextOpen) {
                return current;
            }

            const next = new Map(current);
            next.set(sessionKey, nextOpen);
            return next;
        });
    }, []);

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
                    const isOpen = sessionKey
                        ? (sessionOpenOverrides.get(sessionKey) ??
                          index < DEFAULT_OPEN_SESSION_COUNT)
                        : index < DEFAULT_OPEN_SESSION_COUNT;
                    return (
                        <GameLogSessionSegment
                            key={sessionKey || `session:${index}`}
                            sessionKey={sessionKey}
                            session={session}
                            isLatest={index === 0}
                            isLast={index === sessions.length - 1}
                            isGameRunning={isGameRunning}
                            isOpen={isOpen}
                            onOpenChange={handleSessionOpenChange}
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
