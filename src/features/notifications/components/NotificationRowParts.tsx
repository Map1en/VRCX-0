import { SmileIcon, UserIcon } from 'lucide-react';

import { FadeInImage } from '@/components/media/FadeInImage';
import { cn } from '@/lib/utils';
import type { NotificationRow } from '@/repositories/notificationPersistenceRepository';
import { Avatar, AvatarFallback, AvatarImage } from '@/ui/shadcn/avatar';

import { getNotificationImageUrl } from '../notificationCenterUtils';
import { getDiscIcon } from '../notificationRowActions';
import type { NotificationViewModelEmoji } from '../notificationViewModel';

export function NotificationEmojiPreview({
    emoji,
    className = 'size-10',
    onClick
}: {
    className?: string;
    emoji: NotificationViewModelEmoji;
    onClick?: () => void;
}) {
    const fallback = (
        <span
            className={cn(
                'bg-muted text-muted-foreground flex shrink-0 items-center justify-center rounded-md',
                className
            )}
            title={emoji.name}
        >
            <SmileIcon className="size-4" />
        </span>
    );
    const preview = emoji.imageUrl ? (
        <FadeInImage
            src={emoji.imageUrl}
            alt={emoji.name}
            className={cn('shrink-0 rounded-md object-contain', className)}
            fallback={fallback}
        />
    ) : (
        fallback
    );
    if (!onClick) {
        return preview;
    }
    return (
        <button
            type="button"
            className="shrink-0 transition-transform ease-out active:scale-[0.97] motion-safe:duration-150"
            aria-label={emoji.name}
            onClick={onClick}
        >
            {preview}
        </button>
    );
}

export function NotificationPersonAvatar({
    notification,
    imageUrl,
    className = 'size-9'
}: {
    className?: string;
    imageUrl?: string;
    notification: NotificationRow;
}) {
    const resolvedImageUrl = imageUrl ?? getNotificationImageUrl(notification);
    return (
        <Avatar className={cn('shrink-0', className)}>
            {resolvedImageUrl ? (
                <AvatarImage src={resolvedImageUrl} alt="" />
            ) : null}
            <AvatarFallback>
                <UserIcon className="size-4" />
            </AvatarFallback>
        </Avatar>
    );
}

export function NotificationIconDisc({
    notification,
    imageUrl,
    className = 'size-9'
}: {
    className?: string;
    imageUrl?: string;
    notification: NotificationRow;
}) {
    const Icon = getDiscIcon(notification);
    const resolvedImageUrl = imageUrl ?? getNotificationImageUrl(notification);
    if (resolvedImageUrl) {
        return (
            <Avatar className={cn('shrink-0 rounded-md', className)}>
                <AvatarImage
                    src={resolvedImageUrl}
                    alt=""
                    className="rounded-md"
                />
                <AvatarFallback className="rounded-md">
                    <Icon className="size-4" />
                </AvatarFallback>
            </Avatar>
        );
    }
    return (
        <div
            className={cn(
                'bg-muted text-muted-foreground flex shrink-0 items-center justify-center rounded-md',
                className
            )}
        >
            <Icon className="size-4" />
        </div>
    );
}

export const NOTIFICATION_ROW_HOVER_REVEAL =
    'transition-opacity duration-150 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:focus-within:opacity-100 [@media(hover:hover)]:has-[[aria-expanded=true]]:opacity-100';
