import type { TFunction } from 'i18next';
import {
    ChevronRightIcon,
    CopyIcon,
    ExternalLinkIcon,
    LogInIcon,
    LogOutIcon,
    UsersIcon
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AffinityBadge } from '@/components/affinity/AffinityBadge';
import {
    LogFilterMenuItems,
    getLogFilterRowAttributes
} from '@/components/data-table/LogFilterContextMenu';
import { TimestampText } from '@/components/data-table/TimestampText';
import { timeToText } from '@/lib/dateTime';
import { cn } from '@/lib/utils';
import { copyTextToClipboard } from '@/services/clipboardService';
import { openExternalLink } from '@/services/entityMediaService';
import { openGameLogUser } from '@/services/gameLogUserDialogService';
import { normalizeString as normalizeId } from '@/shared/utils/string';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger
} from '@/ui/shadcn/collapsible';
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuGroup,
    ContextMenuItem,
    ContextMenuSeparator,
    ContextMenuTrigger
} from '@/ui/shadcn/context-menu';

import {
    getGameLogFilterTypeLabel,
    useGameLogFilterCommands
} from '../gameLogFilterCommands';
import { getGameLogSessionPlayerAffinity } from '../gameLogRows';
import {
    useGameLogSessionAffinity,
    type GameLogSessionAffinity
} from '../gameLogSessionAffinity';
import { getGameLogSessionPlayerDuration } from '../gameLogSessionDurations';
import type {
    GameLogSessionEvent,
    GameLogSessionMember
} from '../gameLogTypes';

const VIDEO_SOURCE_WITHOUT_LINK = new Set(['LSMedia', 'PopcornPalace']);
const PLAYER_EVENT_GRID_CLASS =
    'grid-cols-[4.75rem_1rem_1rem_minmax(0,16rem)_5.5rem_5rem]';

type SessionPlayerInput = Pick<
    GameLogSessionEvent,
    'created_at' | 'displayName' | 'userId'
>;

function getEventLabel(event: GameLogSessionEvent, t: TFunction) {
    if (event?.type === 'JoinGroup') {
        return t('view.game_log.filters.OnPlayerJoined');
    }
    if (event?.type === 'LeftGroup') {
        return t('view.game_log.filters.OnPlayerLeft');
    }
    return t(`view.game_log.filters.${event?.type}`, {
        defaultValue: event?.type || ''
    });
}

function normalizeSessionMember(
    member: SessionPlayerInput,
    { favoriteIdSet, friendIdSet }: GameLogSessionAffinity,
    fallbackCreatedAt = ''
): GameLogSessionMember {
    const userId = normalizeId(member?.userId);
    return {
        created_at: member?.created_at || fallbackCreatedAt || '',
        displayName: member?.displayName || '',
        userId,
        ...getGameLogSessionPlayerAffinity(member, favoriteIdSet, friendIdSet)
    };
}

function getGroupMembers(
    event: GameLogSessionEvent
): readonly SessionPlayerInput[] {
    if (Array.isArray(event?.members) && event.members.length > 0) {
        return event.members;
    }

    if (event?.displayName || event?.userId) {
        return [event];
    }

    return [];
}

function getGroupCount(event: GameLogSessionEvent, memberCount: number) {
    if (memberCount > 0) {
        return memberCount;
    }
    return typeof event.count === 'number' &&
        Number.isFinite(event.count) &&
        event.count > 0
        ? event.count
        : 0;
}

function EventTime({ value }: { value: string }) {
    return (
        <TimestampText
            value={value}
            format="time"
            className="text-muted-foreground shrink-0 text-xs tabular-nums"
        />
    );
}

function EventIcon({ event }: { event: GameLogSessionEvent }) {
    const isJoin =
        event?.type === 'OnPlayerJoined' || event?.type === 'JoinGroup';
    const Icon = isJoin ? LogInIcon : LogOutIcon;

    return (
        <Icon
            aria-hidden="true"
            className="text-muted-foreground size-3.5 shrink-0"
        />
    );
}

function EventLabel({ event }: { event: GameLogSessionEvent }) {
    const { t } = useTranslation();

    return (
        <span className="text-muted-foreground truncate text-xs">
            {getEventLabel(event, t)}
        </span>
    );
}

function DurationText({ value }: { value: number }) {
    if (value <= 0) {
        return <span aria-hidden="true" />;
    }

    return (
        <span className="text-foreground/80 shrink-0 text-right text-xs font-medium tabular-nums">
            {timeToText(value)}
        </span>
    );
}

