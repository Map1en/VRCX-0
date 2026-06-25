import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { openGroupDialog } from '@/services/dialogService';
import { recordKnownUser } from '@/services/domainIngestionService';
import { convertFileUrlToImageUrl } from '@/services/entityMediaService';
import { subscribeRecentActions } from '@/services/recentActionService';

import { UserDialogContentDialogs } from './user-dialog/components/UserDialogContentDialogs';
import {
    UserDialogEmptyState,
    UserDialogProfileSkeleton
} from './user-dialog/components/UserDialogContentStates';
import { dialogTargetKey } from './user-dialog/userDialogCache';
import {
    isSameLocationTag,
    resolveFriendRequestState,
    resolvePlatformMeta,
    resolvePresenceLocation
} from './user-dialog/userDialogContentHelpers';
import {
    buildFavoriteIdSet,
    normalizeUserId
} from './user-dialog/userProfileFields';
import { useUserDialogActions } from './user-dialog/useUserDialogActions';
import {
    createEmptyUserDialogLocationPanel,
    useUserDialogLocationPanel
} from './user-dialog/useUserDialogLocationPanel';
import { useUserDialogMemoState } from './user-dialog/useUserDialogMemoState';
import { useUserDialogModerationState } from './user-dialog/useUserDialogModerationState';
import {
    mergeUserDialogLocalSnapshot,
    useUserDialogProfileResource
} from './user-dialog/useUserDialogProfileResource';
import { useUserDialogRuntimeState } from './user-dialog/useUserDialogRuntimeState';
import { useUserDialogSelfActions } from './user-dialog/useUserDialogSelfActions';
import { useUserDialogSupplementalData } from './user-dialog/useUserDialogSupplementalData';
import { UserDialogTabbedView } from './UserDialogTabbedView';

const userDialogSkeletonDelayMs = 160;

function useDelayedUserDialogSkeleton(loading: any, identity: any) {
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        if (!loading) {
            setVisible(false);
            return undefined;
        }

        setVisible(false);
        const timer = setTimeout(() => {
            setVisible(true);
        }, userDialogSkeletonDelayMs);

        return () => {
            clearTimeout(timer);
        };
    }, [identity, loading]);

    return visible;
}

