// @ts-nocheck
import {
    ArrowDownIcon,
    ArrowUpDownIcon,
    ArrowUpIcon,
    CopyIcon,
    ExternalLinkIcon,
    GlobeIcon,
    UserIcon,
    UsersIcon
} from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { useKnownUserFact } from '@/domain/users/useKnownUser.js';
import { formatDateFilter } from '@/lib/dateTime.js';
import { copyTextToClipboard } from '@/lib/entityMedia.js';
import { userProfileRepository } from '@/repositories/index.js';
import {
    openGroupDialog,
    openUserDialog,
    openWorldDialog
} from '@/services/dialogService.js';
import {
    parseLocation,
    resolveFriendPresenceLocation
} from '@/shared/utils/location.js';
import { Button } from '@/ui/shadcn/button';
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuGroup,
    ContextMenuItem,
    ContextMenuSeparator,
    ContextMenuTrigger
} from '@/ui/shadcn/context-menu';

import {
    canRequestInviteFromFeedFriend,
    normalizeFeedId as normalizeId,
    resolveFeedUserDisplayName,
    resolveFeedUserId,
    UNKNOWN_FEED_USER_DISPLAY_NAME
} from '../feedRows.js';
import { FeedDetailCell, FeedExpandedRow } from './FeedDetailParts';
function resolvePresenceLocation(profile) {
    return resolveFriendPresenceLocation(profile);
}

function formatTimestamp(value) {
    if (!value) {
        return '-';
    }

    return formatDateFilter(value, 'short');
}

function formatTimestampLong(value) {
    if (!value) {
        return '-';
    }

    return formatDateFilter(value, 'long');
}

async function copyFeedText(text, label, t) {
    const value = String(text || '').trim();
    if (!value) {
        return;
    }
    await copyTextToClipboard(value);
    toast.success(
        t('view.feed.dynamic.value_copied', {
            value: label || 'Value'
        })
    );
}

function SortButton({ column, label }) {
    const direction = column.getIsSorted();

    return (
        <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-auto justify-start gap-1 px-1 py-0 text-left text-xs font-medium tracking-wide uppercase"
            onClick={() => column.toggleSorting(direction === 'asc')}
        >
            <span>{label}</span>
            {direction === 'asc' ? (
                <ArrowUpIcon data-icon="inline-end" />
            ) : direction === 'desc' ? (
                <ArrowDownIcon data-icon="inline-end" />
            ) : (
                <ArrowUpDownIcon data-icon="inline-end" />
            )}
        </Button>
    );
}

