import type { TFunction } from 'i18next';
import {
    ChevronRightIcon,
    CopyIcon,
    ExternalLinkIcon,
    LogInIcon,
    LogOutIcon,
    UsersIcon,
    VideoIcon
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AffinityBadge } from '@/components/affinity/AffinityBadge';
import { formatDateFilter, timeToText } from '@/lib/dateTime';
import { cn } from '@/lib/utils';
import { copyTextToClipboard } from '@/services/clipboardService';
import { openExternalLink } from '@/services/entityMediaService';
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

import { getGameLogSessionPlayerDuration } from '../gameLogSessionDurations';
import type {
    GameLogSessionEvent,
    GameLogSessionMember
} from '../gameLogTypes';
import { openGameLogUser } from '../gameLogUserLookup';

const VIDEO_SOURCE_WITHOUT_LINK = new Set(['LSMedia', 'PopcornPalace']);
const PLAYER_EVENT_GRID_CLASS =
    'grid-cols-[4.75rem_1rem_minmax(0,1fr)_5.5rem_5rem]';

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
    member: GameLogSessionEvent | GameLogSessionMember,
    fallbackCreatedAt = ''
): GameLogSessionMember {
    const userId = normalizeId(member?.userId);
    return {
        created_at: member?.created_at || fallbackCreatedAt || '',
        displayName: member?.displayName || '',
        userId,
        isFriend: Boolean(member?.isFriend),
        isFavorite: Boolean(member?.isFavorite)
    };
}

function getGroupMembers(event: GameLogSessionEvent) {
    if (Array.isArray(event?.members) && event.members.length > 0) {
        return event.members.map((member) =>
            normalizeSessionMember(member, event?.created_at)
        );
    }

    if (event?.displayName || event?.userId) {
        return [normalizeSessionMember(event, event?.created_at)];
    }

    return [];
}

function getGroupCount(
    event: GameLogSessionEvent,
    members: readonly GameLogSessionMember[]
) {
    if (members.length > 0) {
        return members.length;
    }
    return typeof event.count === 'number' &&
        Number.isFinite(event.count) &&
        event.count > 0
        ? event.count
        : 0;
}

function EventTime({ value }: { value: unknown }) {
    return (
        <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
            {formatDateFilter(value, 'time')}
        </span>
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
            className="hover:text-primary h-auto min-w-0 justify-start p-0 text-left font-medium"
            onClick={() => {
                openGameLogUser(item, t);
            }}
        >
            <span className="truncate">{displayName}</span>
        </Button>
    );
}

function PlayerCell({ item }: { item: GameLogSessionMember }) {
    return (
        <div className="flex min-w-0 items-center gap-1.5">
            <PlayerNameButton item={item} />
            <AffinityBadge
                isFriend={item?.isFriend}
                isFavorite={item?.isFavorite}
                className="h-auto rounded-none bg-transparent px-0 font-normal"
            />
        </div>
    );
}

function PlayerActivityRow({
    durationByKey,
    item
}: {
    durationByKey: Map<string, number>;
    item: GameLogSessionMember;
}) {
    return (
        <div className="hover:bg-muted/35 grid min-h-7 grid-cols-[4.75rem_minmax(0,1fr)_5rem] items-center gap-2 rounded-md px-2 py-0.5 text-sm">
            <EventTime value={item?.created_at} />
            <PlayerCell item={item} />
            <DurationText
                value={getGameLogSessionPlayerDuration(durationByKey, item)}
            />
        </div>
    );
}

function SinglePlayerActivityRow({
    durationByKey,
    event
}: {
    durationByKey: Map<string, number>;
    event: GameLogSessionEvent;
}) {
    const item = normalizeSessionMember(event, event?.created_at);

    return (
        <div
            className={cn(
                'hover:bg-muted/35 grid min-h-8 items-center gap-2 rounded-md px-2 py-1 text-sm',
                PLAYER_EVENT_GRID_CLASS
            )}
        >
            <EventTime value={event?.created_at} />
            <EventIcon event={event} />
            <PlayerCell item={item} />
            <EventLabel event={event} />
            <DurationText
                value={getGameLogSessionPlayerDuration(durationByKey, item)}
            />
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
    const [isExpanded, setIsExpanded] = useState(false);
    const members = getGroupMembers(event);
    const count = getGroupCount(event, members);
    const friendCount = members.filter((member) => member.isFriend).length;

    return (
        <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
            <CollapsibleTrigger
                render={
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className={cn(
                            'hover:bg-muted/35 grid min-h-8 w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm',
                            PLAYER_EVENT_GRID_CLASS
                        )}
                    >
                        <EventTime value={event?.created_at} />
                        <EventIcon event={event} />
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
                    <div className="border-border/70 ml-6 border-l pl-3">
                        {members.map((member, index) => (
                            <PlayerActivityRow
                                key={`${member.userId}:${member.created_at}:${member.displayName}:${index}`}
                                durationByKey={durationByKey}
                                item={member}
                            />
                        ))}
                    </div>
                </CollapsibleContent>
            ) : null}
        </Collapsible>
    );
}

function VideoActivityRow({ event }: { event: GameLogSessionEvent }) {
    const { t } = useTranslation();
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
                    <div className="hover:bg-muted/35 grid min-h-8 grid-cols-[4.75rem_1rem_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2 py-1 text-sm">
                        <EventTime value={event?.created_at} />
                        <VideoIcon className="text-muted-foreground size-3.5 shrink-0" />
                        <div className="flex min-w-0 items-center gap-1.5">
                            {showVideoLink ? (
                                <Button
                                    type="button"
                                    variant="link"
                                    className="text-foreground h-auto min-w-0 shrink justify-start p-0 text-left font-normal"
                                    onClick={(eventObject) => {
                                        eventObject.stopPropagation();
                                        openExternalLink(videoUrl);
                                    }}
                                >
                                    <span className="truncate">
                                        {videoLabel}
                                    </span>
                                </Button>
                            ) : (
                                <span className="min-w-0 truncate">
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
                            <span className="text-muted-foreground min-w-0 truncate text-xs">
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
            </ContextMenuContent>
        </ContextMenu>
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
    const { t } = useTranslation();
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
        <div className="flex flex-col gap-0.5 px-2 py-1.5">
            {visibleEvents.map((event, index) => (
                <SessionEventRow
                    key={`${event.type}:${event.created_at}:${event.userId || index}`}
                    durationByKey={durationByKey}
                    event={event}
                />
            ))}
            {videoEvents.length ? (
                <div className="border-border mt-2 border-t pt-2">
                    <div className="text-muted-foreground px-2 pb-1 text-xs font-medium">
                        {t('view.game_log.sessions.videos')}
                    </div>
                    <div className="flex flex-col gap-0.5">
                        {videoEvents.map((event, index) => (
                            <VideoActivityRow
                                key={`${event.type}:${event.created_at}:${event.videoUrl || index}`}
                                event={event}
                            />
                        ))}
                    </div>
                </div>
            ) : null}
        </div>
    );
}
