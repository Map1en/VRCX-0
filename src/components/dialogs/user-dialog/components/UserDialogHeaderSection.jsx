import { UsersIcon } from 'lucide-react';

import { EntityDialogHeader } from '../../EntityDialogScaffold.jsx';
import { UserDialogHeaderActions } from './UserDialogHeaderActions.jsx';
import {
    UserDialogHeaderBadges,
    UserDialogHeaderMediaBadges
} from './UserDialogHeaderBadges.jsx';
import {
    PreviousDisplayNamesBadge,
    UserTitleLanguages
} from '../UserDialogViewParts.jsx';

export function UserDialogHeaderSection({
    actionStatus,
    avatarOverrideState,
    canInviteFromCurrentLocation,
    currentAvatarTarget,
    currentUserBoopingEnabled,
    detail,
    extendedModerationState,
    fallbackAvatarTarget,
    friendNumber,
    friendRequestState,
    imageUrl,
    isCurrentUser,
    isFriend,
    loadStatus,
    moderationState,
    mutualFriendCount,
    onAvatarOverride,
    onBoop,
    onCopyUserId,
    onCopyUserUrl,
    onEditMemo,
    onEditSelfBio,
    onEditSelfBioLinks,
    onEditSelfLanguages,
    onEditSelfPronouns,
    onEditSelfStatus,
    onExtendedModeration,
    onFriendRequest,
    onGroupModeration,
    onImageClick,
    onInvite,
    onInviteMessage,
    onInviteRequest,
    onInviteRequestMessage,
    onInviteToGroup,
    onModeration,
    onOpenDiscordProfile,
    onOpenFallbackAvatar,
    onOpenImagePreview,
    onOpenUserIcon,
    onOpenUserUrl,
    onRefresh,
    onReportHacking,
    onShowAvatarAuthor,
    onShowInstanceHistory,
    onSubtitleClick,
    onTitleClick,
    onToggleBadgeShowcased,
    onToggleBadgeVisibility,
    onToggleSelfAvatarCopying,
    onToggleSelfBooping,
    onToggleSelfDiscordConnections,
    onToggleSelfSharedConnections,
    onUnfriend,
    platform,
    PlatformIcon,
    previousDisplayNames,
    previousInstances,
    profile,
    profileLanguages,
    profileTitle,
    pronounsText,
    recentDialogShortcut,
    statusIndicatorClassName,
    statusStateText,
    t,
    userSubtitle,
    userUrl
}) {
    return (
        <EntityDialogHeader
            imageUrl={imageUrl}
            imageAlt={profile.displayName || profile.id || 'User'}
            imageClassName="aspect-[4/3] w-40"
            onImageClick={imageUrl ? onImageClick : null}
            imagePlaceholder={
                <UsersIcon className="text-muted-foreground size-8" />
            }
            titlePrefix={
                statusIndicatorClassName ? (
                    <i
                        className={statusIndicatorClassName}
                        title={statusStateText || undefined}
                    />
                ) : null
            }
            title={profileTitle}
            onTitleClick={onTitleClick}
            titleMeta={
                <>
                    {pronounsText ? (
                        <span
                            className="text-muted-foreground shrink-0 font-mono text-xs font-normal"
                            title={t('dialog.user.pronouns')}
                        >
                            {pronounsText}
                        </span>
                    ) : null}
                    <UserTitleLanguages languages={profileLanguages} />
                    <PreviousDisplayNamesBadge names={previousDisplayNames} />
                </>
            }
            subtitle={userSubtitle}
            onSubtitleClick={onSubtitleClick}
            description={profile.statusDescription}
            detail={detail}
            badges={
                <UserDialogHeaderBadges
                    profile={profile}
                    moderationState={moderationState}
                    friendNumber={friendNumber}
                    mutualFriendCount={mutualFriendCount}
                    platform={platform}
                    PlatformIcon={PlatformIcon}
                    onOpenDiscordProfile={onOpenDiscordProfile}
                    t={t}
                />
            }
            mediaBadges={
                <UserDialogHeaderMediaBadges
                    profile={profile}
                    profileTitle={profileTitle}
                    actionStatus={actionStatus}
                    isCurrentUser={isCurrentUser}
                    onOpenImagePreview={onOpenImagePreview}
                    onToggleBadgeVisibility={onToggleBadgeVisibility}
                    onToggleBadgeShowcased={onToggleBadgeShowcased}
                    t={t}
                />
            }
            actions={
                <UserDialogHeaderActions
                    profile={profile}
                    loadStatus={loadStatus}
                    actionStatus={actionStatus}
                    moderationState={moderationState}
                    extendedModerationState={extendedModerationState}
                    avatarOverrideState={avatarOverrideState}
                    isCurrentUser={isCurrentUser}
                    isFriend={isFriend}
                    friendRequestState={friendRequestState}
                    canInviteFromCurrentLocation={canInviteFromCurrentLocation}
                    currentUserBoopingEnabled={currentUserBoopingEnabled}
                    currentAvatarTarget={currentAvatarTarget}
                    fallbackAvatarTarget={fallbackAvatarTarget}
                    previousInstances={previousInstances}
                    userUrl={userUrl}
                    recentDialogShortcut={recentDialogShortcut}
                    onOpenUserIcon={onOpenUserIcon}
                    onRefresh={onRefresh}
                    onCopyUserUrl={onCopyUserUrl}
                    onOpenUserUrl={onOpenUserUrl}
                    onCopyUserId={onCopyUserId}
                    onEditMemo={onEditMemo}
                    onShowAvatarAuthor={onShowAvatarAuthor}
                    onOpenFallbackAvatar={onOpenFallbackAvatar}
                    onEditSelfStatus={onEditSelfStatus}
                    onEditSelfLanguages={onEditSelfLanguages}
                    onEditSelfBio={onEditSelfBio}
                    onEditSelfBioLinks={onEditSelfBioLinks}
                    onEditSelfPronouns={onEditSelfPronouns}
                    onToggleSelfAvatarCopying={onToggleSelfAvatarCopying}
                    onToggleSelfBooping={onToggleSelfBooping}
                    onToggleSelfSharedConnections={
                        onToggleSelfSharedConnections
                    }
                    onToggleSelfDiscordConnections={
                        onToggleSelfDiscordConnections
                    }
                    onFriendRequest={onFriendRequest}
                    onInvite={onInvite}
                    onInviteMessage={onInviteMessage}
                    onInviteRequest={onInviteRequest}
                    onInviteRequestMessage={onInviteRequestMessage}
                    onBoop={onBoop}
                    onUnfriend={onUnfriend}
                    onInviteToGroup={onInviteToGroup}
                    onGroupModeration={onGroupModeration}
                    onShowInstanceHistory={onShowInstanceHistory}
                    onModeration={onModeration}
                    onAvatarOverride={onAvatarOverride}
                    onExtendedModeration={onExtendedModeration}
                    onReportHacking={onReportHacking}
                    t={t}
                />
            }
        />
    );
}
