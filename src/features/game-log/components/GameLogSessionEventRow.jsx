import {
    ChevronRightIcon,
    CopyIcon,
    ExternalLinkIcon,
    LogInIcon,
    LogOutIcon,
    LogsIcon,
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
    ContextMenu,
    ContextMenuContent,
    ContextMenuGroup,
    ContextMenuItem,
    ContextMenuSeparator,
    ContextMenuTrigger
} from '@/ui/shadcn/context-menu';

import { GAME_LOG_TYPE_LABELS as TYPE_LABELS } from '../gameLogRows.js';
import { normalizeId, openGameLogUser } from '../gameLogUserLookup.js';

function renderSessionMember(member, t) {
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
                    onClick={() => void openGameLogUser(member, t)}
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

export function SessionEventRow({ event }) {
    const { t } = useTranslation();
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
                        {count} {t('view.game_log.generated.player')}
                        {count === 1 ? '' : 's'} {isJoin ? 'joined' : 'left'}
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
                        {groupMembers.map((member) =>
                            renderSessionMember(member, t)
                        )}
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
                        onClick={() => void openGameLogUser(event, t)}
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
