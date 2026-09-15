import { CalendarDaysIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { Location } from '@/components/Location';
import type { NotificationRow } from '@/repositories/notificationPersistenceRepository';
import { HoverCardContent } from '@/ui/shadcn/hover-card';
import { Separator } from '@/ui/shadcn/separator';

import {
    NotificationIconDisc,
    NotificationPersonAvatar
} from '../components/NotificationRowParts';
import {
    getFriendMessage,
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

    return null;
}

function NotificationHoverHeader({
    avatar,
    title,
    typeLabel
}: {
    avatar: ReactNode;
    title: string;
    typeLabel: string;
}) {
    return (
        <div className="mb-2 flex min-w-0 items-center gap-2">
            {avatar}
            <p className="min-w-0 truncate text-sm font-medium">
                {title}
                <span className="text-muted-foreground font-normal">
                    {' · '}
                    {typeLabel}
                </span>
            </p>
        </div>
    );
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
    const hoverTitle = getHoverTitle(notification);
    const friendMessage = getFriendMessage(notification);
    const fallbackTitle = senderName || 'Notification';

    return (
        <HoverCardContent
            side="left"
            sideOffset={8}
            className="w-72 p-3 sm:w-96"
        >
            {groupNotification ? (
                <>
                    <NotificationHoverHeader
                        avatar={
                            <NotificationIconDisc
                                notification={notification}
                                imageUrl={actorImageUrl}
                            />
                        }
                        title={fallbackTitle}
                        typeLabel={typeLabel}
                    />
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
                    <NotificationHoverHeader
                        avatar={
                            <NotificationPersonAvatar
                                notification={notification}
                                imageUrl={actorImageUrl}
                            />
                        }
                        title={senderName}
                        typeLabel={typeLabel}
                    />
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
                    <NotificationHoverHeader
                        avatar={
                            <NotificationIconDisc notification={notification} />
                        }
                        title={fallbackTitle}
                        typeLabel={typeLabel}
                    />
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
