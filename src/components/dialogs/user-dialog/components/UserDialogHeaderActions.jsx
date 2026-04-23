import {
    BanIcon,
    CheckIcon,
    CopyIcon,
    ExternalLinkIcon,
    MailIcon,
    MapPinIcon,
    MessageSquareIcon,
    MousePointerIcon,
    PencilIcon,
    RefreshCwIcon,
    SettingsIcon,
    Share2Icon,
    UserIcon,
    UserMinusIcon,
    UsersIcon,
    VolumeXIcon,
    XIcon
} from 'lucide-react';

import { FavoriteActionMenu } from '@/components/favorites/FavoriteActionMenu.jsx';
import { userImage } from '@/lib/entityMedia.js';
import { Button } from '@/ui/shadcn/button';

import {
    EntityActionDropdown,
    EntityActionItem,
    EntityActionSeparator
} from '../../EntityDialogScaffold.jsx';
import { SelfPreferenceCheckboxItem } from '../UserDialogViewParts.jsx';

export function UserDialogHeaderActions({
    profile,
    loadStatus,
    actionStatus,
    moderationState,
    extendedModerationState,
    avatarOverrideState,
    isCurrentUser,
    isFriend,
    friendRequestState,
    canInviteFromCurrentLocation,
    currentUserBoopingEnabled,
    currentAvatarTarget,
    fallbackAvatarTarget,
    previousInstances,
    userUrl,
    recentDialogShortcut,
    onOpenUserIcon,
    onRefresh,
    onCopyUserUrl,
    onOpenUserUrl,
    onCopyUserId,
    onEditMemo,
    onShowAvatarAuthor,
    onOpenFallbackAvatar,
    onEditSelfStatus,
    onEditSelfLanguages,
    onEditSelfBio,
    onEditSelfBioLinks,
    onEditSelfPronouns,
    onToggleSelfAvatarCopying,
    onToggleSelfBooping,
    onToggleSelfSharedConnections,
    onToggleSelfDiscordConnections,
    onFriendRequest,
    onInvite,
    onInviteMessage,
    onInviteRequest,
    onInviteRequestMessage,
    onBoop,
    onUnfriend,
    onInviteToGroup,
    onGroupModeration,
    onShowInstanceHistory,
    onModeration,
    onAvatarOverride,
    onExtendedModeration,
    onReportHacking,
    t
}) {
    const isBusy = loadStatus === 'running' || actionStatus !== 'idle';
    const actionsDisabled = actionStatus !== 'idle';

    return (
        <>
            {profile.userIcon ? (
                <Button
                    type="button"
                    variant="ghost"
                    className="bg-muted size-[120px] shrink-0 overflow-hidden rounded-md border p-0"
                    onClick={onOpenUserIcon}
                >
                    <img
                        src={userImage(profile, true, '256', true)}
                        alt=""
                        className="size-full object-cover"
                    />
                </Button>
            ) : null}
            {!isCurrentUser ? (
                <FavoriteActionMenu
                    kind="friend"
                    entityId={profile.id}
                    entity={profile}
                />
            ) : null}
            <EntityActionDropdown
                busy={isBusy}
                dangerous={moderationState.block || moderationState.mute}
                indicator={
                    friendRequestState.incoming || friendRequestState.outgoing
                }
            >
                <EntityActionItem
                    icon={RefreshCwIcon}
                    disabled={loadStatus === 'running'}
                    onSelect={onRefresh}
                >
                    {t('common.actions.refresh')}
                </EntityActionItem>
                {userUrl ? (
                    <>
                        <EntityActionItem
                            icon={Share2Icon}
                            onSelect={onCopyUserUrl}
                        >
                            {t('dialog.user.generated.share_copy_url')}
                        </EntityActionItem>
                        <EntityActionItem
                            icon={ExternalLinkIcon}
                            onSelect={onOpenUserUrl}
                        >
                            {t('dialog.user.generated.open_vrchat_page')}
                        </EntityActionItem>
                        <EntityActionItem icon={CopyIcon} onSelect={onCopyUserId}>
                            {t('dialog.user.generated.copy_user_id')}
                        </EntityActionItem>
                        <EntityActionSeparator />
                    </>
                ) : null}
                <EntityActionItem icon={UserIcon} onSelect={onEditMemo}>
                    {t('dialog.user.actions.edit_note_memo')}
                </EntityActionItem>
                {currentAvatarTarget ? (
                    <EntityActionItem
                        icon={UserIcon}
                        onSelect={() => void onShowAvatarAuthor()}
                    >
                        {t('dialog.user.actions.show_avatar_author')}
                    </EntityActionItem>
                ) : null}
                {fallbackAvatarTarget ? (
                    <EntityActionItem
                        icon={UserIcon}
                        onSelect={onOpenFallbackAvatar}
                    >
                        {t('dialog.user.actions.show_fallback_avatar')}
                    </EntityActionItem>
                ) : null}
                {isCurrentUser ? (
                    <>
                        <EntityActionSeparator />
                        <EntityActionItem
                            icon={PencilIcon}
                            disabled={actionsDisabled}
                            onSelect={onEditSelfStatus}
                        >
                            {t('dialog.user.actions.edit_status')}
                        </EntityActionItem>
                        <EntityActionItem
                            icon={PencilIcon}
                            disabled={actionsDisabled}
                            onSelect={onEditSelfLanguages}
                        >
                            {t('dialog.user.actions.edit_language')}
                        </EntityActionItem>
                        <EntityActionItem
                            icon={PencilIcon}
                            disabled={actionsDisabled}
                            onSelect={onEditSelfBio}
                        >
                            {t('dialog.user.actions.edit_bio')}
                        </EntityActionItem>
                        <EntityActionItem
                            icon={PencilIcon}
                            disabled={actionsDisabled}
                            onSelect={onEditSelfBioLinks}
                        >
                            {t('dialog.user.generated.edit_bio_links')}
                        </EntityActionItem>
                        <EntityActionItem
                            icon={PencilIcon}
                            disabled={actionsDisabled}
                            onSelect={onEditSelfPronouns}
                        >
                            {t('dialog.user.actions.edit_pronouns')}
                        </EntityActionItem>
                        <EntityActionSeparator />
                        <SelfPreferenceCheckboxItem
                            label={t('dialog.user.info.avatar_cloning')}
                            checked={Boolean(profile.allowAvatarCopying)}
                            disabled={actionsDisabled}
                            onToggle={onToggleSelfAvatarCopying}
                        />
                        <SelfPreferenceCheckboxItem
                            label={t('dialog.user.info.booping')}
                            checked={profile.isBoopingEnabled !== false}
                            disabled={actionsDisabled}
                            onToggle={onToggleSelfBooping}
                        />
                        <SelfPreferenceCheckboxItem
                            label={t('dialog.user.info.show_mutual_friends')}
                            checked={!profile.hasSharedConnectionsOptOut}
                            disabled={actionsDisabled}
                            onToggle={onToggleSelfSharedConnections}
                        />
                        <SelfPreferenceCheckboxItem
                            label={t('dialog.user.info.show_discord_connections')}
                            checked={!profile.hasDiscordFriendsOptOut}
                            disabled={actionsDisabled}
                            onToggle={onToggleSelfDiscordConnections}
                        />
                    </>
                ) : null}
                {!isCurrentUser ? (
                    <>
                        <EntityActionSeparator />
                        {!isFriend && friendRequestState.incoming ? (
                            <>
                                <EntityActionItem
                                    icon={CheckIcon}
                                    disabled={actionsDisabled}
                                    onSelect={() => onFriendRequest('accept')}
                                >
                                    {t('dialog.user.actions.accept_friend_request')}
                                </EntityActionItem>
                                <EntityActionItem
                                    icon={XIcon}
                                    destructive
                                    disabled={actionsDisabled}
                                    onSelect={() => onFriendRequest('decline')}
                                >
                                    {t('dialog.user.actions.decline_friend_request')}
                                </EntityActionItem>
                            </>
                        ) : !isFriend && friendRequestState.outgoing ? (
                            <EntityActionItem
                                icon={XIcon}
                                disabled={actionsDisabled}
                                onSelect={() => onFriendRequest('cancel')}
                            >
                                {t('dialog.user.actions.cancel_friend_request')}
                            </EntityActionItem>
                        ) : !isFriend ? (
                            <EntityActionItem
                                icon={UserIcon}
                                shortcut={recentDialogShortcut(
                                    'Send Friend Request'
                                )}
                                disabled={actionsDisabled}
                                onSelect={() => onFriendRequest('send')}
                            >
                                {t('dialog.user.actions.send_friend_request')}
                            </EntityActionItem>
                        ) : null}
                        {isFriend ? (
                            <>
                                <EntityActionItem
                                    icon={MessageSquareIcon}
                                    shortcut={recentDialogShortcut('Invite')}
                                    disabled={
                                        actionsDisabled ||
                                        !canInviteFromCurrentLocation
                                    }
                                    onSelect={onInvite}
                                >
                                    {t('dialog.user.generated.send_invite')}
                                </EntityActionItem>
                                <EntityActionItem
                                    icon={MessageSquareIcon}
                                    shortcut={recentDialogShortcut(
                                        'Invite Message'
                                    )}
                                    disabled={
                                        actionsDisabled ||
                                        !canInviteFromCurrentLocation
                                    }
                                    onSelect={onInviteMessage}
                                >
                                    {t('dialog.invite_message.header')}
                                </EntityActionItem>
                                <EntityActionItem
                                    icon={MailIcon}
                                    shortcut={recentDialogShortcut(
                                        'Request Invite'
                                    )}
                                    disabled={actionsDisabled}
                                    onSelect={onInviteRequest}
                                >
                                    {t('dialog.user.generated.request_invite')}
                                </EntityActionItem>
                                <EntityActionItem
                                    icon={MailIcon}
                                    shortcut={recentDialogShortcut(
                                        'Request Invite Message'
                                    )}
                                    disabled={actionsDisabled}
                                    onSelect={onInviteRequestMessage}
                                >
                                    {t('dialog.invite_request_message.header')}
                                </EntityActionItem>
                                <EntityActionItem
                                    icon={MousePointerIcon}
                                    disabled={
                                        actionsDisabled ||
                                        !currentUserBoopingEnabled
                                    }
                                    onSelect={onBoop}
                                >
                                    {t('dialog.user.generated.boop')}
                                </EntityActionItem>
                                <EntityActionItem
                                    icon={UserMinusIcon}
                                    destructive
                                    disabled={actionsDisabled}
                                    onSelect={onUnfriend}
                                >
                                    {t('dialog.user.actions.unfriend')}
                                </EntityActionItem>
                            </>
                        ) : null}
                        <EntityActionItem
                            icon={UsersIcon}
                            disabled={actionsDisabled}
                            onSelect={() => void onInviteToGroup()}
                        >
                            {t('dialog.user.actions.invite_to_group')}
                        </EntityActionItem>
                        <EntityActionItem
                            icon={SettingsIcon}
                            disabled={actionsDisabled}
                            onSelect={onGroupModeration}
                        >
                            {t('dialog.user.actions.group_moderation')}
                        </EntityActionItem>
                        <EntityActionSeparator />
                        <EntityActionItem
                            icon={MapPinIcon}
                            disabled={!previousInstances.length}
                            onSelect={onShowInstanceHistory}
                        >
                            {t('dialog.user.actions.show_previous_instances')}
                        </EntityActionItem>
                        <EntityActionItem
                            icon={BanIcon}
                            destructive={moderationState.block}
                            disabled={
                                actionsDisabled ||
                                (!moderationState.block &&
                                    Boolean(profile.$isModerator))
                            }
                            onSelect={() =>
                                onModeration('block', !moderationState.block)
                            }
                        >
                            {t(
                                moderationState.block
                                    ? 'dialog.user.actions.moderation_unblock'
                                    : 'dialog.user.actions.moderation_block'
                            )}
                        </EntityActionItem>
                        <EntityActionItem
                            icon={VolumeXIcon}
                            destructive={moderationState.mute}
                            disabled={
                                actionsDisabled ||
                                (!moderationState.mute &&
                                    Boolean(profile.$isModerator))
                            }
                            onSelect={() =>
                                onModeration('mute', !moderationState.mute)
                            }
                        >
                            {t(
                                moderationState.mute
                                    ? 'dialog.user.actions.moderation_unmute'
                                    : 'dialog.user.actions.moderation_mute'
                            )}
                        </EntityActionItem>
                        <EntityActionItem
                            icon={UserIcon}
                            destructive={avatarOverrideState.hideAvatar}
                            disabled={actionsDisabled}
                            onSelect={() => onAvatarOverride?.('hideAvatar')}
                        >
                            {t(
                                avatarOverrideState.hideAvatar
                                    ? 'dialog.user.actions.reset_hidden_avatar'
                                    : 'dialog.user.actions.moderation_hide_avatar'
                            )}
                        </EntityActionItem>
                        <EntityActionItem
                            icon={UserIcon}
                            destructive={avatarOverrideState.showAvatar}
                            disabled={actionsDisabled}
                            onSelect={() => onAvatarOverride?.('showAvatar')}
                        >
                            {t(
                                avatarOverrideState.showAvatar
                                    ? 'dialog.user.actions.reset_shown_avatar'
                                    : 'dialog.user.actions.moderation_show_avatar'
                            )}
                        </EntityActionItem>
                        <EntityActionItem
                            icon={BanIcon}
                            destructive={extendedModerationState.interactOff}
                            disabled={actionsDisabled}
                            onSelect={() =>
                                onExtendedModeration?.(
                                    'interactOff',
                                    !extendedModerationState.interactOff
                                )
                            }
                        >
                            {t(
                                extendedModerationState.interactOff
                                    ? 'dialog.user.actions.moderation_enable_avatar_interaction'
                                    : 'dialog.user.actions.moderation_disable_avatar_interaction'
                            )}
                        </EntityActionItem>
                        <EntityActionItem
                            icon={VolumeXIcon}
                            destructive={extendedModerationState.muteChat}
                            disabled={actionsDisabled}
                            onSelect={() =>
                                onExtendedModeration?.(
                                    'muteChat',
                                    !extendedModerationState.muteChat
                                )
                            }
                        >
                            {t(
                                extendedModerationState.muteChat
                                    ? 'dialog.user.actions.moderation_enable_chatbox'
                                    : 'dialog.user.actions.moderation_disable_chatbox'
                            )}
                        </EntityActionItem>
                        <EntityActionItem
                            icon={BanIcon}
                            destructive
                            disabled={actionsDisabled}
                            onSelect={onReportHacking}
                        >
                            {t('dialog.user.actions.report_hacking')}
                        </EntityActionItem>
                    </>
                ) : null}
            </EntityActionDropdown>
        </>
    );
}
