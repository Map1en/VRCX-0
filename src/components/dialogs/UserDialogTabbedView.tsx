// @ts-nocheck
import { ClockIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
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

import {
    EntityDialogScaffold,
    EntityDialogTwoColumnLayout
} from './EntityDialogScaffold';
import { UserDialogHeaderSection } from './user-dialog/components/UserDialogHeaderSection';
import { UserDialogProfileMediaPanel } from './user-dialog/components/UserDialogProfileMediaPanel';
import { UserDialogTabsSection } from './user-dialog/components/UserDialogTabsSection';
import { buildUserDialogLocationUsers } from './user-dialog/userDialogLocationUsers.js';
import {
    isOfflineLikeValue,
    normalizedText
} from './user-dialog/userDialogRows.js';
import { buildUserDialogProfileSummary } from './user-dialog/userDialogViewData.js';
import { useUserDialogGroupActions } from './user-dialog/useUserDialogGroupActions.js';
import { useUserDialogTabData } from './user-dialog/useUserDialogTabData.js';

const VRC_PLUS_SUMMARY_SNAPSHOT = Object.freeze({ $isVRCPlus: true });

function finiteTabCount(value) {
    const count = Number(value);
    return Number.isFinite(count) && count >= 0 ? count : undefined;
}

function loadedTabCount(status, rows) {
    return status === 'ready' && Array.isArray(rows) ? rows.length : undefined;
}

function resolveTabCount(primary, fallback) {
    return finiteTabCount(primary) ?? finiteTabCount(fallback);
}

export function UserDialogTabbedView({
    profile,
    memo,
    detail,
    imageUrl,
    loadStatus,
    actionStatus,
    recentActionVersion = 0,
    reloadToken = 0,
    initialAction = '',
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
    onEditSelfProfileDetails,
    onSetSelfProfileMediaField,
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
    const currentAvatarId = useRuntimeStore(
        (state) => state.auth.currentUserSnapshot?.currentAvatar || ''
    );
    const previousAvatarSwapTime = useRuntimeStore(
        (state) =>
            Number(state.auth.currentUserSnapshot?.$previousAvatarSwapTime) || 0
    );
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
    const [selfPanel, setSelfPanel] = useState('');

    const tabData = useUserDialogTabData({
        profile,
        reloadToken,
        isCurrentUser,
        currentEndpoint,
        currentUserId,
        currentAvatarId,
        previousAvatarSwapTime,
        currentUserHasSharedConnectionsOptOut,
        friendsById,
        inGameGroupOrder,
        selectedGroupIds,
        t
    });

    useEffect(() => {
        if (initialAction === 'profile-media' && isCurrentUser) {
            setSelfPanel('profile-media');
        }
    }, [initialAction, isCurrentUser]);

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
        remoteTabCounts,
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
    const tabCounts = useMemo(
        () => ({
            'instance-history': previousInstances.length,
            mutual: resolveTabCount(
                loadedTabCount(remoteStatus.mutual, mutualFriends),
                mutualFriendCount
            ),
            groups: resolveTabCount(
                loadedTabCount(remoteStatus.groups, profileGroups),
                remoteTabCounts.groups
            ),
            worlds: resolveTabCount(
                loadedTabCount(remoteStatus.worlds, profileWorlds),
                remoteTabCounts.worlds
            ),
            'favorite-worlds': resolveTabCount(
                loadedTabCount(remoteStatus['favorite-worlds'], favoriteWorlds),
                remoteTabCounts['favorite-worlds']
            ),
            avatars: resolveTabCount(
                loadedTabCount(remoteStatus.avatars, profileAvatars),
                remoteTabCounts.avatars
            )
        }),
        [
            favoriteWorlds.length,
            mutualFriendCount,
            mutualFriends.length,
            previousInstances.length,
            profileAvatars.length,
            profileGroups.length,
            profileWorlds.length,
            remoteStatus.mutual,
            remoteStatus.avatars,
            remoteStatus['favorite-worlds'],
            remoteStatus.groups,
            remoteStatus.worlds,
            remoteTabCounts
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
            t('dialog.user.dynamic.value_copied', { value: label })
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
                          'dialog.user.toast.failed_to_open_discord_profile'
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
            toast.error(t('dialog.user.error.avatar_author_unavailable'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'dialog.user.toast.failed_to_load_avatar_author'
                      )
            );
        }
    }

    function openInstanceHistory() {
        changeTab('instance-history', { allowHidden: true });
    }

    const headerState = {
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
        userSubtitle,
        userUrl
    };
    const headerActions = {
        onAvatarOverride,
        onBoop,
        onCopyUserId: () => void copyUserText(profile.id, 'User ID'),
        onCopyUserUrl: () => void copyUserText(userUrl, 'User URL'),
        onEditMemo,
        onEditSelfProfileDetails,
        onEditSelfProfileMedia: () => setSelfPanel('profile-media'),
        onEditSelfStatus,
        onExtendedModeration,
        onFriendRequest,
        onGroupModeration,
        onImageClick: () =>
            openImagePreview({
                url: imageUrl,
                title: profileTitle
            }),
        onInvite,
        onInviteMessage,
        onInviteRequest,
        onInviteRequestMessage,
        onInviteToGroup: groupActions.inviteToGroup,
        onModeration,
        onOpenDiscordProfile: openDiscordProfile,
        onOpenFallbackAvatar: () => openAvatarDialog(fallbackAvatarDialogArgs),
        onOpenImagePreview: openImagePreview,
        onOpenUserIcon: () =>
            openImagePreview({
                url: convertFileUrlToImageUrl(profile.userIcon, 512),
                title: profileTitle
            }),
        onOpenUserUrl: () => openExternalLink(userUrl),
        onRefresh,
        onReportHacking,
        onShowAvatarAuthor: showAvatarAuthor,
        onShowInstanceHistory: openInstanceHistory,
        onSubtitleClick: username
            ? () => void copyUserText(username, 'Username')
            : undefined,
        onTitleClick:
            profile.displayName || profile.username
                ? () =>
                      void copyUserText(
                          profile.displayName || profile.username,
                          'Display name'
                      )
                : undefined,
        onToggleBadgeShowcased,
        onToggleBadgeVisibility,
        onToggleSelfAvatarCopying,
        onToggleSelfBooping,
        onToggleSelfDiscordConnections,
        onToggleSelfSharedConnections,
        onUnfriend
    };
    const tabsState = {
        root: {
            activeTab,
            tabCounts,
            tabs
        },
        info: {
            bioLinks,
            currentAvatarDialogArgs,
            currentAvatarDisplayName,
            currentAvatarTarget,
            hideUserMemos,
            hideUserNotes,
            isCurrentUser,
            lastSeen,
            memo,
            profile,
            representedGroup,
            representedGroupStatus,
            userJoinCount,
            userTimeSpent,
            visibleHomeLocationTarget
        },
        presence: {
            visiblePresenceLocation,
            locationInstance,
            locationOwnerId,
            locationPlayerCount,
            currentUserId,
            currentEndpoint,
            locationWorldTitle,
            locationFriendCount,
            previousInstances,
            locationInstanceUsers
        },
        remote: {
            loadTab,
            remoteData,
            remoteErrors,
            remoteStatus,
            search
        },
        mutual: {
            filteredMutualFriends,
            mutualFriends,
            mutualSort,
            visibleMutualFriends
        },
        groups: {
            effectiveGroupSort,
            filteredProfileGroups,
            groupSearchActive,
            ownGroupCountText,
            profileGroups,
            remainingGroupCountText,
            userGroupSections
        },
        worlds: {
            filteredProfileWorlds,
            profileWorlds,
            worldOrder,
            worldSort
        },
        favoriteWorlds: {
            favoriteWorlds,
            filteredFavoriteWorlds
        },
        avatars: {
            avatarReleaseStatus,
            avatarSort,
            currentUserId,
            profileAvatars,
            visibleProfileAvatars
        },
        history: {
            previousInstances
        },
        json: {
            isFavorite,
            isFriend,
            moderationState
        }
    };
    const tabsActions = {
        changeAvatarReleaseStatus,
        changeAvatarSort,
        changeTab,
        changeWorldOrder,
        changeWorldSort,
        onEditMemo,
        onOpenInstanceHistory: openInstanceHistory,
        onPreviousInstancesChange,
        onRefreshLocation,
        openAvatarDialog,
        openGroupDialog,
        setGroupSort,
        setMutualSort,
        setSearch
    };

    return (
        <EntityDialogScaffold className="gap-3">
            <EntityDialogTwoColumnLayout
                rail={
                    <UserDialogHeaderSection
                        state={headerState}
                        actions={headerActions}
                    />
                }
            >
                {selfPanel === 'profile-media' && isCurrentUser ? (
                    <UserDialogProfileMediaPanel
                        profile={profile}
                        endpoint={currentEndpoint}
                        isVrcPlusSupporter={isLocalUserVrcPlusSupporter}
                        actionStatus={actionStatus}
                        onBack={() => setSelfPanel('')}
                        onSetProfileMediaField={onSetSelfProfileMediaField}
                    />
                ) : (
                    <UserDialogTabsSection
                        state={tabsState}
                        actions={tabsActions}
                    />
                )}
            </EntityDialogTwoColumnLayout>
        </EntityDialogScaffold>
    );
}