function PlayerNameButton({ item }: { item: GameLogSessionMember }) {
    const { t } = useTranslation();
    const displayName =
        item?.displayName || t('view.game_log.sessions.unknown_user');
    const canOpenUser = Boolean(item?.userId || item?.displayName);

    if (!canOpenUser) {
        return (
            <span className="text-muted-foreground min-w-0 truncate">
                {displayName}
            </span>
        );
    }

    return (
        <Button
            type="button"
            variant="ghost"
            className="h-auto min-w-0 justify-start p-0 text-left font-medium hover:bg-transparent"
            onClick={() => {
                openGameLogUser(item, t);
            }}
        >
            <span className="truncate">{displayName}</span>
        </Button>
    );
}

function PlayerCell({ item }: { item: GameLogSessionMember }) {
    return <PlayerNameButton item={item} />;
}

function PlayerActivityRow({
    durationByKey,
    eventType,
    item,
    showDuration
}: {
    durationByKey: Map<string, number>;
    eventType: string;
    item: GameLogSessionMember;
    showDuration: boolean;
}) {
    const { t } = useTranslation();
    return (
        <div
            {...getLogFilterRowAttributes({
                userId: item.userId,
                userName: item.displayName,
                type: eventType,
                typeLabel: getGameLogFilterTypeLabel(eventType, t)
            })}
            className="grid min-h-7 grid-cols-[4.75rem_1rem_minmax(0,16rem)_5rem] items-center gap-2 rounded-md px-2 py-0.5 text-sm hover:bg-(--state-hover-surface)"
        >
            <EventTime value={item.created_at} />
            <AffinityBadge
                isFriend={item?.isFriend}
                isFavorite={item?.isFavorite}
                iconOnly
            />
            <PlayerCell item={item} />
            <DurationText
                value={
                    showDuration
                        ? getGameLogSessionPlayerDuration(durationByKey, item)
                        : 0
                }
            />
        </div>
    );
}

function SinglePlayerActivityRow({
    durationByKey,
    event,
    showDuration
}: {
    durationByKey: Map<string, number>;
    event: GameLogSessionEvent;
    showDuration: boolean;
}) {
    const { t } = useTranslation();
    const affinity = useGameLogSessionAffinity();
    const item = normalizeSessionMember(event, affinity, event?.created_at);
    const eventType = String(event.type || '');

    return (
        <div
            {...getLogFilterRowAttributes({
                userId: item.userId,
                userName: item.displayName,
                type: eventType,
                typeLabel: getGameLogFilterTypeLabel(eventType, t)
            })}
            className={cn(
                'grid min-h-8 items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-(--state-hover-surface)',
                PLAYER_EVENT_GRID_CLASS
            )}
        >
            <EventTime value={event.created_at} />
            <EventIcon event={event} />
            <AffinityBadge
                isFriend={item?.isFriend}
                isFavorite={item?.isFavorite}
                iconOnly
            />
            <PlayerCell item={item} />
            <EventLabel event={event} />
            <DurationText
                value={
                    showDuration
                        ? getGameLogSessionPlayerDuration(durationByKey, item)
                        : 0
                }
            />
        </div>
    );
}

function GroupMemberRows({
    members,
    createdAt,
    durationByKey,
    eventType,
    showDuration
}: {
    members: readonly SessionPlayerInput[];
    createdAt: string;
    durationByKey: Map<string, number>;
    eventType: string;
    showDuration: boolean;
}) {
    const affinity = useGameLogSessionAffinity();
    return (
        <div className="border-border/70 ml-6 border-l pl-3">
            {members.map((member, index) => {
                const item = normalizeSessionMember(
                    member,
                    affinity,
                    createdAt
                );
                return (
                    <PlayerActivityRow
                        key={`${item.userId}:${item.created_at}:${item.displayName}:${index}`}
                        durationByKey={durationByKey}
                        eventType={eventType}
                        item={item}
                        showDuration={showDuration}
                    />
                );
            })}
        </div>
    );
}

