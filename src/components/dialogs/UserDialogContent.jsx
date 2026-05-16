import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { convertFileUrlToImageUrl } from '@/lib/entityMedia.js';
import { useKnownUserFact } from '@/domain/users/useKnownUser.js';
import { recordKnownUser } from '@/services/domainIngestionService.js';
import { subscribeRecentActions } from '@/services/recentActionService.js';
import { useDialogStore } from '@/state/dialogStore.js';
import { useFavoriteStore } from '@/state/favoriteStore.js';
import { useFriendRosterStore } from '@/state/friendRosterStore.js';
import { useModalStore } from '@/state/modalStore.js';
import { usePreferencesStore } from '@/state/preferencesStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';

import { UserDialogContentDialogs } from './user-dialog/components/UserDialogContentDialogs.jsx';
import {
    UserDialogEmptyState,
    UserDialogProfileSkeleton
} from './user-dialog/components/UserDialogContentStates.jsx';
import { dialogTargetKey } from './user-dialog/userDialogCache.js';
import {
    isSameLocationTag,
    resolveFriendRequestState,
    resolvePlatformMeta,
    resolvePresenceLocation
} from './user-dialog/userDialogContentHelpers.js';
import {
    buildFavoriteIdSet,
    normalizeUserId
} from './user-dialog/userProfileFields.js';
import { useUserDialogActions } from './user-dialog/useUserDialogActions.js';
import {
    createEmptyUserDialogLocationPanel,
    useUserDialogLocationPanel
} from './user-dialog/useUserDialogLocationPanel.js';
import { useUserDialogMemoState } from './user-dialog/useUserDialogMemoState.js';
import { useUserDialogModerationState } from './user-dialog/useUserDialogModerationState.js';
import {
    mergeUserDialogLocalSnapshot,
    useUserDialogProfileResource
} from './user-dialog/useUserDialogProfileResource.js';
import { useUserDialogSelfActions } from './user-dialog/useUserDialogSelfActions.js';
import { useUserDialogSupplementalData } from './user-dialog/useUserDialogSupplementalData.js';
import { UserDialogTabbedView } from './UserDialogTabbedView.jsx';

const userDialogSkeletonDelayMs = 160;

