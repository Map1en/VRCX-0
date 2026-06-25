import {
    ChevronRightIcon,
    CopyIcon,
    ExternalLinkIcon,
    UsersIcon,
    VideoIcon
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AffinityBadge } from '@/components/affinity/AffinityBadge';
import { formatDateFilter, timeToText } from '@/lib/dateTime';
import { cn } from '@/lib/utils';
import {
    copyTextToClipboard,
    openExternalLink
} from '@/services/entityMediaService';
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
import { openGameLogUser } from '../gameLogUserLookup';

const VIDEO_SOURCE_WITHOUT_LINK = new Set(['LSMedia', 'PopcornPalace']);

function getEventLabel(event: any, t: any) {
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

function normalizeSessionMember(member: any, fallbackCreatedAt: any = '') {
    const userId = normalizeId(member?.userId);
    return {
        created_at: member?.created_at || fallbackCreatedAt || '',
        displayName: member?.displayName || '',
        userId,
        isFriend: Boolean(member?.isFriend),
        isFavorite: Boolean(member?.isFavorite)
    };
}

function getGroupMembers(event: any) {
    if (Array.isArray(event?.members) && event.members.length > 0) {
        return event.members.map((member: any) =>
            normalizeSessionMember(member, event?.created_at)
        );
    }

    if (event?.displayName || event?.userId) {
        return [normalizeSessionMember(event, event?.created_at)];
    }

    return [];
}

function getGroupCount(event: any, members: any[]) {
    if (members.length > 0) {
        return members.length;
    }
    return Number.isFinite(event?.count) && event.count > 0 ? event.count : 0;
}

function EventTime({ value }: { value: unknown }) {
    return (
        <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
            {formatDateFilter(value, 'short')}
        </span>
    );
}

function EventBadge({ event }: { event: any }) {
    const { t } = useTranslation();

    return (
        <Badge
            variant="outline"
            className="text-muted-foreground h-5 justify-center px-1.5 text-xs font-normal"
        >
            {getEventLabel(event, t)}
        </Badge>
    );
}

function DurationBadge({ value }: { value: number }) {
    if (value <= 0) {
        return <span aria-hidden="true" />;
    }

    return (
        <Badge
            variant="outline"
            className="h-5 shrink-0 px-1.5 text-xs tabular-nums"
        >
            {timeToText(value)}
        </Badge>
    );
}

function PlayerNameButton({ item }: any) {
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
            className="hover:text-primary h-auto min-w-0 justify-start p-0 text-left font-normal"
            onClick={() => {
                openGameLogUser(item, t);
            }}
        >
            <span className="truncate">{displayName}</span>
        </Button>
    );
}

function PlayerCell({ item }: any) {
    return (
        <div className="flex min-w-0 items-center gap-1.5">
            <PlayerNameButton item={item} />
            <AffinityBadge
                isFriend={item?.isFriend}
                isFavorite={item?.isFavorite}
            />
        </div>
    );
}

function PlayerActivityRow({
    durationByKey,
    item
}: {
    durationByKey: Map<string, number>;
    item: any;
}) {
    return (
        <div className="hover:bg-muted/40 grid min-h-7 grid-cols-[5.75rem_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2 py-0.5 text-sm">
            <EventTime value={item?.created_at} />
            <PlayerCell item={item} />
            <DurationBadge
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
    event: any;
}) {
    const item = normalizeSessionMember(event, event?.created_at);

    return (
        <div className="hover:bg-muted/45 grid min-h-8 grid-cols-[5.75rem_7rem_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2 py-1 text-sm">
            <EventTime value={event?.created_at} />
            <EventBadge event={event} />
            <PlayerCell item={item} />
            <DurationBadge
                value={getGameLogSessionPlayerDuration(durationByKey, item)}
            />
        </div>
    );
}

function GroupActivityRow({ durationByKey, event }: any) {
    const { t } = useTranslation();
    const [isExpanded, setIsExpanded] = useState(false);
    const members = getGroupMembers(event);
    const count = getGroupCount(event, members);
    const friendCount = members.filter((member: any) => member.isFriend).length;

    return (
        <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
            <CollapsibleTrigger asChild>
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="hover:bg-muted/45 grid min-h-8 w-full grid-cols-[5.75rem_7rem_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2 py-1 text-left text-sm"
                >
                    <EventTime value={event?.created_at} />
                    <EventBadge event={event} />
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
                    <ChevronRightIcon
                        data-icon="inline-end"
                        className={cn(
                            'text-muted-foreground shrink-0 transition-transform duration-150',
                            isExpanded && 'rotate-90'
                        )}
                    />
                </Button>
            </CollapsibleTrigger>
            {members.length ? (
                <CollapsibleContent>
                    <div className="border-border/70 ml-[5.75rem] border-l pl-3">
                        {members.map((member: any, index: any) => (
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

function VideoActivityRow({ event }: any) {
    const { t } = useTranslation();
    const videoLabel =
        event?.videoName ||
        event?.videoUrl ||
        event?.videoId ||
        t('view.game_log.sessions.unknown_video');
    const showVideoLink =
        event?.videoUrl && !VIDEO_SOURCE_WITHOUT_LINK.has(event?.videoId);

    return (
        <ContextMenu>
            <ContextMenuTrigger asChild>
                <div className="hover:bg-muted/45 grid min-h-8 grid-cols-[5.75rem_7rem_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2 py-1 text-sm">
                    <EventTime value={event?.created_at} />
                    <EventBadge event={event} />
                    <div className="flex min-w-0 items-center gap-1.5">
                        <VideoIcon className="text-muted-foreground size-3.5 shrink-0" />
                        {showVideoLink ? (
                            <Button
                                type="button"
                                variant="link"
                                className="text-foreground h-auto min-w-0 shrink justify-start p-0 text-left font-normal"
                                onClick={(eventObject: any) => {
                                    eventObject.stopPropagation();
                                    openExternalLink(event.videoUrl);
                                }}
                            >
                                <span className="truncate">{videoLabel}</span>
                            </Button>
                        ) : (
                            <span className="min-w-0 truncate">
                                {videoLabel}
                            </span>
                        )}
                        {event?.playCount > 1 ? (
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
            </ContextMenuTrigger>
            <ContextMenuContent>
                {showVideoLink ? (
                    <>
                        <ContextMenuGroup>
                            <ContextMenuItem
                                onSelect={() => {
                                    openExternalLink(event.videoUrl);
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
                        onSelect={() => {
                            copyTextToClipboard(event?.videoUrl || videoLabel);
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
    event: any;
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

export function SessionEventGroups({ durationByKey = new Map(), events }: any) {
    const { t } = useTranslation();
    const visibleEvents = (events ?? []).filter((event: any) =>
        ['JoinGroup', 'LeftGroup', 'OnPlayerJoined', 'OnPlayerLeft'].includes(
            event?.type
        )
    );
    const videoEvents = (events ?? []).filter(
        (event: any) => event?.type === 'VideoPlay'
    );

    if (!visibleEvents.length && !videoEvents.length) {
        return null;
    }

    return (
        <div className="flex flex-col gap-0.5 px-2 py-1.5">
            {visibleEvents.map((event: any, index: any) => (
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
                        {videoEvents.map((event: any, index: any) => (
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