function GroupActivityRow({
    durationByKey,
    event
}: {
    durationByKey: Map<string, number>;
    event: GameLogSessionEvent;
}) {
    const { t } = useTranslation();
    const { favoriteIdSet, friendIdSet } = useGameLogSessionAffinity();
    const [isExpanded, setIsExpanded] = useState(false);
    const members = getGroupMembers(event);
    const count = getGroupCount(event, members.length);
    let friendCount = 0;
    for (const member of members) {
        const { isFriend } = getGameLogSessionPlayerAffinity(
            member,
            favoriteIdSet,
            friendIdSet
        );
        if (isFriend) {
            friendCount += 1;
        }
    }

    return (
        <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
            <CollapsibleTrigger
                render={
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        {...getLogFilterRowAttributes({
                            type: String(event.type || ''),
                            typeLabel: getGameLogFilterTypeLabel(
                                String(event.type || ''),
                                t
                            )
                        })}
                        className={cn(
                            'grid min-h-8 w-full items-center justify-start gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-(--state-hover-surface)',
                            PLAYER_EVENT_GRID_CLASS
                        )}
                    >
                        <EventTime value={event.created_at} />
                        <EventIcon event={event} />
                        <span aria-hidden="true" />
                        <span className="flex min-w-0 items-center gap-2 font-normal">
                            <span className="text-muted-foreground inline-flex shrink-0 items-center gap-1 tabular-nums">
                                <UsersIcon className="size-3.5 shrink-0" />
                                {count}
                            </span>
                            {friendCount > 0 ? (
                                <span className="text-muted-foreground min-w-0 truncate">
                                    {`· ${t('view.game_log.sessions.friends_count', { count: friendCount })}`}
                                </span>
                            ) : null}
                        </span>
                        <EventLabel event={event} />
                        <ChevronRightIcon
                            data-icon="inline-end"
                            className={cn(
                                'text-muted-foreground shrink-0 justify-self-end transition-transform duration-150',
                                isExpanded && 'rotate-90'
                            )}
                        />
                    </Button>
                }
            />
            {members.length ? (
                <CollapsibleContent>
                    <GroupMemberRows
                        members={members}
                        createdAt={event.created_at}
                        durationByKey={durationByKey}
                        eventType={String(event.type || '')}
                        showDuration={event?.type === 'LeftGroup'}
                    />
                </CollapsibleContent>
            ) : null}
        </Collapsible>
    );
}

