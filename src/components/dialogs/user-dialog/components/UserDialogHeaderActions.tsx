import {
    BanIcon,
    EyeIcon,
    EyeOffIcon,
    FlagIcon,
    HandIcon,
    HistoryIcon,
    MailPlusIcon,
    MailQuestionIcon,
    MessageSquarePlusIcon,
    MessageSquareTextIcon,
    MessageSquareXIcon,
    MousePointerClickIcon,
    NotebookPenIcon,
    PencilIcon,
    RefreshCwIcon,
    RotateCcwIcon,
    SettingsIcon,
    ShieldAlertIcon,
    ShieldIcon,
    UserIcon,
    UserCheckIcon,
    UserCogIcon,
    UserPlusIcon,
    UserRoundMinusIcon,
    UserXIcon,
    UsersRoundIcon,
    VolumeXIcon,
    XIcon
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { FavoriteActionSub } from '@/components/favorites/FavoriteActionMenu';

import {
    EntityActionDropdown,
    EntityActionItem,
    EntityActionSeparator,
    EntityActionSub
} from '../../EntityDialogScaffold';
import type {
    UserHeaderCommands,
    UserHeaderModel
} from './UserDialogHeaderSection';

type UserActionMenuModel = Pick<
    UserHeaderModel,
    | 'profile'
    | 'loadStatus'
    | 'actionStatus'
    | 'moderationState'
    | 'extendedModerationState'
    | 'avatarOverrideState'
    | 'isCurrentUser'
    | 'isFriend'
    | 'friendRequestState'
    | 'canInviteFromCurrentLocation'
    | 'currentUserAccountStanding'
    | 'currentUserBoopingEnabled'
    | 'currentAvatarTarget'
    | 'fallbackAvatarTarget'
    | 'recentDialogShortcut'
>;

type UserActionMenuCommands = Pick<
    UserHeaderCommands,
    | 'onRefresh'
    | 'onEditMemo'
    | 'onShowAvatarAuthor'
    | 'onOpenFallbackAvatar'
    | 'onEditSelfStatus'
    | 'onEditSelfProfile'
    | 'onFriendRequest'
    | 'onInvite'
    | 'onInviteMessage'
    | 'onInviteRequest'
    | 'onInviteRequestMessage'
    | 'onBoop'
    | 'onUnfriend'
    | 'onInviteToGroup'
    | 'onGroupModeration'
    | 'onShowInstanceHistory'
    | 'onModeration'
    | 'onAvatarOverride'
    | 'onExtendedModeration'
    | 'onReportUser'
    | 'onShowVrchatAccount'
>;

function AccountStandingAlertIcon() {
    return <ShieldAlertIcon className="text-amber-500" />;
}

export function UserDialogHeaderActions({
    actionMenuModel: model,
    actionMenuCommands: commands
}: {
    actionMenuModel: UserActionMenuModel;
    actionMenuCommands: UserActionMenuCommands;
}) {
    const { t } = useTranslation();
    const {
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
        currentUserAccountStanding,
        currentUserBoopingEnabled,
        currentAvatarTarget,
        fallbackAvatarTarget,
        recentDialogShortcut
    } = model;
    const {
        onRefresh,
        onEditMemo,
        onShowAvatarAuthor,
        onOpenFallbackAvatar,
        onEditSelfStatus,
        onEditSelfProfile,
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
        onReportUser,
        onShowVrchatAccount
    } = commands;
    const isBusy = loadStatus === 'running' || actionStatus !== 'idle';
    const accountStandingAlert =
        isCurrentUser &&
        Boolean(currentUserAccountStanding) &&
        currentUserAccountStanding !== 'good';
    const actionsDisabled = actionStatus !== 'idle';
    const hasAvatarOverride =
        avatarOverrideState.hideAvatar || avatarOverrideState.showAvatar;

    return (
        <>
            <EntityActionDropdown
                busy={isBusy}
                dangerous={moderationState.block}
                indicator={
                    friendRequestState.incoming ||
                    friendRequestState.outgoing ||
                    accountStandingAlert
                }
            >
                {!isCurrentUser && isFriend ? (
                    <>
                        <FavoriteActionSub
                            kind="friend"
                            entityId={profile.id ?? ''}
                            entity={profile}
                        />
                        <EntityActionSeparator />
                    </>
                ) : null}
                <EntityActionItem
                    icon={RefreshCwIcon}
                    disabled={loadStatus === 'running'}
                    onClick={onRefresh}
                >
                    {t('common.actions.refresh')}
                </EntityActionItem>
                <EntityActionItem icon={NotebookPenIcon} onClick={onEditMemo}>
                    {t('dialog.user.actions.edit_note_memo')}
                </EntityActionItem>
                {currentAvatarTarget ? (
                    <EntityActionItem
                        icon={UserIcon}
                        onClick={() => {
                            onShowAvatarAuthor();
                        }}
                    >
                        {t('dialog.user.actions.show_avatar_author')}
                    </EntityActionItem>
                ) : null}
                {fallbackAvatarTarget ? (
                    <EntityActionItem
                        icon={UserIcon}
                        onClick={onOpenFallbackAvatar}
                    >
                        {t('dialog.user.actions.show_fallback_avatar')}
                    </EntityActionItem>
                ) : null}
                {!isCurrentUser ? (
                    <EntityActionItem
                        icon={HistoryIcon}
                        onClick={onShowInstanceHistory}
                    >
                        {t('dialog.user.actions.show_previous_instances')}
                    </EntityActionItem>
                ) : null}
                {isCurrentUser ? (
                    <>
                        <EntityActionSeparator />
                        <EntityActionItem
                            icon={PencilIcon}
                            disabled={actionsDisabled}
                            onClick={onEditSelfStatus}
                        >
                            {t('dialog.user.action.edit_social_status')}
                        </EntityActionItem>
                        <EntityActionItem
                            icon={PencilIcon}
                            disabled={actionsDisabled}
                            onClick={onEditSelfProfile}
                        >
                            {t('dialog.user.actions.edit_profile')}
                        </EntityActionItem>
                        <EntityActionItem
                            icon={
                                accountStandingAlert
                                    ? AccountStandingAlertIcon
                                    : UserCogIcon
                            }
                            onClick={onShowVrchatAccount}
                        >
                            {t('dialog.user.actions.vrchat_account')}
                        </EntityActionItem>
                    </>
                ) : null}
                {!isCurrentUser ? (
                    <>
                        <EntityActionSeparator />
                        {!isFriend && friendRequestState.incoming ? (
                            <>
                                <EntityActionItem
                                    icon={UserCheckIcon}
                                    disabled={actionsDisabled}
                                    onClick={() => onFriendRequest('accept')}
                                >
                                    {t(
                                        'dialog.user.actions.accept_friend_request'
                                    )}
                                </EntityActionItem>
                                <EntityActionItem
                                    icon={UserXIcon}
                                    destructive
                                    disabled={actionsDisabled}
                                    onClick={() => onFriendRequest('decline')}
                                >
                                    {t(
                                        'dialog.user.actions.decline_friend_request'
                                    )}
                                </EntityActionItem>
                            </>
                        ) : !isFriend && friendRequestState.outgoing ? (
                            <EntityActionItem
                                icon={XIcon}
                                disabled={actionsDisabled}
                                onClick={() => onFriendRequest('cancel')}
                            >
                                {t('dialog.user.actions.cancel_friend_request')}
                            </EntityActionItem>
                        ) : !isFriend ? (
                            <EntityActionItem
                                icon={UserPlusIcon}
                                shortcut={recentDialogShortcut(
                                    'Send Friend Request'
                                )}
                                disabled={actionsDisabled}
                                onClick={() => onFriendRequest('send')}
                            >
                                {t('dialog.user.actions.send_friend_request')}
                            </EntityActionItem>
                        ) : null}
                        {isFriend ? (
                            <>
                                <EntityActionItem
                                    icon={MailPlusIcon}
                                    shortcut={recentDialogShortcut('Invite')}
                                    disabled={
                                        actionsDisabled ||
                                        !canInviteFromCurrentLocation
                                    }
                                    onClick={onInvite}
                                >
                                    {t('dialog.user.actions.invite')}
                                </EntityActionItem>
                                <EntityActionItem
                                    icon={MessageSquarePlusIcon}
                                    shortcut={recentDialogShortcut(
                                        'Invite Message'
                                    )}
                                    disabled={
                                        actionsDisabled ||
                                        !canInviteFromCurrentLocation
                                    }
                                    onClick={onInviteMessage}
                                >
                                    {t('dialog.invite_message.header')}
                                </EntityActionItem>
                                <EntityActionItem
                                    icon={MailQuestionIcon}
                                    shortcut={recentDialogShortcut(
                                        'Request Invite'
                                    )}
                                    disabled={actionsDisabled}
                                    onClick={onInviteRequest}
                                >
                                    {t('dialog.user.actions.request_invite')}
                                </EntityActionItem>
                                <EntityActionItem
                                    icon={MessageSquareTextIcon}
                                    shortcut={recentDialogShortcut(
                                        'Request Invite Message'
                                    )}
                                    disabled={actionsDisabled}
                                    onClick={onInviteRequestMessage}
                                >
                                    {t('dialog.invite_request_message.header')}
                                </EntityActionItem>
                                <EntityActionItem
                                    icon={MousePointerClickIcon}
                                    disabled={
                                        actionsDisabled ||
                                        !currentUserBoopingEnabled
                                    }
                                    onClick={onBoop}
                                >
                                    {t('dialog.user.actions.send_boop')}
                                </EntityActionItem>
                            </>
                        ) : null}
                        <EntityActionSeparator />
                        <EntityActionSub
                            icon={UsersRoundIcon}
                            label={t('dialog.user.actions.group_actions')}
                            disabled={actionsDisabled}
                        >
                            <EntityActionItem
                                icon={UsersRoundIcon}
                                disabled={actionsDisabled}
                                onClick={() => {
                                    onInviteToGroup();
                                }}
                            >
                                {t('dialog.user.actions.invite_to_group')}
                            </EntityActionItem>
                            <EntityActionItem
                                icon={SettingsIcon}
                                disabled={actionsDisabled}
                                onClick={onGroupModeration}
                            >
                                {t('dialog.user.actions.group_moderation')}
                            </EntityActionItem>
                        </EntityActionSub>
                        <EntityActionSub
                            icon={ShieldIcon}
                            label={t('dialog.user.actions.moderation_actions')}
                            disabled={actionsDisabled}
                        >
                            <EntityActionItem
                                icon={BanIcon}
                                destructive={!moderationState.block}
                                disabled={
                                    actionsDisabled ||
                                    (!moderationState.block &&
                                        Boolean(profile.$isModerator))
                                }
                                onClick={() =>
                                    onModeration(
                                        'block',
                                        !moderationState.block
                                    )
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
                                disabled={
                                    actionsDisabled ||
                                    (!moderationState.mute &&
                                        Boolean(profile.$isModerator))
                                }
                                onClick={() =>
                                    onModeration('mute', !moderationState.mute)
                                }
                            >
                                {t(
                                    moderationState.mute
                                        ? 'dialog.user.actions.moderation_unmute'
                                        : 'dialog.user.actions.moderation_mute'
                                )}
                            </EntityActionItem>
                            {hasAvatarOverride ? (
                                <EntityActionItem
                                    icon={RotateCcwIcon}
                                    disabled={actionsDisabled}
                                    onClick={() =>
                                        onAvatarOverride?.(
                                            avatarOverrideState.hideAvatar
                                                ? 'hideAvatar'
                                                : 'showAvatar'
                                        )
                                    }
                                >
                                    {t(
                                        'dialog.user.actions.reset_avatar_visibility'
                                    )}
                                </EntityActionItem>
                            ) : (
                                <>
                                    <EntityActionItem
                                        icon={EyeOffIcon}
                                        disabled={actionsDisabled}
                                        onClick={() =>
                                            onAvatarOverride?.('hideAvatar')
                                        }
                                    >
                                        {t(
                                            'dialog.user.actions.moderation_hide_avatar'
                                        )}
                                    </EntityActionItem>
                                    <EntityActionItem
                                        icon={EyeIcon}
                                        disabled={actionsDisabled}
                                        onClick={() =>
                                            onAvatarOverride?.('showAvatar')
                                        }
                                    >
                                        {t(
                                            'dialog.user.actions.moderation_show_avatar'
                                        )}
                                    </EntityActionItem>
                                </>
                            )}
                            <EntityActionItem
                                icon={HandIcon}
                                disabled={actionsDisabled}
                                onClick={() =>
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
                                icon={MessageSquareXIcon}
                                disabled={actionsDisabled}
                                onClick={() =>
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
                        </EntityActionSub>
                        <EntityActionSeparator />
                        {isFriend ? (
                            <EntityActionItem
                                icon={UserRoundMinusIcon}
                                destructive
                                disabled={actionsDisabled}
                                onClick={onUnfriend}
                            >
                                {t('dialog.user.actions.unfriend')}
                            </EntityActionItem>
                        ) : null}
                        <EntityActionItem
                            icon={FlagIcon}
                            destructive
                            disabled={actionsDisabled}
                            onClick={onReportUser}
                        >
                            {t('dialog.user.actions.report_user')}
                        </EntityActionItem>
                    </>
                ) : null}
            </EntityActionDropdown>
        </>
    );
}
