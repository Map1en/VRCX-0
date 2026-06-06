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
    XIcon
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { DataTableSortButton } from '@/components/data-table/DataTableSortButton';
import { Location } from '@/components/Location';
import { BoopEmojiDialog } from '@/components/dialogs/BoopEmojiDialog';
import { NOTIFICATION_TYPES } from '@/repositories/notificationPersistenceRepository';
import { Button } from '@/ui/shadcn/button';
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';

import { sanitizeNotificationFilters } from '../notificationTableState';

export function getResponseIcon(response: any, notificationType: any) {
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

function getNotificationLinkScheme(link: any) {
    const value = String(link || '').trim();
    const separatorIndex = value.indexOf(':');
    if (separatorIndex <= 0) {
        return '';
    }
    return value.slice(0, separatorIndex).toLowerCase();
}

export function getNotificationLinkIcon(link: any) {
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

export function notificationLinkIsInternal(link: any) {
    return ['user', 'group', 'event', 'world', 'avatar'].includes(
        getNotificationLinkScheme(link)
    );
}

export { DataTableSortButton as SortButton };

export function NotificationLocationLink({
    location,
    worldName = '',
    groupName = ''
}: any) {
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
    getTypeLabel = (type: any) => type
}: any) {
    const { t } = useTranslation();

    const activeTypes = Array.isArray(value) ? value : [];
    const filterLabel = t('view.notification.filter_placeholder');
    const label = activeTypes.length
        ? `${filterLabel} (${activeTypes.length})`
        : filterLabel;

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    type="button"
                    variant="outline"
                    className="h-9 min-w-0 flex-1 basis-64 justify-start truncate"
                >
                    {label}
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
                align="start"
                className="max-h-96 w-80 overflow-y-auto"
            >
                <DropdownMenuGroup>
                    {NOTIFICATION_TYPES.map((type: any) => (
                        <DropdownMenuCheckboxItem
                            key={type}
                            checked={activeTypes.includes(type)}
                            onCheckedChange={(checked: any) => {
                                const nextTypes = checked
                                    ? [...activeTypes, type]
                                    : activeTypes.filter(
                                          (entry: any) => entry !== type
                                      );
                                onChange(
                                    sanitizeNotificationFilters(
                                        nextTypes,
                                        NOTIFICATION_TYPES
                                    )
                                );
                            }}
                            onSelect={(event: any) => event.preventDefault()}
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
    endpoint,
    isLocalUserVrcPlusSupporter,
    onOpenChange,
    onSend
}: any) {
    const open = Boolean(request);
    const notification = request || null;
    const displayName = notification?.senderUsername || 'this user';
    return (
        <BoopEmojiDialog
            open={open}
            endpoint={endpoint}
            isLocalUserVrcPlusSupporter={isLocalUserVrcPlusSupporter}
            targetLabel={displayName}
            sendDisabled={!notification?.senderUserId}
            onOpenChange={onOpenChange}
            onSend={(emojiId: string) => onSend(notification, emojiId)}
        />
    );
}