function FeedUserLink({
    row,
    friend,
    cachedDisplayName = '',
    endpoint = '',
    currentUserId = '',
    currentUserSnapshot = null,
    canSendInvite = false,
    canBoop = false,
    canUseFriendInstance,
    actions
}) {
    const { t } = useTranslation();

    const userId = resolveFeedUserId(row);
    const knownUser = useKnownUserFact(userId, { endpoint });
    const displayUser = friend
        ? {
              ...(knownUser || {}),
              ...friend,
              displayName: friend.displayName || knownUser?.displayName,
              username: friend.username || knownUser?.username
          }
        : knownUser;
    const displayName = resolveFeedUserDisplayName(
        row,
        displayUser,
        cachedDisplayName
    );
    const location = resolvePresenceLocation(friend || knownUser);
    const parsedLocation = parseLocation(location);
    const worldTarget = parsedLocation.worldId || '';
    const worldDialogTarget =
        parsedLocation.isRealInstance && parsedLocation.tag
            ? parsedLocation.tag
            : worldTarget;
    const groupTarget = parsedLocation.groupId || '';
    const isCurrentUser = Boolean(
        userId && userId === normalizeId(currentUserId)
    );
    const canRequestInvite = canRequestInviteFromFeedFriend(
        friend,
        currentUserSnapshot
    );
    const canUseFriendLocation = Boolean(
        !isCurrentUser &&
        parsedLocation.isRealInstance &&
        parsedLocation.worldId &&
        parsedLocation.instanceId &&
        canUseFriendInstance?.(location)
    );

    useEffect(() => {
        if (!userId || displayName !== UNKNOWN_FEED_USER_DISPLAY_NAME) {
            return;
        }

        userProfileRepository
            .getUserProfile({ userId, endpoint })
            .catch(() => {});
    }, [displayName, endpoint, userId]);

    const userLabel =
        displayName || UNKNOWN_FEED_USER_DISPLAY_NAME;

    const trigger = (
        <div className="flex min-w-0 flex-col gap-0.5">
            <Button
                type="button"
                variant="ghost"
                className="hover:text-primary h-auto max-w-full justify-start self-start text-left font-medium"
                disabled={!userId}
                onClick={() =>
                    openUserDialog({
                        userId,
                        title: userLabel,
                        seedData: displayUser || null
                    })
                }
            >
                <span className="max-w-full truncate">{userLabel}</span>
            </Button>
        </div>
    );

    return (
        <ContextMenu>
            <ContextMenuTrigger asChild>
                <span className="block min-w-0">{trigger}</span>
            </ContextMenuTrigger>
            <ContextMenuContent className="w-56">
                <ContextMenuGroup>
                    <ContextMenuItem
                        disabled={!userId}
                        onSelect={() =>
                            openUserDialog({
                                userId,
                                title: userLabel,
                                seedData: displayUser || null
                            })
                        }
                    >
                        <UserIcon />
                        {t('table.playerList.user')}
                    </ContextMenuItem>
                    <ContextMenuItem
                        disabled={!worldTarget}
                        onSelect={() =>
                            openWorldDialog({
                                worldId: worldDialogTarget,
                                title: friend?.worldName || worldTarget
                            })
                        }
                    >
                        <GlobeIcon />
                        {t('table.playerList.location')}
                    </ContextMenuItem>
                    <ContextMenuItem
                        disabled={!groupTarget}
                        onSelect={() =>
                            openGroupDialog({
                                groupId: groupTarget,
                                title: undefined
                            })
                        }
                    >
                        <UsersIcon />
                        {t('side_panel.groups')}
                    </ContextMenuItem>
                </ContextMenuGroup>
                <ContextMenuSeparator />
                <ContextMenuGroup>
                    <ContextMenuItem
                        disabled={!canUseFriendLocation}
                        onSelect={() => void actions?.launchLocation(location)}
                    >
                        <ExternalLinkIcon />
                        {t('dialog.launch.open_ingame')}
                    </ContextMenuItem>
                    <ContextMenuItem
                        disabled={!canUseFriendLocation}
                        onSelect={() =>
                            void actions?.selfInviteLocation(location)
                        }
                    >
                        <ExternalLinkIcon />
                        {t('dialog.launch.self_invite')}
                    </ContextMenuItem>
                </ContextMenuGroup>
                <ContextMenuSeparator />
                <ContextMenuGroup>
                    <ContextMenuItem
                        disabled={isCurrentUser || !canSendInvite}
                        onSelect={() => void actions?.sendInvite(friend || row)}
                    >
                        <ExternalLinkIcon />
                        {t('dialog.user.actions.invite')}
                    </ContextMenuItem>
                    <ContextMenuItem
                        disabled={isCurrentUser || !canRequestInvite}
                        onSelect={() =>
                            void actions?.requestInvite(friend || row)
                        }
                    >
                        <ExternalLinkIcon />
                        {t('dialog.user.actions.request_invite')}
                    </ContextMenuItem>
                    <ContextMenuItem
                        disabled={isCurrentUser || !canBoop}
                        onSelect={() => void actions?.sendBoop(friend || row)}
                    >
                        <ExternalLinkIcon />
                        {t('dialog.user.actions.send_boop')}
                    </ContextMenuItem>
                </ContextMenuGroup>
                <ContextMenuSeparator />
                <ContextMenuGroup>
                    <ContextMenuItem
                        disabled={!displayName}
                        onSelect={() =>
                            void copyFeedText(displayName, 'Display name', t)
                        }
                    >
                        <CopyIcon />
                        {t('dialog.user.info.copy_display_name')}
                    </ContextMenuItem>
                </ContextMenuGroup>
            </ContextMenuContent>
        </ContextMenu>
    );
}

export {
    FeedDetailCell,
    FeedExpandedRow,
    FeedUserLink,
    SortButton,
    formatTimestamp,
    formatTimestampLong
};
