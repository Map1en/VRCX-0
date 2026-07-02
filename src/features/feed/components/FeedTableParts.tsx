import {
    CopyIcon,
    EyeIcon,
    EyeOffIcon,
    ExternalLinkIcon,
    GlobeIcon,
    UserIcon,
    UsersIcon
} from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { DataTableSortButton } from '@/components/data-table/DataTableSortButton';
import { useKnownUserFact } from '@/domain/users/useKnownUser';
import { formatDateFilter } from '@/lib/dateTime';
import { cn } from '@/lib/utils';
import userProfileRepository from '@/repositories/userProfileRepository';
import {
    openGroupDialog,
    openUserDialog,
    openWorldDialog
} from '@/services/dialogService';
import { copyTextToClipboard, userImage } from '@/services/entityMediaService';
import {
    parseLocation,
    resolveFriendPresenceLocation
} from '@/shared/utils/location';
import { useFriendRosterStore } from '@/state/friendRosterStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { Avatar, AvatarFallback, AvatarImage } from '@/ui/shadcn/avatar';
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
} from '../feedRows';
import type { FeedFriendActions, FeedRow } from '../feedTypes';
import { FeedDetailCell } from './FeedDetailCell';
import { FeedExpandedRow } from './FeedExpandedRow';

function resolvePresenceLocation(profile: unknown) {
    return resolveFriendPresenceLocation(profile);
}

function formatTimestamp(value: unknown) {
    if (!value) {
        return '-';
    }

    return formatDateFilter(value, 'short');
}

function formatTimestampLong(value: unknown) {
    if (!value) {
        return '-';
    }

    return formatDateFilter(value, 'long');
}

async function copyFeedText(text: unknown, successMessage: string) {
    const value = String(text || '').trim();
    if (!value) {
        return;
    }
    await copyTextToClipboard(value);
    toast.success(successMessage);
}

function FeedUserLink({
    actions,
    avatarSize = 28,
    cachedDisplayName = '',
    className = '',
    row,
    showAvatar = false
}: {
    actions: FeedFriendActions;
    avatarSize?: number;
    cachedDisplayName?: string;
    className?: string;
    row: FeedRow;
    showAvatar?: boolean;
}) {
    const { t } = useTranslation();
    const userId = resolveFeedUserId(row);
    const currentEndpoint = useRuntimeStore(
        (state) => state.auth.currentUserEndpoint
    );
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const currentUserSnapshot = useRuntimeStore(
        (state) => state.auth.currentUserSnapshot
    );
    const friend = useFriendRosterStore((state) =>
        userId ? state.friendsById[userId] || null : null
    );
    const knownUser = useKnownUserFact(userId, { endpoint: currentEndpoint });
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
        actions.canUseFeedFriendLocation(location)
    );
    const isHiddenFromFeed = actions.isFeedUserHidden(userId);

    useEffect(() => {
        if (!userId || displayName !== UNKNOWN_FEED_USER_DISPLAY_NAME) {
            return;
        }

        userProfileRepository
            .getUserProfile({ userId, endpoint: currentEndpoint })
            .catch(() => {});
    }, [currentEndpoint, displayName, userId]);

    const userLabel = displayName || UNKNOWN_FEED_USER_DISPLAY_NAME;
    const imageUrl = showAvatar
        ? userImage(displayUser || null, true, '64')
        : '';
    const actionTarget = (friend || row) as FeedRow;

    return (
        <ContextMenu>
            <ContextMenuTrigger asChild>
                <Button
                    type="button"
                    variant="ghost"
                    className={cn(
                        'hover:text-primary h-auto max-w-full justify-start self-start text-left font-medium',
                        showAvatar && 'gap-2',
                        className
                    )}
                    disabled={!userId}
                    onClick={() =>
                        openUserDialog({
                            userId,
                            title: userLabel,
                            seedData: displayUser || null
                        })
                    }
                >
                    {showAvatar ? (
                        <Avatar
                            size="default"
                            style={{
                                height: avatarSize,
                                width: avatarSize
                            }}
                        >
                            {imageUrl ? (
                                <AvatarImage src={imageUrl} alt="" />
                            ) : null}
                            <AvatarFallback
                                className={cn(
                                    avatarSize >= 40 ? 'text-xs' : 'text-[10px]'
                                )}
                            >
                                <UserIcon
                                    className={
                                        avatarSize >= 40 ? 'size-4' : 'size-3.5'
                                    }
                                />
                            </AvatarFallback>
                        </Avatar>
                    ) : null}
                    <span
                        className={cn(
                            'truncate',
                            showAvatar ? 'min-w-0 flex-1' : 'max-w-full'
                        )}
                    >
                        {userLabel}
                    </span>
                </Button>
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
                        onSelect={() => {
                            actions.launchFeedFriendLocation(location);
                        }}
                    >
                        <ExternalLinkIcon />
                        {t('dialog.launch.open_ingame')}
                    </ContextMenuItem>
                    <ContextMenuItem
                        disabled={!canUseFriendLocation}
                        onSelect={() => {
                            actions.selfInviteFeedFriendLocation(location);
                        }}
                    >
                        <ExternalLinkIcon />
                        {t('dialog.launch.self_invite')}
                    </ContextMenuItem>
                </ContextMenuGroup>
                <ContextMenuSeparator />
                <ContextMenuGroup>
                    <ContextMenuItem
                        disabled={
                            isCurrentUser || !actions.canSendInviteFromFeed
                        }
                        onSelect={() => {
                            actions.sendFeedFriendInvite(actionTarget);
                        }}
                    >
                        <ExternalLinkIcon />
                        {t('dialog.user.actions.invite')}
                    </ContextMenuItem>
                    <ContextMenuItem
                        disabled={isCurrentUser || !canRequestInvite}
                        onSelect={() => {
                            actions.requestFeedFriendInvite(actionTarget);
                        }}
                    >
                        <ExternalLinkIcon />
                        {t('dialog.user.actions.request_invite')}
                    </ContextMenuItem>
                    <ContextMenuItem
                        disabled={isCurrentUser || !actions.canBoopFromFeed}
                        onSelect={() => {
                            actions.sendFeedFriendBoop(actionTarget);
                        }}
                    >
                        <ExternalLinkIcon />
                        {t('dialog.user.actions.send_boop')}
                    </ContextMenuItem>
                </ContextMenuGroup>
                <ContextMenuSeparator />
                <ContextMenuGroup>
                    {!isCurrentUser ? (
                        <ContextMenuItem
                            disabled={!userId}
                            onSelect={() => {
                                if (!userId) {
                                    return;
                                }
                                if (isHiddenFromFeed) {
                                    void actions.removeFeedHiddenUser(userId);
                                    return;
                                }
                                void actions.addFeedHiddenUser(userId);
                            }}
                        >
                            {isHiddenFromFeed ? <EyeIcon /> : <EyeOffIcon />}
                            {t(
                                isHiddenFromFeed
                                    ? 'view.feed.context.unhide_user'
                                    : 'view.feed.context.hide_user'
                            )}
                        </ContextMenuItem>
                    ) : null}
                    <ContextMenuItem
                        disabled={!displayName}
                        onSelect={() => {
                            copyFeedText(
                                displayName,
                                t('view.feed.dynamic.value_copied', {
                                    value: 'Display name'
                                })
                            );
                        }}
                    >
                        <CopyIcon />
                        {t('dialog.user.info.copy_display_name')}
                    </ContextMenuItem>
                </ContextMenuGroup>
            </ContextMenuContent>
        </ContextMenu>
    );
}

