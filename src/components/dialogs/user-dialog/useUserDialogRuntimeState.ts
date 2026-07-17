import { useMemo } from 'react';

import { useKnownUserFact } from '@/lib/useKnownUser';
import { useDialogStore } from '@/state/dialogStore';
import { useFavoriteStore } from '@/state/favoriteStore';
import { useFriendRosterStore } from '@/state/friendRosterStore';
import { useModalStore } from '@/state/modalStore';
import { usePreferencesStore } from '@/state/preferencesStore';
import { useRuntimeStore } from '@/state/runtimeStore';

const EMPTY_GROUP_ORDER: string[] = [];

export function useUserDialogRuntimeState(normalizedUserId: string) {
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const currentUserSnapshot = useRuntimeStore(
        (state) => state.auth.currentUserSnapshot
    );
    const isLocalUserVrcPlusSupporter = useRuntimeStore((state) =>
        Boolean(
            state.auth.currentUserSnapshot?.$isVRCPlus ||
            state.auth.currentUserSnapshot?.tags?.includes?.(
                'system_supporter'
            ) ||
            globalThis.$debug?.debugVrcPlus
        )
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
    const groupInstancesUserId = useRuntimeStore(
        (state) => state.groupInstances.userId
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
            userId: groupInstancesUserId,
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
            groupInstancesStatus,
            groupInstancesUserId
        ]
    );

    return {
        applyFriendPatch,
        confirm,
        currentEndpoint,
        currentUserId,
        currentUserSnapshot,
        gameLogDisabled,
        gameState,
        groupInstancesState,
        friendsById,
        hideUserMemos,
        hideUserNotes,
        isLocalUserVrcPlusSupporter,
        knownTargetUser,
        localFriendFavorites,
        prompt,
        remoteFavoriteFriendIds,
        updateEntityDialogMetadata
    };
}

export function useUserDialogTabbedRuntimeState() {
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
            globalThis.$debug?.debugVrcPlus
        )
    );
    const inGameGroupOrder = useRuntimeStore((state) =>
        state.groupInstances.userId === state.auth.currentUserId &&
        state.groupInstances.endpoint === state.auth.currentUserEndpoint
            ? state.groupInstances.groupOrder
            : EMPTY_GROUP_ORDER
    );
    const friendsById = useFriendRosterStore((state) => state.friendsById);
    const openImagePreview = useModalStore((state) => state.openImagePreview);
    const prompt = useModalStore((state) => state.prompt);
    const confirm = useModalStore((state) => state.confirm);

    return {
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
    };
}
