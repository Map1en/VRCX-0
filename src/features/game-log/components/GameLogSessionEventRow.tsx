// @ts-nocheck
import {
    ChevronRightIcon,
    CopyIcon,
    ExternalLinkIcon,
    HeartIcon,
    StarIcon,
    VideoIcon
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { formatDateFilter } from '@/lib/dateTime.js';
import { copyTextToClipboard, openExternalLink } from '@/lib/entityMedia.js';
import { cn } from '@/lib/utils.js';
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

import { normalizeId, openGameLogUser } from '../gameLogUserLookup.js';

const VIDEO_SOURCE_WITHOUT_LINK = new Set(['LSMedia', 'PopcornPalace']);

function getEventLabel(event, t) {
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

function normalizeSessionMember(member, fallbackCreatedAt = '') {
    const userId = normalizeId(member?.userId);
    return {
        created_at: member?.created_at || fallbackCreatedAt || '',
        displayName: member?.displayName || '',
        userId,
        isFriend: Boolean(member?.isFriend),
        isFavorite: Boolean(member?.isFavorite)
    };
}

function getGroupMembers(event) {
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

function getGroupCount(event, members) {
    if (members.length > 0) {
        return members.length;
    }
    return Number.isFinite(event?.count) && event.count > 0 ? event.count : 0;
}

function AffinityBadges({ item }) {
    const { t } = useTranslation();

    if (!item?.isFriend) {
        return null;
    }

    return (
        <div className="flex shrink-0 items-center gap-1">
            {item.isFavorite ? (
                <Badge variant="secondary" className="h-4 px-1 text-[0.7rem]">
                    <StarIcon data-icon="inline-start" />
                    {t('view.game_log.sessions.favorite')}
                </Badge>
            ) : (
                <Badge variant="outline" className="h-4 px-1 text-[0.7rem]">
                    <HeartIcon data-icon="inline-start" />
                    {t('view.game_log.sessions.friend')}
                </Badge>
            )}
        </div>
    );
}

function PlayerNameButton({ item }) {
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
            onClick={() => void openGameLogUser(item, t)}
        >
            <span className="truncate">{displayName}</span>
        </Button>
    );
}

function PlayerActivityRow({ item, muted = false }) {
    return (
        <div
            className={cn(
                'hover:bg-muted/50 grid min-h-7 grid-cols-[5.5rem_minmax(0,1fr)_auto] items-center gap-2 rounded px-2 py-0.5 text-sm',
                muted && 'text-muted-foreground'
            )}
        >
            <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                {formatDateFilter(item?.created_at, 'short')}
            </span>
            <PlayerNameButton item={item} />
            <AffinityBadges item={item} />
        </div>
    );
}

function SinglePlayerActivityRow({ event, muted = false }) {
    const { t } = useTranslation();
    const item = normalizeSessionMember(event, event?.created_at);

    return (
        <div
            className={cn(
                'hover:bg-muted/50 grid min-h-7 grid-cols-[5.5rem_7rem_minmax(0,1fr)_auto] items-center gap-2 rounded px-2 py-0.5 text-sm',
                muted && 'text-muted-foreground'
            )}
        >
            <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                {formatDateFilter(event?.created_at, 'short')}
            </span>
            <Badge
                variant="outline"
                className="text-muted-foreground justify-center"
            >
                {getEventLabel(event, t)}
            </Badge>
            <PlayerNameButton item={item} />
            <AffinityBadges item={item} />
        </div>
    );
}

function GroupActivityRow({ event, isJoin }) {
    const { t } = useTranslation();
    const [isExpanded, setIsExpanded] = useState(false);
    const members = getGroupMembers(event);
    const count = getGroupCount(event, members);
    const label = getEventLabel(event, t);

    return (
        <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
            <CollapsibleTrigger asChild>
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground hover:bg-muted/50 grid min-h-7 w-full grid-cols-[5.5rem_7rem_minmax(0,1fr)_auto] items-center gap-2 rounded px-2 py-0.5 text-left text-sm"
                >
                    <span className="shrink-0 text-xs tabular-nums">
                        {formatDateFilter(event?.created_at, 'short')}
                    </span>
                    <Badge
                        variant="outline"
                        className="text-muted-foreground justify-center"
                    >
                        {label}
                    </Badge>
                    <span className="text-foreground min-w-0 truncate font-medium">
                        {t(
                            isJoin
                                ? 'view.game_log.sessions.players_joined'
                                : 'view.game_log.sessions.players_left',
                            { count }
                        )}
                    </span>
                    <ChevronRightIcon
                        data-icon="inline-end"
                        className={cn(
                            'shrink-0 transition-transform duration-150',
                            isExpanded && 'rotate-90'
                        )}
                    />
                </Button>
            </CollapsibleTrigger>
            {members.length ? (
                <CollapsibleContent>
                    <div className="pb-1 pl-20">
                        {members.map((member, index) => (
                            <PlayerActivityRow
                                key={`${member.userId}:${member.created_at}:${member.displayName}:${index}`}
                                item={member}
                                muted={!isJoin}
                            />
                        ))}
                    </div>
                </CollapsibleContent>
            ) : null}
        </Collapsible>
    );
}

function VideoActivityRow({ event }) {
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
                <div className="hover:bg-muted/50 grid min-h-7 grid-cols-[5.5rem_7rem_minmax(0,1fr)_auto] items-center gap-2 rounded px-2 py-0.5 text-sm">
                    <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                        {formatDateFilter(event?.created_at, 'short')}
                    </span>
                    <Badge
                        variant="outline"
                        className="text-muted-foreground justify-center"
                    >
                        {getEventLabel(event, t)}
                    </Badge>
                    <div className="flex min-w-0 items-center gap-1.5">
                        <VideoIcon className="text-muted-foreground size-3.5 shrink-0" />
                        {showVideoLink ? (
                            <Button
                                type="button"
                                variant="link"
                                className="text-foreground h-auto min-w-0 shrink justify-start p-0 text-left font-normal"
                                onClick={(eventObject) => {
                                    eventObject.stopPropagation();
                                    void openExternalLink(event.videoUrl);
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
                    ) : null}
                </div>
            </ContextMenuTrigger>
            <ContextMenuContent>
                {showVideoLink ? (
                    <>
                        <ContextMenuGroup>
                            <ContextMenuItem
                                onSelect={() =>
                                    void openExternalLink(event.videoUrl)
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
    );
}

function SessionEventRow({ event }) {
    const isJoin =
        event?.type === 'OnPlayerJoined' || event?.type === 'JoinGroup';
    const isLeave =
        event?.type === 'OnPlayerLeft' || event?.type === 'LeftGroup';

    if (event?.type === 'JoinGroup' || event?.type === 'LeftGroup') {
        return <GroupActivityRow event={event} isJoin={isJoin} />;
    }

    if (event?.type === 'VideoPlay') {
        return <VideoActivityRow event={event} />;
    }

    if (isJoin || isLeave) {
        return <SinglePlayerActivityRow event={event} muted={isLeave} />;
    }

    return null;
}

export function SessionEventGroups({ events }) {
    const visibleEvents = (events ?? []).filter((event) =>
        [
            'JoinGroup',
            'LeftGroup',
            'OnPlayerJoined',
            'OnPlayerLeft',
            'VideoPlay'
        ].includes(event?.type)
    );

    if (!visibleEvents.length) {
        return null;
    }

    return (
        <div className="flex flex-col gap-0.5 px-2 py-1.5">
            {visibleEvents.map((event, index) => (
                <SessionEventRow
                    key={`${event.type}:${event.created_at}:${event.userId || event.videoUrl || index}`}
                    event={event}
                />
            ))}
        </div>
    );
}