function VideoActivityRow({ event }: { event: GameLogSessionEvent }) {
    const { t } = useTranslation();
    const filterCommands = useGameLogFilterCommands();
    const videoUrl = event.videoUrl || '';
    const videoLabel =
        event?.videoName ||
        videoUrl ||
        event?.videoId ||
        t('view.game_log.sessions.unknown_video');
    const showVideoLink = Boolean(
        videoUrl && !VIDEO_SOURCE_WITHOUT_LINK.has(event.videoId || '')
    );

    return (
        <ContextMenu>
            <ContextMenuTrigger
                render={
                    <div className="grid min-h-8 grid-cols-[4rem_minmax(0,1fr)_auto] items-baseline gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-(--state-hover-surface)">
                        <EventTime value={event.created_at} />
                        <div className="flex min-w-0 items-baseline gap-1.5">
                            {showVideoLink ? (
                                <Button
                                    type="button"
                                    variant="link"
                                    className="text-foreground h-auto min-w-0 shrink justify-start p-0 text-left font-normal whitespace-normal"
                                    onClick={(eventObject) => {
                                        eventObject.stopPropagation();
                                        openExternalLink(videoUrl);
                                    }}
                                >
                                    <span className="line-clamp-2 leading-tight break-words">
                                        {videoLabel}
                                    </span>
                                </Button>
                            ) : (
                                <span className="line-clamp-2 min-w-0 leading-tight break-words">
                                    {videoLabel}
                                </span>
                            )}
                            {typeof event.playCount === 'number' &&
                            event.playCount > 1 ? (
                                <Badge
                                    variant="secondary"
                                    className="h-4 shrink-0 px-1 text-xs"
                                >
                                    {t('view.game_log.sessions.play_count', {
                                        count: event.playCount
                                    })}
                                </Badge>
                            ) : null}
                        </div>
                        {event?.displayName ? (
                            <span className="text-muted-foreground max-w-40 min-w-0 truncate text-xs">
                                {t('view.game_log.sessions.played_by', {
                                    name: event.displayName
                                })}
                            </span>
                        ) : (
                            <span aria-hidden="true" />
                        )}
                    </div>
                }
            />
            <ContextMenuContent>
                {showVideoLink ? (
                    <>
                        <ContextMenuGroup>
                            <ContextMenuItem
                                onClick={() => {
                                    openExternalLink(videoUrl);
                                }}
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
                        onClick={() => {
                            void copyTextToClipboard(videoUrl || videoLabel, {
                                successMessage: t(
                                    'view.game_log.success.copied_game_log_detail'
                                )
                            });
                        }}
                    >
                        <CopyIcon data-icon="inline-start" />
                        {t('common.actions.copy')}
                    </ContextMenuItem>
                </ContextMenuGroup>
                <LogFilterMenuItems
                    commands={filterCommands}
                    target={{
                        type: 'VideoPlay',
                        typeLabel: getGameLogFilterTypeLabel('VideoPlay', t)
                    }}
                />
            </ContextMenuContent>
        </ContextMenu>
    );
}

function SessionVideoLane({
    events
}: {
    events: readonly GameLogSessionEvent[];
}) {
    const { t } = useTranslation();
    const [isOpen, setIsOpen] = useState(true);
    const [isExpanded, setIsExpanded] = useState(false);
    const [isOverflowing, setIsOverflowing] = useState(false);
    const listRef = useRef<HTMLDivElement | null>(null);
    const label = t('view.game_log.sessions.videos');

    useEffect(() => {
        const list = listRef.current;
        if (!list || typeof ResizeObserver !== 'function') {
            return undefined;
        }
        const measure = () =>
            setIsOverflowing(list.scrollHeight > list.clientHeight + 1);
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(list);
        return () => observer.disconnect();
    }, [events.length, isOpen]);

    return (
        <section
            aria-label={label}
            className="border-border mt-2 flex min-w-0 flex-col border-t pt-2 @min-[56rem]/session-body:mt-0 @min-[56rem]/session-body:min-h-30 @min-[56rem]/session-body:border-t-0 @min-[56rem]/session-body:border-l @min-[56rem]/session-body:pt-0 @min-[56rem]/session-body:pl-3"
        >
            <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-expanded={isOpen}
                className="text-muted-foreground h-7 justify-start gap-1.5 px-2 text-xs font-medium @min-[56rem]/session-body:hidden"
                onClick={() => setIsOpen((current) => !current)}
            >
                <ChevronRightIcon
                    data-icon="inline-start"
                    className={cn(
                        'transition-transform duration-150',
                        isOpen && 'rotate-90'
                    )}
                />
                {`${label} · ${events.length}`}
            </Button>
            <div className="text-muted-foreground hidden px-2 pb-1 text-xs font-medium @min-[56rem]/session-body:block">
                {label}
            </div>
            <div className="relative min-h-0 flex-1">
                <div
                    ref={listRef}
                    data-video-lane-list=""
                    className={cn(
                        'content-start gap-1 overflow-y-auto @min-[56rem]/session-body:grid',
                        !isExpanded &&
                            'max-h-48 @min-[56rem]/session-body:absolute @min-[56rem]/session-body:inset-0 @min-[56rem]/session-body:max-h-none',
                        isOpen ? 'grid' : 'hidden'
                    )}
                >
                    {events.map((event, index) => (
                        <VideoActivityRow
                            key={`${event.type}:${event.created_at}:${event.videoUrl || index}`}
                            event={event}
                        />
                    ))}
                </div>
            </div>
            {isOpen && (isExpanded || isOverflowing) ? (
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-expanded={isExpanded}
                    className="text-muted-foreground mt-1 h-7 justify-start self-start px-2 text-xs"
                    onClick={() => setIsExpanded((current) => !current)}
                >
                    {isExpanded
                        ? t('view.game_log.sessions.show_fewer_videos')
                        : t('view.game_log.sessions.show_all_videos', {
                              count: events.length
                          })}
                </Button>
            ) : null}
        </section>
    );
}

function SessionEventRow({
    durationByKey,
    event
}: {
    durationByKey: Map<string, number>;
    event: GameLogSessionEvent;
}) {
    const isJoin =
        event?.type === 'OnPlayerJoined' || event?.type === 'JoinGroup';
    const isLeave =
        event?.type === 'OnPlayerLeft' || event?.type === 'LeftGroup';

    if (event?.type === 'JoinGroup' || event?.type === 'LeftGroup') {
        return <GroupActivityRow durationByKey={durationByKey} event={event} />;
    }

    if (event?.type === 'VideoPlay') {
        return <VideoActivityRow event={event} />;
    }

    if (isJoin || isLeave) {
        return (
            <SinglePlayerActivityRow
                durationByKey={durationByKey}
                event={event}
                showDuration={isLeave}
            />
        );
    }

    return null;
}

export function SessionEventGroups({
    durationByKey = new Map(),
    events = []
}: {
    durationByKey?: Map<string, number>;
    events?: readonly GameLogSessionEvent[];
}) {
    const visibleEvents = events.filter((event) =>
        ['JoinGroup', 'LeftGroup', 'OnPlayerJoined', 'OnPlayerLeft'].includes(
            event?.type || ''
        )
    );
    const videoEvents = events.filter((event) => event?.type === 'VideoPlay');

    if (!visibleEvents.length && !videoEvents.length) {
        return null;
    }

    return (
        <div className="@container/session-body px-2 py-1.5">
            <div className="grid grid-cols-1 gap-x-3 @min-[56rem]/session-body:grid-cols-[36rem_minmax(0,1fr)]">
                <div className="flex min-w-0 flex-col gap-0.5">
                    {visibleEvents.map((event, index) => (
                        <SessionEventRow
                            key={`${event.type}:${event.created_at}:${event.userId || index}`}
                            durationByKey={durationByKey}
                            event={event}
                        />
                    ))}
                </div>
                {videoEvents.length ? (
                    <SessionVideoLane events={videoEvents} />
                ) : null}
            </div>
        </div>
    );
}
