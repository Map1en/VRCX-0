import { ClockIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import {
    convertFileUrlToImageUrl,
    copyTextToClipboard,
    openExternalLink
} from '@/lib/entityMedia.js';
import { userStatusIndicatorClassName } from '@/lib/userStatus.js';
import { backend } from '@/platform/tauri/backend.js';
import { avatarProfileRepository } from '@/repositories/index.js';
import {
    openAvatarDialog,
    openGroupDialog,
    openUserDialog
} from '@/services/dialogService.js';
import { isActionRecent } from '@/services/recentActionService.js';
import { parseLocation } from '@/shared/utils/location.js';
import { useFriendRosterStore } from '@/state/friendRosterStore.js';
import { useModalStore } from '@/state/modalStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';

import { EntityDialogScaffold } from './EntityDialogScaffold.jsx';
import { UserDialogHeaderSection } from './user-dialog/components/UserDialogHeaderSection.jsx';
import { UserDialogTabsSection } from './user-dialog/components/UserDialogTabsSection.jsx';
import { buildUserDialogLocationUsers } from './user-dialog/userDialogLocationUsers.js';
import {
    isOfflineLikeValue,
    normalizedText
} from './user-dialog/userDialogRows.js';
import { useUserDialogGroupActions } from './user-dialog/useUserDialogGroupActions.js';
import { useUserDialogTabData } from './user-dialog/useUserDialogTabData.js';
import { buildUserDialogProfileSummary } from './user-dialog/userDialogViewData.js';

const VRC_PLUS_SUMMARY_SNAPSHOT = Object.freeze({ $isVRCPlus: true });

export function UserDialogTabbedView({
    profile,
    memo,
    detail,
    imageUrl,
    loadStatus,
    actionStatus,
    recentActionVersion = 0,
    reloadToken = 0,
    moderationState,
    extendedModerationState = { interactOff: false, muteChat: false },
    avatarOverrideState = { hideAvatar: false, showAvatar: false },
    isCurrentUser,
    isFriend,
    isFavorite,
    friendRequestState,
    platform,
    platformIcon: PlatformIcon,
    presenceLocation,
    currentAvatarTarget,
    homeLocationTarget,
    canInviteFromCurrentLocation,
    currentUserHasSharedConnectionsOptOut,
    currentUserBoopingEnabled,
    userStats = {},
    previousInstances = [],
    representedGroup = null,
    representedGroupStatus = 'idle',
    hideUserNotes = false,
    hideUserMemos = false,
    onPreviousInstancesChange,
    sameInstanceUsers = [],
    locationOwnerUser = null,
    locationOwnerGroup = null,
    locationInstance = null,
    locationFriendCount = 0,
    locationPlayerCount = 0,
    onRefreshLocation,
    onRefresh,
    onEditMemo,
    onFriendRequest,
    onInvite,
    onInviteMessage,
    onInviteRequest,
    onInviteRequestMessage,
    onBoop,
    onUnfriend,
    onModeration,
    onExtendedModeration,
    onAvatarOverride,
    onReportHacking,
    onGroupModeration,
    onEditSelfStatus,
    onEditSelfLanguages,
    onEditSelfBio,
    onEditSelfBioLinks,
    onEditSelfPronouns,
    onToggleSelfAvatarCopying,
    onToggleSelfBooping,
    onToggleSelfSharedConnections,
    onToggleSelfDiscordConnections,
    onToggleBadgeVisibility,
    onToggleBadgeShowcased
}) {
    const { t } = useTranslation();
    const currentEndpoint = useRuntimeStore(
        (state) => state.auth.currentUserEndpoint
    );
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const isLocalUserVrcPlusSupporter = useRuntimeStore((state) =>
        Boolean(
            state.auth.currentUserSnapshot?.$isVRCPlus ||
                state.auth.currentUserSnapshot?.tags?.includes?.(
                    'system_supporter'
                ) ||
                globalThis?.$debug?.debugVrcPlus
        )
    );
    const inGameGroupOrder = useRuntimeStore(
        (state) => state.groupInstances.groupOrder
    );
    const friendsById = useFriendRosterStore((state) => state.friendsById);
    const openImagePreview = useModalStore((state) => state.openImagePreview);
    const prompt = useModalStore((state) => state.prompt);
    const confirm = useModalStore((state) => state.confirm);
    const [selectedGroupIds, setSelectedGroupIds] = useState(() => new Set());

    const tabData = useUserDialogTabData({
        profile,
        reloadToken,
        isCurrentUser,
        currentEndpoint,
        currentUserId,
        currentUserHasSharedConnectionsOptOut,
        friendsById,
        inGameGroupOrder,
        selectedGroupIds,
        t
    });

    const {
        activeTab,
        avatarReleaseStatus,
        avatarSort,
        bioLinks,
        changeAvatarReleaseStatus,
        changeAvatarSort,
        changeTab,
        changeWorldOrder,
        changeWorldSort,
        effectiveGroupSort,
        favoriteWorlds,
        filteredFavoriteWorlds,
        filteredMutualFriends,
        filteredProfileGroups,
        filteredProfileWorlds,
        groupSearchActive,
        loadTab,
        mutualFriends,
        mutualSort,
        profileAvatars,
        profileGroups,
        profileWorlds,
        refreshGroups,
        remoteData,
        remoteErrors,
        remoteStatus,
        search,
        selectedUserGroups,
        setGroupSort,
        setMutualSort,
        setSearch,
        sortedProfileGroups,
        tabs,
        visibleMutualFriends,
        visibleProfileAvatars,
        vrchatConfigConstants,
        worldOrder,
        worldSort
    } = tabData;

    const groupActions = useUserDialogGroupActions({
        confirm,
        currentEndpoint,
        currentUserId,
        inGameGroupOrder,
        isCurrentUser,
        profile,
        profileGroups,
        prompt,
        refreshGroups,
        selectedGroupIds,
        selectedUserGroups,
        setGroupSort,
        setSelectedGroupIds,
        t
    });

    const userUrl = profile.id
        ? `https://vrchat.com/home/user/${profile.id}`
        : '';
    const username =
        profile.username && profile.username !== profile.id
            ? profile.username
            : '';
    const profileTitle = profile.displayName || profile.username || 'User';
    const userSubtitle = username;
    const pronounsText = Array.isArray(profile.pronouns)
        ? profile.pronouns.join(', ')
        : profile.pronouns;
    const {
        previousDisplayNames,
        statusStateText,
        userGroupSections,
        selectedGroupCount,
        ownGroupCountText,
        remainingGroupCountText,
        userTimeSpent,
        userJoinCount,
        lastSeen,
        profileLanguages,
        mutualFriendCount,
        friendNumber
    } = buildUserDialogProfileSummary({
        profile,
        userStats,
        sortedProfileGroups,
        selectedUserGroups,
        mutualFriends,
        isCurrentUser,
        vrchatConfigConstants,
        currentUserSnapshot: isLocalUserVrcPlusSupporter
            ? VRC_PLUS_SUMMARY_SNAPSHOT
            : null
    });
    const statusIndicatorClassName = userStatusIndicatorClassName(profile, {
        showOffline: true
    });
    const currentAvatarDisplayName = String(
        profile.currentAvatarName || profile.avatarName || ''
    ).trim();
    const currentAvatarDialogArgs = {
        avatarId: currentAvatarTarget,
        ...(currentAvatarDisplayName
            ? {
                  title: currentAvatarDisplayName,
                  seedData: {
                      id: currentAvatarTarget,
                      name: currentAvatarDisplayName,
                      imageUrl: profile.currentAvatarImageUrl || '',
                      thumbnailImageUrl:
                          profile.currentAvatarThumbnailImageUrl || ''
                  }
              }
            : {})
    };
    const fallbackAvatarTarget =
        typeof profile.fallbackAvatar === 'string'
            ? profile.fallbackAvatar.trim()
            : '';
    const fallbackAvatarDialogArgs = {
        avatarId: fallbackAvatarTarget,
        title: 'Fallback Avatar'
    };
    const visibleHomeLocationTarget = isOfflineLikeValue(homeLocationTarget)
        ? ''
        : homeLocationTarget;
    const visiblePresenceLocation = isOfflineLikeValue(presenceLocation)
        ? ''
        : presenceLocation;
    const visiblePresenceParsedLocation = visiblePresenceLocation
        ? parseLocation(visiblePresenceLocation)
        : null;
    const locationWorldTitle = normalizedText(
        profile.worldName ||
            profile.$worldName ||
            profile.$location?.worldName ||
            profile.$location?.name ||
            profile.$location?.world?.name
    );
    const { locationInstanceUsers, locationOwnerId } = useMemo(
        () =>
            buildUserDialogLocationUsers({
                locationInstance,
                locationOwnerGroup,
                locationOwnerUser,
                profile,
                sameInstanceUsers,
                t,
                visiblePresenceParsedLocation
            }),
        [
            locationInstance,
            locationOwnerGroup,
            locationOwnerUser,
            profile,
            sameInstanceUsers,
            t,
            visiblePresenceParsedLocation
        ]
    );
    const isRecentDialogAction = (actionType) =>
        recentActionVersion >= 0 && isActionRecent(profile.id, actionType);
    const recentDialogShortcut = (actionType) =>
        isRecentDialogAction(actionType) ? (
            <ClockIcon className="text-muted-foreground size-3.5" />
        ) : null;

    async function copyUserText(text, label) {
        await copyTextToClipboard(text);
        toast.success(
            t('dialog.user.generated_dynamic.value_copied', { value: label })
        );
    }

    async function openDiscordProfile(discordId) {
        try {
            await backend.discord.OpenDiscordProfile(discordId);
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'dialog.user.generated_toast.failed_to_open_discord_profile'
                      )
            );
        }
    }

    async function showAvatarAuthor() {
        if (!currentAvatarTarget) {
            return;
        }
        try {
            const avatar = await avatarProfileRepository.getAvatarProfile({
                avatarId: currentAvatarTarget,
                endpoint: currentEndpoint
            });
            if (avatar.authorId) {
                openUserDialog({
                    userId: avatar.authorId,
                    title: avatar.authorName || undefined
                });
                return;
            }
            toast.error(t('dialog.user.generated.avatar_author_unavailable'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'dialog.user.generated_toast.failed_to_load_avatar_author'
                      )
            );
        }
    }

    return (
        <EntityDialogScaffold>
            <UserDialogHeaderSection
                actionStatus={actionStatus}
                avatarOverrideState={avatarOverrideState}
                canInviteFromCurrentLocation={canInviteFromCurrentLocation}
                currentAvatarTarget={currentAvatarTarget}
                currentUserBoopingEnabled={currentUserBoopingEnabled}
                detail={detail}
                extendedModerationState={extendedModerationState}
                fallbackAvatarTarget={fallbackAvatarTarget}
                friendNumber={friendNumber}
                friendRequestState={friendRequestState}
                imageUrl={imageUrl}
                isCurrentUser={isCurrentUser}
                isFriend={isFriend}
                loadStatus={loadStatus}
                moderationState={moderationState}
                mutualFriendCount={mutualFriendCount}
                onAvatarOverride={onAvatarOverride}
                onBoop={onBoop}
                onCopyUserId={() => void copyUserText(profile.id, 'User ID')}
                onCopyUserUrl={() => void copyUserText(userUrl, 'User URL')}
                onEditMemo={onEditMemo}
                onEditSelfBio={onEditSelfBio}
                onEditSelfBioLinks={onEditSelfBioLinks}
                onEditSelfLanguages={onEditSelfLanguages}
                onEditSelfPronouns={onEditSelfPronouns}
                onEditSelfStatus={onEditSelfStatus}
                onExtendedModeration={onExtendedModeration}
                onFriendRequest={onFriendRequest}
                onGroupModeration={onGroupModeration}
                onImageClick={() =>
                    openImagePreview({
                        url: imageUrl,
                        title: profileTitle
                    })
                }
                onInvite={onInvite}
                onInviteMessage={onInviteMessage}
                onInviteRequest={onInviteRequest}
                onInviteRequestMessage={onInviteRequestMessage}
                onInviteToGroup={groupActions.inviteToGroup}
                onModeration={onModeration}
                onOpenDiscordProfile={openDiscordProfile}
                onOpenFallbackAvatar={() =>
                    openAvatarDialog(fallbackAvatarDialogArgs)
                }
                onOpenImagePreview={openImagePreview}
                onOpenUserIcon={() =>
                    openImagePreview({
                        url: convertFileUrlToImageUrl(profile.userIcon, 512),
                        title: profileTitle
                    })
                }
                onOpenUserUrl={() => openExternalLink(userUrl)}
                onRefresh={onRefresh}
                onReportHacking={onReportHacking}
                onShowAvatarAuthor={showAvatarAuthor}
                onShowInstanceHistory={() => changeTab('instance-history')}
                onSubtitleClick={
                    username
                        ? () => void copyUserText(username, 'Username')
                        : undefined
                }
                onTitleClick={
                    profile.displayName || profile.username
                        ? () =>
                              void copyUserText(
                                  profile.displayName || profile.username,
                                  'Display name'
                              )
                        : undefined
                }
                onToggleBadgeShowcased={onToggleBadgeShowcased}
                onToggleBadgeVisibility={onToggleBadgeVisibility}
                onToggleSelfAvatarCopying={onToggleSelfAvatarCopying}
                onToggleSelfBooping={onToggleSelfBooping}
                onToggleSelfDiscordConnections={
                    onToggleSelfDiscordConnections
                }
                onToggleSelfSharedConnections={onToggleSelfSharedConnections}
                onUnfriend={onUnfriend}
                platform={platform}
                PlatformIcon={PlatformIcon}
                previousDisplayNames={previousDisplayNames}
                previousInstances={previousInstances}
                profile={profile}
                profileLanguages={profileLanguages}
                profileTitle={profileTitle}
                pronounsText={pronounsText}
                recentDialogShortcut={recentDialogShortcut}
                statusIndicatorClassName={statusIndicatorClassName}
                statusStateText={statusStateText}
                t={t}
                userSubtitle={userSubtitle}
                userUrl={userUrl}
            />
            <UserDialogTabsSection
                activeTab={activeTab}
                avatarReleaseStatus={avatarReleaseStatus}
                avatarSort={avatarSort}
                bioLinks={bioLinks}
                changeAvatarReleaseStatus={changeAvatarReleaseStatus}
                changeAvatarSort={changeAvatarSort}
                changeTab={changeTab}
                changeWorldOrder={changeWorldOrder}
                changeWorldSort={changeWorldSort}
                copyUserText={copyUserText}
                currentAvatarDialogArgs={currentAvatarDialogArgs}
                currentAvatarDisplayName={currentAvatarDisplayName}
                currentAvatarTarget={currentAvatarTarget}
                currentEndpoint={currentEndpoint}
                currentUserId={currentUserId}
                effectiveGroupSort={effectiveGroupSort}
                favoriteWorlds={favoriteWorlds}
                filteredFavoriteWorlds={filteredFavoriteWorlds}
                filteredMutualFriends={filteredMutualFriends}
                filteredProfileGroups={filteredProfileGroups}
                filteredProfileWorlds={filteredProfileWorlds}
                groupActionId={groupActions.groupActionId}
                groupActions={groupActions}
                groupEditMode={groupActions.groupEditMode}
                groupSearchActive={groupSearchActive}
                hideUserMemos={hideUserMemos}
                hideUserNotes={hideUserNotes}
                isCurrentUser={isCurrentUser}
                isFavorite={isFavorite}
                isFriend={isFriend}
                lastSeen={lastSeen}
                loadTab={loadTab}
                locationFriendCount={locationFriendCount}
                locationInstance={locationInstance}
                locationInstanceUsers={locationInstanceUsers}
                locationOwnerId={locationOwnerId}
                locationPlayerCount={locationPlayerCount}
                locationWorldTitle={locationWorldTitle}
                memo={memo}
                moderationState={moderationState}
                mutualFriends={mutualFriends}
                mutualSort={mutualSort}
                onEditMemo={onEditMemo}
                onOpenCurrentAvatar={() => openAvatarDialog(currentAvatarDialogArgs)}
                onPreviousInstancesChange={onPreviousInstancesChange}
                onRefreshLocation={onRefreshLocation}
                openAvatarDialog={openAvatarDialog}
                openGroupDialog={openGroupDialog}
                ownGroupCountText={ownGroupCountText}
                previousInstances={previousInstances}
                profile={profile}
                profileAvatars={profileAvatars}
                profileGroups={profileGroups}
                profileWorlds={profileWorlds}
                remainingGroupCountText={remainingGroupCountText}
                remoteData={remoteData}
                remoteErrors={remoteErrors}
                remoteStatus={remoteStatus}
                representedGroup={representedGroup}
                representedGroupStatus={representedGroupStatus}
                search={search}
                selectedGroupCount={selectedGroupCount}
                selectedGroupIds={selectedGroupIds}
                selectedUserGroups={selectedUserGroups}
                setGroupEditMode={groupActions.setGroupEditMode}
                setGroupSort={setGroupSort}
                setMutualSort={setMutualSort}
                setSearch={setSearch}
                tabs={tabs}
                t={t}
                userGroupSections={userGroupSections}
                userJoinCount={userJoinCount}
                userTimeSpent={userTimeSpent}
                visibleHomeLocationTarget={visibleHomeLocationTarget}
                visibleMutualFriends={visibleMutualFriends}
                visiblePresenceLocation={visiblePresenceLocation}
                visibleProfileAvatars={visibleProfileAvatars}
                worldOrder={worldOrder}
                worldSort={worldSort}
            />
        </EntityDialogScaffold>
    );
}