export function UserDialogContent({
    userId,
    seedData = null,
    initialAction = '',
    openNonce = 0
}: any) {
    const { t } = useTranslation();

    const normalizedUserId = normalizeUserId(userId);
    const {
        applyFriendPatch,
        confirm,
        currentEndpoint,
        currentUserId,
        currentUserSnapshot,
        friendsById,
        gameLogDisabled,
        gameState,
        groupInstancesState,
        hideUserMemos,
        hideUserNotes,
        isLocalUserVrcPlusSupporter,
        knownTargetUser,
        localFriendFavorites,
        remoteFavoriteFriendIds,
        updateEntityDialogMetadata
    } = useUserDialogRuntimeState(normalizedUserId);
    const normalizedCurrentUserId = normalizeUserId(currentUserId);
    const isTargetCurrentUser = Boolean(
        normalizedUserId && normalizedUserId === normalizedCurrentUserId
    );
    const friendSnapshot = friendsById[normalizedUserId] || null;
    const isKnownFriend = Boolean(friendSnapshot);
    const localSnapshot = useMemo(
        () =>
            isTargetCurrentUser
                ? currentUserSnapshot
                : mergeUserDialogLocalSnapshot({
                      friendSnapshot,
                      seedData,
                      knownTargetUser
                  }),
        [
            currentUserSnapshot,
            friendSnapshot,
            isTargetCurrentUser,
            knownTargetUser,
            seedData
        ]
    );
    const activitySnapshot = isTargetCurrentUser
        ? currentUserSnapshot
        : friendSnapshot;
    const targetKey = dialogTargetKey(currentEndpoint, normalizedUserId);
    const actionStatusRef = useRef('idle');
    const [actionStatus, setActionStatus] = useState('idle');
    const [groupQuickModerationOpen, setGroupQuickModerationOpen] =
        useState(false);
    const [recentActionVersion, setRecentActionVersion] = useState(0);

    const {
        activeUserTargetRef,
        baseProfile,
        detail,
        loadStatus,
        profile,
        refreshProfile,
        reloadToken,
        setBaseProfile
    } = useUserDialogProfileResource({
        currentEndpoint,
        currentUserSnapshot,
        gameLogDisabled,
        gameState,
        isFriend: isKnownFriend,
        isTargetCurrentUser,
        activitySnapshot,
        localSnapshot,
        normalizedUserId,
        updateEntityDialogMetadata
    });
    const targetIdentity = `${currentEndpoint || ''}:${normalizedUserId || ''}:${openNonce}`;
    const profileIsLoading = loadStatus === 'running' && !profile;
    const showProfileSkeleton = useDelayedUserDialogSkeleton(
        profileIsLoading,
        targetIdentity
    );
    useEffect(() => {
        setGroupQuickModerationOpen(false);
    }, [targetIdentity]);

    const currentGameLocation = normalizeUserId(gameState?.currentLocation);
    const currentGameDestination = normalizeUserId(
        gameState?.currentDestination
    );
    const currentSnapshotLocation = normalizeUserId(
        currentUserSnapshot?.$locationTag || currentUserSnapshot?.location
    );

    useEffect(
        () =>
            subscribeRecentActions(() => {
                setRecentActionVersion((version: any) => version + 1);
            }),
        []
    );

    const {
        locationPanel,
        currentInviteLocation,
        canInviteFromCurrentLocation,
        refreshLocationPanel
    } = useUserDialogLocationPanel({
        currentEndpoint,
        currentUserId,
        currentUserSnapshot,
        gameState,
        groupInstancesState,
        friendsById,
        profile,
        reloadToken
    });

    const {
        avatarOverrideState,
        extendedModerationState,
        moderationRevisionRef,
        moderationState,
        setAvatarOverrideState,
        setExtendedModerationState,
        setModerationState
    } = useUserDialogModerationState({
        currentEndpoint,
        currentUserId,
        isTargetCurrentUser,
        normalizedCurrentUserId,
        normalizedUserId,
        reloadToken
    });

    const {
        previousInstances,
        representedGroup,
        representedGroupStatus,
        setPreviousInstances,
        userStats
    } = useUserDialogSupplementalData({
        activeUserTargetRef,
        currentEndpoint,
        currentGameDestination,
        currentGameLocation,
        currentSnapshotLocation,
        currentUserId,
        currentUserSnapshot,
        isTargetCurrentUser,
        normalizedUserId,
        openNonce,
        profile,
        reloadToken,
        targetKey
    });

    const favoriteFriendIds = useMemo(
        () => buildFavoriteIdSet(remoteFavoriteFriendIds, localFriendFavorites),
        [localFriendFavorites, remoteFavoriteFriendIds]
    );
    const isFavorite = profile?.id
        ? favoriteFriendIds.has(normalizeUserId(profile.id))
        : false;
    const isCurrentUser = Boolean(
        profile?.id &&
        normalizeUserId(profile.id) === normalizeUserId(currentUserId)
    );
    const profileUserId = normalizeUserId(profile?.id);
    const isFriend = Boolean(
        profileUserId && (friendsById[profileUserId] || profile?.isFriend)
    );
    useEffect(() => {
        if (seedData && typeof seedData === 'object') {
            recordKnownUser(seedData, {
                endpoint: currentEndpoint,
                source: 'seed'
            });
        }
    }, [currentEndpoint, seedData]);
    useEffect(() => {
        if (profile?.id) {
            recordKnownUser(profile, {
                endpoint: currentEndpoint,
                source: isCurrentUser ? 'currentUser' : 'profile',
                isCurrentUser,
                isFriend
            });
        }
    }, [currentEndpoint, isCurrentUser, isFriend, profile]);
    const friendRequestState = resolveFriendRequestState(profile);
    const platform = resolvePlatformMeta(
        profile?.$platform || profile?.platform || profile?.last_platform
    );
    const PlatformIcon = platform.icon;
    const imageUrl = profile
        ? convertFileUrlToImageUrl(
              profile.profilePicOverrideThumbnail ||
                  profile.profilePicOverride ||
                  profile.currentAvatarThumbnailImageUrl ||
                  profile.currentAvatarImageUrl ||
                  '',
              256
          )
        : '';
    const presenceLocation = resolvePresenceLocation(profile);

    const { memo, editMemo, memoDialog } = useUserDialogMemoState({
        activeUserTargetRef,
        applyFriendPatch,
        currentEndpoint,
        friendsById,
        isCurrentUser,
        normalizedUserId,
        profile,
        setBaseProfile,
        t
    });

    const {
        socialStatusDialog,
        profileDetailsDialog,
        actions: selfActions
    } = useUserDialogSelfActions({
        profile,
        isCurrentUser,
        currentUserId,
        currentUserSnapshot,
        currentEndpoint,
        baseProfile,
        setBaseProfile,
        actionStatusRef,
        setActionStatus
    });

    const {
        inviteMessageRequest,
        boopDialogRequest,
        handleBoopDialogOpenChange,
        handleInviteMessageDialogOpenChange,
        selectInviteMessage,
        sendUserBoopEmoji,
        actions: userActions
    } = useUserDialogActions({
        actionStatusRef,
        activeUserTargetRef,
        applyFriendPatch,
        avatarOverrideState,
        canInviteFromCurrentLocation,
        confirm,
        currentEndpoint,
        currentInviteLocation,
        currentUserId,
        friendsById,
        isCurrentUser,
        isFriend,
        normalizedCurrentUserId,
        normalizedUserId,
        openGroupQuickModerationDialog: () => {
            setGroupQuickModerationOpen(true);
        },
        moderationRevisionRef,
        moderationState,
        openNonce,
        profile,
        setActionStatus,
        setAvatarOverrideState,
        setBaseProfile,
        setExtendedModerationState,
        setModerationState
    });

    if (profileIsLoading) {
        return (
            <UserDialogProfileSkeleton
                label={t('dialog.user.loading.loading_user_profile')}
                visible={showProfileSkeleton}
            />
        );
    }

    if (!profile) {
        return (
            <UserDialogEmptyState
                title={t('dialog.user.error.user_profile_unavailable')}
                description={
                    detail ||
                    'VRCX-0 could not resolve a user snapshot for this dialog.'
                }
            />
        );
    }

    const currentAvatarTarget = normalizeUserId(profile.currentAvatar);
    const homeLocationTarget = normalizeUserId(profile.homeLocation);
    const hasResolvedLocationPanel = Boolean(locationPanel.location);
    const activeLocationPanel =
        hasResolvedLocationPanel &&
        (!presenceLocation ||
            isSameLocationTag(locationPanel.location, presenceLocation))
            ? locationPanel
            : createEmptyUserDialogLocationPanel();

    return (
        <>
            <UserDialogTabbedView
                profile={profile}
                resource={{
                    memo,
                    detail,
                    imageUrl,
                    loadStatus,
                    actionStatus,
                    recentActionVersion,
                    reloadToken,
                    initialAction
                }}
                relationship={{
                    moderationState,
                    extendedModerationState,
                    avatarOverrideState,
                    isCurrentUser,
                    isFriend,
                    isFavorite,
                    friendRequestState
                }}
                platformInfo={{
                    platform,
                    platformIcon: PlatformIcon
                }}
                presence={{
                    presenceLocation,
                    currentAvatarTarget,
                    homeLocationTarget,
                    canInviteFromCurrentLocation,
                    currentUserHasSharedConnectionsOptOut: Boolean(
                        currentUserSnapshot?.hasSharedConnectionsOptOut
                    ),
                    currentUserBoopingEnabled:
                        currentUserSnapshot?.isBoopingEnabled !== false,
                    userStats,
                    previousInstances,
                    representedGroup,
                    representedGroupStatus,
                    hideUserNotes,
                    hideUserMemos
                }}
                locationPanel={{
                    sameInstanceUsers: activeLocationPanel.users,
                    locationOwnerUser: activeLocationPanel.ownerUser,
                    locationOwnerGroup: activeLocationPanel.ownerGroup,
                    locationInstance: activeLocationPanel.instance,
                    locationFriendCount: activeLocationPanel.friendCount,
                    locationPlayerCount: activeLocationPanel.playerCount,
                    onRefreshLocation: refreshLocationPanel,
                    onPreviousInstancesChange: setPreviousInstances
                }}
                profileControls={{
                    onRefresh: refreshProfile,
                    onEditMemo: editMemo
                }}
                friendControls={{
                    onFriendRequest: (action: any) => {
                        userActions.updateFriendRequest(action);
                    },
                    onInvite: () => {
                        userActions.sendUserInvite();
                    },
                    onInviteMessage: () => {
                        userActions.sendUserInvite({ withMessage: true });
                    },
                    onInviteRequest: () => {
                        userActions.sendUserInviteRequest();
                    },
                    onInviteRequestMessage: () => {
                        userActions.sendUserInviteRequest({
                            withMessage: true
                        });
                    },
                    onBoop: () => {
                        userActions.sendUserBoop();
                    },
                    onUnfriend: () => {
                        userActions.unfriendUser();
                    },
                    onModeration: (type: any, enabled: any) => {
                        userActions.setUserModeration(type, enabled);
                    },
                    onExtendedModeration: (type: any, enabled: any) => {
                        userActions.setExtendedUserModeration(type, enabled);
                    },
                    onAvatarOverride: (type: any) => {
                        userActions.setAvatarOverrideModeration(type);
                    },
                    onReportHacking: () => {
                        userActions.reportHacking();
                    },
                    onGroupModeration: () => {
                        userActions.openGroupModerationForUser();
                    }
                }}
                selfControls={selfActions}
            />
            <UserDialogContentDialogs
                actionStatus={actionStatus}
                noteMemoDialog={memoDialog}
                socialStatusDialog={socialStatusDialog}
                profileDetailsDialog={profileDetailsDialog}
                boopDialog={{
                    request: boopDialogRequest,
                    isLocalUserVrcPlusSupporter,
                    onOpenChange: handleBoopDialogOpenChange,
                    onSend: sendUserBoopEmoji
                }}
                inviteMessageDialog={{
                    request: inviteMessageRequest,
                    onOpenChange: handleInviteMessageDialogOpenChange,
                    normalizedCurrentUserId,
                    currentEndpoint,
                    allowImageUpload: isLocalUserVrcPlusSupporter,
                    targetLabel: profile?.displayName || profile?.id,
                    onUse: selectInviteMessage
                }}
                groupQuickModerationDialog={{
                    open: groupQuickModerationOpen,
                    endpoint: currentEndpoint,
                    currentUserId: normalizedCurrentUserId,
                    targetUserId: normalizedUserId,
                    targetLabel: profile?.displayName || profile?.id,
                    targetImageUrl: imageUrl,
                    onOpenChange: setGroupQuickModerationOpen,
                    onDetailedManagement: (groupId: string) => {
                        openGroupDialog({ groupId });
                    }
                }}
            />
        </>
    );
}
