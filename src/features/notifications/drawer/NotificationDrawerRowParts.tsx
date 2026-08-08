import { CalendarDaysIcon, LinkIcon } from 'lucide-react';

import { openNotificationLink } from '@/components/hosts/vrc-notification-center/notificationCenterUtils';
import { Location } from '@/components/Location';
import type { NotificationRow } from '@/repositories/notificationPersistenceRepository';
import { Button } from '@/ui/shadcn/button';
import { HoverCardContent } from '@/ui/shadcn/hover-card';
import { Separator } from '@/ui/shadcn/separator';

import {
    NotificationIconDisc,
    NotificationPersonAvatar
} from '../components/NotificationRowParts';
import {
    getFriendMessage,
    getGroupDisplayName,
    getHoverTitle,
    isFriendNotification,
    isGroupNotification
} from './notificationDrawerRowUtils';

export function NotificationLocationLine({
    notification
}: {
    notification: NotificationRow;
}) {
    if (notification?.type === 'invite' && notification?.details?.worldId) {
        return (
            <Location
                location={notification.details.worldId}
                hint={notification.details.worldName || ''}
                grouphint={notification.details.groupName || ''}
                link
                className="text-xs"
            />
        );
    }

    if (
        (notification?.type === 'group.queueReady' ||
            notification?.type === 'instance.closed') &&
        notification?.location
    ) {
        return (
            <Location
                location={notification.location}
                hint={notification.worldName || ''}
                grouphint={notification.groupName || ''}
                link
                className="text-xs"
            />
        );
    }

    if (notification?.link) {
        return (
            <Button
                type="button"
                variant="link"
                size="sm"
                className="hover:text-primary h-auto max-w-full justify-start p-0 text-left text-xs font-normal"
                onClick={() => openNotificationLink(notification.link)}
            >
                <LinkIcon data-icon="inline-start" />
                <span className="truncate">
                    {notification.linkText || notification.link}
                </span>
            </Button>
        );
    }

    return null;
}

export function NotificationHoverContent({
    notification,
    senderName,
    typeLabel,
    message,
    absoluteTime,
    actorImageUrl
}: {
    absoluteTime: string;
    actorImageUrl: string;
    message: string;
    notification: NotificationRow;
    senderName: string;
    typeLabel: string;
}) {
    const groupNotification = isGroupNotification(notification);
    const friendNotification = isFriendNotification(notification);
    const groupDisplayName = getGroupDisplayName(notification);
    const hoverTitle = getHoverTitle(notification);
    const friendMessage = getFriendMessage(notification);
    const fallbackTitle = senderName || notification?.type || 'Notification';

    return (
        <HoverCardContent
            side="left"
            sideOffset={8}
            className="w-72 p-3 sm:w-96"
        >
            {groupNotification ? (
                <>
                    <div className="mb-2 flex items-center gap-2">
                        <NotificationIconDisc
                            notification={notification}
                            imageUrl={actorImageUrl}
                        />
                        <div className="min-w-0">
                            <p className="truncate text-sm font-medium">
                                {groupDisplayName || fallbackTitle}
                            </p>
                            <p className="text-muted-foreground text-xs">
                                {typeLabel}
                            </p>
                        </div>
                    </div>
                    {hoverTitle ? (
                        <p className="mb-1 text-sm font-medium">{hoverTitle}</p>
                    ) : null}
                    {notification?.message ? (
                        <p className="text-muted-foreground text-xs leading-relaxed break-words whitespace-pre-line">
                            {notification.message}
                        </p>
                    ) : null}
                </>
            ) : friendNotification ? (
                <>
                    <div className="mb-2 flex items-center gap-2">
                        <NotificationPersonAvatar
                            notification={notification}
                            imageUrl={actorImageUrl}
                        />
                        <div className="min-w-0">
                            <p className="truncate text-sm font-medium">
                                {senderName}
                            </p>
                            <p className="text-muted-foreground text-xs">
                                {typeLabel}
                            </p>
                        </div>
                    </div>
                    <div className="mb-1 text-xs">
                        <NotificationLocationLine notification={notification} />
                    </div>
                    {friendMessage ? (
                        <p className="text-muted-foreground text-xs leading-relaxed break-words">
                            {friendMessage}
                        </p>
                    ) : null}
                </>
            ) : (
                <>
                    <div className="mb-2 flex items-center gap-2">
                        <NotificationIconDisc notification={notification} />
                        <div className="min-w-0">
                            <p className="truncate text-sm font-medium">
                                {fallbackTitle}
                            </p>
                            <p className="text-muted-foreground text-xs">
                                {typeLabel}
                            </p>
                        </div>
                    </div>
                    {notification?.title ? (
                        <p className="mb-1 text-sm font-medium">
                            {notification.title}
                        </p>
                    ) : null}
                    {message ? (
                        <p className="text-muted-foreground text-xs leading-relaxed break-words whitespace-pre-line">
                            {message}
                        </p>
                    ) : null}
                </>
            )}
            {absoluteTime ? (
                <>
                    <Separator className="my-2" />
                    <div className="text-muted-foreground flex items-center gap-2 text-xs">
                        <CalendarDaysIcon data-icon="inline-start" />
                        {absoluteTime}
                    </div>
                </>
            ) : null}
        </HoverCardContent>
    );
}