function useDelayedUserDialogSkeleton(loading, identity) {
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
}) {
    const { t } = useTranslation();

    const normalizedUserId = normalizeUserId(userId);
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const currentUserSnapshot = useRuntimeStore(
        (state) => state.auth.currentUserSnapshot
    );
    const currentEndpoint = useRuntimeStore(
        (state) => state.auth.currentUserEndpoint
    );
    const runtimeCurrentLocation = useRuntimeStore(
        (state) => state.gameState.currentLocation
    );
    const runtimeCurrentDestination = useRuntimeStore(
        (state) => state.gameState.currentDestination
    );
    const runtimeCurrentWorldId = useRuntimeStore(
        (state) => state.gameState.currentWorldId
    );
    const isGameRunning = useRuntimeStore(
        (state) => state.gameState.isGameRunning
    );
    const groupInstancesEndpoint = useRuntimeStore(
        (state) => state.groupInstances.endpoint
    );
    const groupInstances = useRuntimeStore(
        (state) => state.groupInstances.instances
    );
    const groupInstancesLastLoadedAt = useRuntimeStore(
        (state) => state.groupInstances.lastLoadedAt
    );
    const groupInstancesFetchedAt = useRuntimeStore(
        (state) => state.groupInstances.fetchedAt
    );
    const groupInstancesStatus = useRuntimeStore(
        (state) => state.groupInstances.status
    );
    const normalizedCurrentUserId = normalizeUserId(currentUserId);
    const isTargetCurrentUser = Boolean(
        normalizedUserId && normalizedUserId === normalizedCurrentUserId
    );
    const friendsById = useFriendRosterStore((state) => state.friendsById);
    const applyFriendPatch = useFriendRosterStore(
        (state) => state.applyFriendPatch
    );
    const remoteFavoriteFriendIds = useFavoriteStore(
        (state) => state.favoriteFriendIds
    );
    const localFriendFavorites = useFavoriteStore(
        (state) => state.localFriendFavorites
    );
    const prompt = useModalStore((state) => state.prompt);
    const confirm = useModalStore((state) => state.confirm);
    const updateEntityDialogMetadata = useDialogStore(
        (state) => state.updateEntityDialogMetadata
    );
    const gameLogDisabled = usePreferencesStore(
        (state) => state.gameLogDisabled
    );
    const hideUserNotes = usePreferencesStore((state) => state.hideUserNotes);
    const hideUserMemos = usePreferencesStore((state) => state.hideUserMemos);
    const knownTargetUser = useKnownUserFact(normalizedUserId, {
        endpoint: currentEndpoint
    });

    const friendSnapshot = friendsById[normalizedUserId] || null;
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
    const targetKey = dialogTargetKey(currentEndpoint, normalizedUserId);
    const gameState = useMemo(
        () => ({
            currentLocation: runtimeCurrentLocation,
            currentDestination: runtimeCurrentDestination,
            currentWorldId: runtimeCurrentWorldId,
            isGameRunning
        }),
        [
            isGameRunning,
            runtimeCurrentDestination,
            runtimeCurrentLocation,
            runtimeCurrentWorldId
        ]
    );
    const groupInstancesState = useMemo(
        () => ({
            endpoint: groupInstancesEndpoint,
            instances: groupInstances,
            lastLoadedAt: groupInstancesLastLoadedAt,
            fetchedAt: groupInstancesFetchedAt,
            status: groupInstancesStatus
        }),
        [
            groupInstances,
            groupInstancesEndpoint,
            groupInstancesFetchedAt,
            groupInstancesLastLoadedAt,
            groupInstancesStatus
        ]
    );
    const actionStatusRef = useRef('idle');
    const [actionStatus, setActionStatus] = useState('idle');
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
        isTargetCurrentUser,
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

    const { memo, editMemo } = useUserDialogMemoState({
        activeUserTargetRef,
        applyFriendPatch,
        currentEndpoint,
        friendsById,
        isCurrentUser,
        normalizedUserId,
        profile,
        prompt,
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
        handleInviteMessageDialogOpenChange,
        selectInviteMessage,
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
        moderationRevisionRef,
        moderationState,
        openNonce,
        profile,
        prompt,
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
                memo={memo}
                detail={detail}
                imageUrl={imageUrl}
                loadStatus={loadStatus}
                actionStatus={actionStatus}
                recentActionVersion={recentActionVersion}
                reloadToken={reloadToken}
                initialAction={initialAction}
                moderationState={moderationState}
                extendedModerationState={extendedModerationState}
                avatarOverrideState={avatarOverrideState}
                isCurrentUser={isCurrentUser}
                isFriend={isFriend}
                isFavorite={isFavorite}
                friendRequestState={friendRequestState}
                platform={platform}
                platformIcon={PlatformIcon}
                presenceLocation={presenceLocation}
                currentAvatarTarget={currentAvatarTarget}
                homeLocationTarget={homeLocationTarget}
                canInviteFromCurrentLocation={canInviteFromCurrentLocation}
                currentUserHasSharedConnectionsOptOut={Boolean(
                    currentUserSnapshot?.hasSharedConnectionsOptOut
                )}
                currentUserBoopingEnabled={
                    currentUserSnapshot?.isBoopingEnabled !== false
                }
                userStats={userStats}
                previousInstances={previousInstances}
                representedGroup={representedGroup}
                representedGroupStatus={representedGroupStatus}
                hideUserNotes={hideUserNotes}
                hideUserMemos={hideUserMemos}
                onPreviousInstancesChange={setPreviousInstances}
                sameInstanceUsers={activeLocationPanel.users}
                locationOwnerUser={activeLocationPanel.ownerUser}
                locationOwnerGroup={activeLocationPanel.ownerGroup}
                locationInstance={activeLocationPanel.instance}
                locationFriendCount={activeLocationPanel.friendCount}
                locationPlayerCount={activeLocationPanel.playerCount}
                onRefreshLocation={refreshLocationPanel}
                onRefresh={refreshProfile}
                onEditMemo={editMemo}
                onFriendRequest={(action) =>
                    void userActions.updateFriendRequest(action)
                }
                onInvite={() => void userActions.sendUserInvite()}
                onInviteMessage={() =>
                    void userActions.sendUserInvite({ withMessage: true })
                }
                onInviteRequest={() => void userActions.sendUserInviteRequest()}
                onInviteRequestMessage={() =>
                    void userActions.sendUserInviteRequest({
                        withMessage: true
                    })
                }
                onBoop={() => void userActions.sendUserBoop()}
                onUnfriend={() => void userActions.unfriendUser()}
                onModeration={(type, enabled) =>
                    void userActions.setUserModeration(type, enabled)
                }
                onExtendedModeration={(type, enabled) =>
                    void userActions.setExtendedUserModeration(type, enabled)
                }
                onAvatarOverride={(type) =>
                    void userActions.setAvatarOverrideModeration(type)
                }
                onReportHacking={() => void userActions.reportHacking()}
                onGroupModeration={() =>
                    void userActions.openGroupModerationForUser()
                }
                onEditSelfStatus={selfActions.editSelfStatus}
                onEditSelfProfileDetails={selfActions.editSelfProfileDetails}
                onSetSelfProfileMediaField={
                    selfActions.setSelfProfileMediaField
                }
                onToggleSelfAvatarCopying={selfActions.toggleSelfAvatarCopying}
                onToggleSelfBooping={selfActions.toggleSelfBooping}
                onToggleSelfSharedConnections={
                    selfActions.toggleSelfSharedConnections
                }
                onToggleSelfDiscordConnections={
                    selfActions.toggleSelfDiscordConnections
                }
                onToggleBadgeVisibility={selfActions.toggleBadgeVisibility}
                onToggleBadgeShowcased={selfActions.toggleBadgeShowcased}
            />
            <UserDialogContentDialogs
                actionStatus={actionStatus}
                socialStatusDialog={socialStatusDialog}
                profileDetailsDialog={profileDetailsDialog}
                inviteMessageDialog={{
                    request: inviteMessageRequest,
                    onOpenChange: handleInviteMessageDialogOpenChange,
                    normalizedCurrentUserId,
                    currentEndpoint,
                    targetLabel: profile?.displayName || profile?.id,
                    onUse: selectInviteMessage
                }}
            />
        </>
    );
}
