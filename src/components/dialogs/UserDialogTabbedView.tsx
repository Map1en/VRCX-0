import { ClockIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { resolveSidebarStatusDotClassName } from '@/components/sidebar/friends-sidebar/friendsSidebarModel';
import { openAvatarDialog, openGroupDialog } from '@/services/dialogService';
import {
    convertFileUrlToImageUrl,
    openExternalLink
} from '@/services/entityMediaService';
import { isActionRecent } from '@/services/recentActionService';
import { parseLocation } from '@/shared/utils/location';
import { useRuntimeStore } from '@/state/runtimeStore';

import {
    EntityDialogScaffold,
    EntityDialogTwoColumnLayout
} from './EntityDialogScaffold';
import { UserDialogHeaderSection } from './user-dialog/components/UserDialogHeaderSection';
import { UserDialogProfileMediaPanel } from './user-dialog/components/UserDialogProfileMediaPanel';
import { UserDialogTabsSection } from './user-dialog/components/UserDialogTabsSection';
import { buildUserDialogLocationUsers } from './user-dialog/userDialogLocationUsers';
import {
    isOfflineLikeValue,
    normalizedText
} from './user-dialog/userDialogRows';
import { buildUserDialogProfileSummary } from './user-dialog/userDialogViewData';
import { useUserDialogAvatarAuthorAction } from './user-dialog/useUserDialogAvatarAuthorAction';
import { useUserDialogClipboardActions } from './user-dialog/useUserDialogClipboardActions';
import { useUserDialogGroupActions } from './user-dialog/useUserDialogGroupActions';
import { useUserDialogTabbedRuntimeState } from './user-dialog/useUserDialogRuntimeState';
import { useUserDialogTabData } from './user-dialog/useUserDialogTabData';

const VRC_PLUS_SUMMARY_SNAPSHOT = Object.freeze({ $isVRCPlus: true });

function finiteTabCount(value: any) {
    const count = Number(value);
    return Number.isFinite(count) && count >= 0 ? count : undefined;
}

function loadedTabCount(status: any, rows: any) {
    return status === 'ready' && Array.isArray(rows) ? rows.length : undefined;
}

function resolveTabCount(primary: any, fallback: any) {
    return finiteTabCount(primary) ?? finiteTabCount(fallback);
}

export function UserDialogTabbedView({
    profile,
    friendControls,
    locationPanel,
    platformInfo,
    presence,
    profileControls,
    relationship,
    resource,
    selfControls
}: any) {
    const {
        memo,
        detail,
        imageUrl,
        loadStatus,
        actionStatus,
        recentActionVersion = 0,
        reloadToken = 0,
        initialAction = ''
    } = resource;
    const {
        moderationState,
        extendedModerationState = { interactOff: false, muteChat: false },
        avatarOverrideState = { hideAvatar: false, showAvatar: false },
        isCurrentUser,
        isFriend,
        isFavorite,
        friendRequestState
    } = relationship;
    const { platform, platformIcon: PlatformIcon } = platformInfo;
    const {
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
        hideUserMemos = false
    } = presence;
    const {
        sameInstanceUsers = [],
        locationOwnerUser = null,
        locationOwnerGroup = null,
        locationInstance = null,
        locationFriendCount = 0,
        locationPlayerCount = 0,
        onRefreshLocation,
        onPreviousInstancesChange
    } = locationPanel;
    const { onRefresh, onEditMemo } = profileControls;
    const {
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
        onGroupModeration
    } = friendControls;
    const {
        editSelfStatus: onEditSelfStatus,
        editSelfProfileDetails: onEditSelfProfileDetails,
        setSelfProfileMediaField: onSetSelfProfileMediaField,
        toggleSelfAvatarCopying: onToggleSelfAvatarCopying,
        toggleSelfBooping: onToggleSelfBooping,
        toggleSelfSharedConnections: onToggleSelfSharedConnections,
        toggleSelfDiscordConnections: onToggleSelfDiscordConnections,
        toggleBadgeVisibility: onToggleBadgeVisibility,
        toggleBadgeShowcased: onToggleBadgeShowcased
    } = selfControls;
    const { t } = useTranslation();
    const [nowMs, setNowMs] = useState(() => Date.now());
    const {
        confirm,
        currentAvatarId,
        currentEndpoint,
        currentUserId,
        friendsById,
        inGameGroupOrder,
        isLocalUserVrcPlusSupporter,
        openImagePreview,
        previousAvatarSwapTime,
        prompt
    } = useUserDialogTabbedRuntimeState();
    const [selectedGroupIds, setSelectedGroupIds] = useState(() => new Set());
    const [selfPanel, setSelfPanel] = useState('');
    const { copyUserText, openDiscordProfile } =
        useUserDialogClipboardActions();
    const currentUserSnapshot = useRuntimeStore(
        (state: any) => state.auth.currentUserSnapshot
    );

    useEffect(() => {
        const intervalId = window.setInterval(() => {
            setNowMs(Date.now());
        }, 60000);
        return () => {
            window.clearInterval(intervalId);
        };
    }, []);

    const tabData: any = useUserDialogTabData({
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
        friendNumber,
        estimatedOnlineDurationMs,
        presenceActivityAt,
        friendedAt
    } = buildUserDialogProfileSummary({
        profile,
        userStats,
        sortedProfileGroups,
        selectedUserGroups,
        isCurrentUser,
        vrchatConfigConstants,
        currentUserSnapshot: isLocalUserVrcPlusSupporter
            ? VRC_PLUS_SUMMARY_SNAPSHOT
            : null,
        nowMs
    });
    const statusDotClassName = resolveSidebarStatusDotClassName(
        profile,
        currentUserSnapshot,
        isCurrentUser,
        { hideNonFriend: false }
    );
    const currentAvatarDisplayName = String(
        profile.currentAvatarName || profile.avatarName || ''
    ).trim();
    const currentAvatarDialogArgs: any = {
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
    const fallbackAvatarDialogArgs: any = {
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
    const isRecentDialogAction = (actionType: any) =>
        recentActionVersion >= 0 && isActionRecent(profile.id, actionType);
    const recentDialogShortcut = (actionType: any) =>
        isRecentDialogAction(actionType) ? (
            <ClockIcon className="text-muted-foreground size-3.5" />
        ) : null;

    const showAvatarAuthor = useUserDialogAvatarAuthorAction({
        currentAvatarTarget,
        currentEndpoint
    });

    function openInstanceHistory() {
        changeTab('instance-history', { allowHidden: true });
    }

    const headerModel: any = {
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
        statusDotClassName,
        statusStateText,
        userSubtitle,
        userUrl,
        estimatedOnlineDurationMs
    };
    const headerCommands: any = {
        onAvatarOverride,
        onBoop,
        onCopyUserId: () => {
            copyUserText(profile.id, 'User ID');
        },
        onCopyUserUrl: () => {
            copyUserText(userUrl, 'User URL');
        },
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
            ? () => {
                  copyUserText(username, 'Username');
              }
            : undefined,
        onTitleClick:
            profile.displayName || profile.username
                ? () => {
                      copyUserText(
                          profile.displayName || profile.username,
                          'Display name'
                      );
                  }
                : undefined,
        onToggleBadgeShowcased,
        onToggleBadgeVisibility,
        onToggleSelfAvatarCopying,
        onToggleSelfBooping,
        onToggleSelfDiscordConnections,
        onToggleSelfSharedConnections,
        onUnfriend
    };
    const tabsModel: any = {
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
            friendedAt,
            presenceActivityAt,
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
    const tabsCommands: any = {
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
                        headerModel={headerModel}
                        headerCommands={headerCommands}
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
                        tabsModel={tabsModel}
                        tabsCommands={tabsCommands}
                    />
                )}
            </EntityDialogTwoColumnLayout>
        </EntityDialogScaffold>
    );
}
