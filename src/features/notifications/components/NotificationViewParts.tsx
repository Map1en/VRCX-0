import {
    BanIcon,
    BellOffIcon,
    CalendarIcon,
    CheckIcon,
    ExternalLinkIcon,
    GlobeIcon,
    MessageCircleIcon,
    PersonStandingIcon,
    ReplyIcon,
    TagIcon,
    UserIcon,
    UsersIcon,
    XIcon,
    type LucideIcon
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { DataTableSortButton } from '@/components/data-table/DataTableSortButton';
import { BoopEmojiDialog } from '@/components/dialogs/BoopEmojiDialog';
import { Location } from '@/components/Location';
import {
    NOTIFICATION_TYPES,
    type NotificationResponse
} from '@/repositories/notificationPersistenceRepository';
import { Button } from '@/ui/shadcn/button';
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';

import type { NotificationRow } from '../notificationPageTypes';
import { sanitizeNotificationFilters } from '../notificationTableState';

export function getResponseIcon(
    response: NotificationResponse | null | undefined,
    notificationType: unknown
): LucideIcon {
    if (response?.type === 'link') {
        return ExternalLinkIcon;
    }
    switch (response?.icon) {
        case 'check':
            return CheckIcon;
        case 'cancel':
            return XIcon;
        case 'ban':
            return BanIcon;
        case 'bell-slash':
            return BellOffIcon;
        case 'reply':
            return notificationType === 'boop' ? MessageCircleIcon : ReplyIcon;
        default:
            return TagIcon;
    }
}

function getNotificationLinkScheme(link: unknown) {
    const value = String(link || '').trim();
    const separatorIndex = value.indexOf(':');
    if (separatorIndex <= 0) {
        return '';
    }
    return value.slice(0, separatorIndex).toLowerCase();
}

export function getNotificationLinkIcon(link: unknown): LucideIcon {
    switch (getNotificationLinkScheme(link)) {
        case 'user':
            return UserIcon;
        case 'group':
            return UsersIcon;
        case 'event':
            return CalendarIcon;
        case 'world':
            return GlobeIcon;
        case 'avatar':
            return PersonStandingIcon;
        default:
            return ExternalLinkIcon;
    }
}

export function notificationLinkIsInternal(link: unknown) {
    return ['user', 'group', 'event', 'world', 'avatar'].includes(
        getNotificationLinkScheme(link)
    );
}

export { DataTableSortButton as SortButton };

export function NotificationLocationLink({
    location,
    worldName = '',
    groupName = ''
}: {
    groupName?: string;
    location: unknown;
    worldName?: string;
}) {
    const value = String(location || '').trim();
    if (!value) {
        return null;
    }

    return (
        <div className="text-muted-foreground max-w-xl text-xs">
            <Location
                location={value}
                hint={worldName}
                grouphint={groupName}
                asButton={false}
            />
        </div>
    );
}

export function NotificationTypeFilterDropdown({
    value,
    onChange,
    getTypeLabel = (type: unknown) => String(type)
}: {
    getTypeLabel?: (type: string) => string;
    onChange: (value: string[]) => void;
    value: string[];
}) {
    const { t } = useTranslation();

    const activeTypes = value;
    const filterLabel = t('view.notification.filter_placeholder');
    const label = activeTypes.length
        ? `${filterLabel} (${activeTypes.length})`
        : filterLabel;

    return (
        <DropdownMenu>
            <DropdownMenuTrigger
                render={
                    <Button
                        type="button"
                        variant="outline"
                        className="h-9 min-w-0 flex-1 basis-64 justify-start truncate"
                    >
                        {label}
                    </Button>
                }
            />
            <DropdownMenuContent
                align="start"
                className="max-h-96 w-80 overflow-y-auto"
            >
                <DropdownMenuGroup>
                    {NOTIFICATION_TYPES.map((type) => (
                        <DropdownMenuCheckboxItem
                            key={type}
                            checked={activeTypes.includes(type)}
                            onCheckedChange={(checked) => {
                                const nextTypes = checked
                                    ? [...activeTypes, type]
                                    : activeTypes.filter(
                                          (entry) => entry !== type
                                      );
                                onChange(
                                    sanitizeNotificationFilters(
                                        nextTypes,
                                        NOTIFICATION_TYPES
                                    )
                                );
                            }}
                            onClick={(event) => event.preventDefault()}
                        >
                            {getTypeLabel(type)}
                        </DropdownMenuCheckboxItem>
                    ))}
                </DropdownMenuGroup>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

export function BoopReplyDialog({
    request,
    isLocalUserVrcPlusSupporter,
    onOpenChange,
    onSend
}: {
    isLocalUserVrcPlusSupporter: boolean;
    onOpenChange: (open: boolean) => void;
    onSend: (
        notification: NotificationRow | null,
        emojiId: string
    ) => void | Promise<void>;
    request: NotificationRow | null;
}) {
    const open = Boolean(request);
    const notification = request || null;
    const displayName = notification?.senderUsername || 'this user';
    return (
        <BoopEmojiDialog
            open={open}
            isLocalUserVrcPlusSupporter={isLocalUserVrcPlusSupporter}
            targetLabel={displayName}
            sendDisabled={!notification?.senderUserId}
            onOpenChange={onOpenChange}
            onSend={(emojiId: string) => onSend(notification, emojiId)}
        />
    );
}