function FeedUserAvatarButton({
    avatarSize = 32,
    className = '',
    row
}: {
    avatarSize?: number;
    className?: string;
    row: FeedRow;
}) {
    const userId = resolveFeedUserId(row);
    const currentEndpoint = useRuntimeStore(
        (state) => state.auth.currentUserEndpoint
    );
    const friend = useFriendRosterStore((state) =>
        userId ? state.friendsById[userId] || null : null
    );
    const knownUser = useKnownUserFact(userId, { endpoint: currentEndpoint });
    const displayUser = friend
        ? {
              ...(knownUser || {}),
              ...friend,
              displayName: friend.displayName || knownUser?.displayName,
              username: friend.username || knownUser?.username
          }
        : knownUser;
    const displayName = resolveFeedUserDisplayName(row, displayUser);

    useEffect(() => {
        if (!userId || displayName !== UNKNOWN_FEED_USER_DISPLAY_NAME) {
            return;
        }

        userProfileRepository
            .getUserProfile({ userId, endpoint: currentEndpoint })
            .catch(() => {});
    }, [currentEndpoint, displayName, userId]);

    const userLabel = displayName || UNKNOWN_FEED_USER_DISPLAY_NAME;
    const imageUrl = userImage(displayUser || null, true, '64');

    return (
        <Button
            type="button"
            variant="ghost"
            className={cn('h-auto w-auto shrink-0 rounded-full p-0', className)}
            disabled={!userId}
            onClick={() =>
                openUserDialog({
                    userId,
                    title: userLabel,
                    seedData: displayUser || null
                })
            }
        >
            <Avatar
                size="default"
                style={{
                    height: avatarSize,
                    width: avatarSize
                }}
            >
                {imageUrl ? <AvatarImage src={imageUrl} alt="" /> : null}
                <AvatarFallback
                    className={cn(avatarSize >= 40 ? 'text-xs' : 'text-[10px]')}
                >
                    <UserIcon
                        className={avatarSize >= 40 ? 'size-4' : 'size-3.5'}
                    />
                </AvatarFallback>
            </Avatar>
        </Button>
    );
}

export {
    FeedDetailCell,
    FeedExpandedRow,
    FeedUserAvatarButton,
    FeedUserLink,
    DataTableSortButton as SortButton,
    formatTimestamp,
    formatTimestampLong
};
