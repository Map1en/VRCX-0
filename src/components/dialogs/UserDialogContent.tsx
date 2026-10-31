import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { buildFavoriteIdSet } from '@/domain/favorites/favoriteIdSet';
import { localGameLocation } from '@/domain/friends/presence';
import { resolveObservedPlayerUserIds } from '@/domain/friends/sameInstanceFriends';
import { useDelayedFlag } from '@/lib/useDelayedFlag';
import { recordKnownUser } from '@/services/domainIngestionService';
import { userImage } from '@/services/entityMediaService';
import { subscribeRecentActions } from '@/services/recentActionService';
import { recordToolOpen } from '@/services/telemetry/telemetryToolUsage';
import { dialogTargetKey } from '@/services/userDialogSessionCacheService';
import { isRecord } from '@/shared/utils/record';
import { useDialogStore } from '@/state/dialogStore';
import { useFriendLocationTimeStore } from '@/state/friendLocationTimeStore';

import { UserDialogContentDialogs } from './user-dialog/components/UserDialogContentDialogs';
import {
    UserDialogEmptyState,
    UserDialogProfileSkeleton
} from './user-dialog/components/UserDialogContentStates';
import {
    isSameLocationTag,
    resolveUserDialogTargetPresenceLocation,
    resolveFriendRequestState,
    resolvePlatformMeta
} from './user-dialog/userDialogContentHelpers';
import { normalizeUserId } from './user-dialog/userProfileFields';
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
import type {
    AvatarOverrideType,
    ExtendedModerationType,
    ModerationType
} from './user-dialog/useUserModerationActions';
import { UserDialogTabbedView } from './UserDialogTabbedView';

const userDialogSkeletonDelayMs = 160;

export function UserDialogContent({
    userId,
    seedData = null,
    initialAction = '',
    openNonce = 0
}: {
    userId?: string;
    seedData?: unknown;
    initialAction?: string;
    openNonce?: number;
}) {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const closeDialog = useDialogStore((s) => s.closeDialog);
    const normalizedUserId = userId?.trim() ?? '';
    const {
        confirm,
        currentEndpoint,
        currentUserId,
        currentUserSnapshot,
        friendsById,
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
    const [groupInviteOpen, setGroupInviteOpen] = useState(false);
    const [reportOpen, setReportOpen] = useState(false);
    const [accountStandingOpen, setAccountStandingOpen] = useState(false);
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
        isFriend: isKnownFriend,
        isTargetCurrentUser,
        activitySnapshot,
        localSnapshot,
        normalizedUserId,
        updateEntityDialogMetadata
    });
    const targetIdentity = `${currentEndpoint || ''}:${normalizedUserId || ''}:${openNonce}`;
    const profileIsLoading = loadStatus === 'running' && !profile;
    const showProfileSkeleton = useDelayedFlag(
        profileIsLoading,
        userDialogSkeletonDelayMs,
        targetIdentity
    );
    useEffect(() => {
        setGroupInviteOpen(false);
        setGroupQuickModerationOpen(false);
        setReportOpen(false);
        setAccountStandingOpen(false);
    }, [targetIdentity]);

    const currentGameLocation = normalizeUserId(gameState?.currentLocation);
    const currentSnapshotLocation = normalizeUserId(
        currentUserSnapshot?.$locationTag || currentUserSnapshot?.location
    );
    const localLocation = useFriendLocationTimeStore((state) =>
        localGameLocation(state.byUserId[normalizedUserId])
    );
    const presenceLocation = resolveUserDialogTargetPresenceLocation({
        profile,
        targetUserId: normalizedUserId,
        localLocation,
        currentLocation: currentGameLocation || currentSnapshotLocation,
        currentLocationPlayerIds: gameState?.currentLocationPlayerIds,
        currentLocationPlayers: gameState?.currentLocationPlayers,
        friendsById
    });

    useEffect(
        () =>
            subscribeRecentActions(() => {
                setRecentActionVersion((version) => version + 1);
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
        presenceLocation,
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
        loadPreviousInstances,
        previousInstances,
        previousInstancesError,
        previousInstancesStatus,
        representedGroup,
        representedGroupStatus,
        setPreviousInstances,
        userStats
    } = useUserDialogSupplementalData({
        activeUserTargetRef,
        currentEndpoint,
        currentUserId,
        currentUserSnapshot,
        inCurrentWorld: resolveObservedPlayerUserIds(
            gameState?.currentLocationPlayerIds,
            gameState?.currentLocationPlayers,
            friendsById
        ).includes(normalizedUserId),
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
        if (isRecord(seedData)) {
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
    const platform = resolvePlatformMeta(profile?.$platform);
    const PlatformIcon = platform.icon;
    const imageUrl = userImage(profile, 512);
    const { memo, editMemo, memoDialog } = useUserDialogMemoState({
        activeUserTargetRef,
        currentEndpoint,
        normalizedUserId,
        profile,
        setBaseProfile
    });

    const {
        socialStatusDialog,
        profileDetails,
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
                    currentUserAccountStanding:
                        typeof currentUserSnapshot?.accountStanding === 'string'
                            ? currentUserSnapshot.accountStanding
                            : '',
                    userStats,
                    loadPreviousInstances,
                    previousInstances,
                    previousInstancesError,
                    previousInstancesStatus,
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
                    onEditMemo: editMemo,
                    onShowAccountStanding: () => {
                        setAccountStandingOpen(true);
                    }
                }}
                friendControls={{
                    onFriendRequest: (action: string) => {
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
                    onModeration: (type: ModerationType, enabled: boolean) => {
                        userActions.setUserModeration(type, enabled);
                    },
                    onExtendedModeration: (
                        type: ExtendedModerationType,
                        enabled: boolean
                    ) => {
                        userActions.setExtendedUserModeration(type, enabled);
                    },
                    onAvatarOverride: (type: AvatarOverrideType) => {
                        userActions.setAvatarOverrideModeration(type);
                    },
                    onReportUser: () => {
                        setReportOpen(true);
                    },
                    onInviteToGroup: () => {
                        setGroupInviteOpen(true);
                    },
                    onGroupModeration: () => {
                        userActions.openGroupModerationForUser();
                    }
                }}
                selfControls={selfActions}
                selfProfileDetails={profileDetails}
            />
            <UserDialogContentDialogs
                accountStandingDialog={{
                    open: accountStandingOpen,
                    onOpenChange: setAccountStandingOpen
                }}
                actionStatus={actionStatus}
                noteMemoDialog={memoDialog}
                socialStatusDialog={socialStatusDialog}
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
                reportDialog={{
                    open: reportOpen,
                    targetUserId: normalizedUserId,
                    targetLabel: profile?.displayName || profile?.id,
                    onOpenChange: setReportOpen
                }}
                groupInviteDialog={{
                    open: groupInviteOpen,
                    endpoint: currentEndpoint,
                    currentUserId: normalizedCurrentUserId,
                    targetUserId: normalizedUserId,
                    targetLabel: profile?.displayName || profile?.id,
                    onOpenChange: setGroupInviteOpen
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
                        recordToolOpen('group-moderation');
                        closeDialog();
                        navigate(`/tools/group-moderation/${groupId}`);
                    }
                }}
            />
        </>
    );
}
