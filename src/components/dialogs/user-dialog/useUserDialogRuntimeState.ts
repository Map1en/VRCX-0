import { useMemo } from 'react';

import { useKnownUserFact } from '@/domain/users/useKnownUser';
import { useDialogStore } from '@/state/dialogStore';
import { useFavoriteStore } from '@/state/favoriteStore';
import { useFriendRosterStore } from '@/state/friendRosterStore';
import { useModalStore } from '@/state/modalStore';
import { usePreferencesStore } from '@/state/preferencesStore';
import { useRuntimeStore } from '@/state/runtimeStore';

const EMPTY_GROUP_ORDER: any[] = [];

export function useUserDialogRuntimeState(normalizedUserId: string) {
    const currentUserId = useRuntimeStore(
        (state: any) => state.auth.currentUserId
    );
    const currentUserSnapshot = useRuntimeStore(
        (state: any) => state.auth.currentUserSnapshot
    );
    const isLocalUserVrcPlusSupporter = useRuntimeStore((state: any) =>
        Boolean(
            state.auth.currentUserSnapshot?.$isVRCPlus ||
            state.auth.currentUserSnapshot?.tags?.includes?.(
                'system_supporter'
            ) ||
            (globalThis as typeof globalThis & { $debug?: AppDebug })?.$debug
                ?.debugVrcPlus
        )
    );
    const currentEndpoint = useRuntimeStore(
        (state: any) => state.auth.currentUserEndpoint
    );
    const runtimeCurrentLocation = useRuntimeStore(
        (state: any) => state.gameState.currentLocation
    );
    const runtimeCurrentDestination = useRuntimeStore(
        (state: any) => state.gameState.currentDestination
    );
    const runtimeCurrentWorldId = useRuntimeStore(
        (state: any) => state.gameState.currentWorldId
    );
    const isGameRunning = useRuntimeStore(
        (state: any) => state.gameState.isGameRunning
    );
    const groupInstancesEndpoint = useRuntimeStore(
        (state: any) => state.groupInstances.endpoint
    );
    const groupInstancesUserId = useRuntimeStore(
        (state: any) => state.groupInstances.userId
    );
    const groupInstances = useRuntimeStore(
        (state: any) => state.groupInstances.instances
    );
    const groupInstancesLastLoadedAt = useRuntimeStore(
        (state: any) => state.groupInstances.lastLoadedAt
    );
    const groupInstancesFetchedAt = useRuntimeStore(
        (state: any) => state.groupInstances.fetchedAt
    );
    const groupInstancesStatus = useRuntimeStore(
        (state: any) => state.groupInstances.status
    );
    const friendsById = useFriendRosterStore((state: any) => state.friendsById);
    const applyFriendPatch = useFriendRosterStore(
        (state: any) => state.applyFriendPatch
    );
    const remoteFavoriteFriendIds = useFavoriteStore(
        (state: any) => state.favoriteFriendIds
    );
    const localFriendFavorites = useFavoriteStore(
        (state: any) => state.localFriendFavorites
    );
    const prompt = useModalStore((state: any) => state.prompt);
    const confirm = useModalStore((state: any) => state.confirm);
    const updateEntityDialogMetadata = useDialogStore(
        (state: any) => state.updateEntityDialogMetadata
    );
    const gameLogDisabled = usePreferencesStore(
        (state: any) => state.gameLogDisabled
    );
    const hideUserNotes = usePreferencesStore(
        (state: any) => state.hideUserNotes
    );
    const hideUserMemos = usePreferencesStore(
        (state: any) => state.hideUserMemos
    );
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
        (state: any) => state.auth.currentUserEndpoint
    );
    const currentUserId = useRuntimeStore(
        (state: any) => state.auth.currentUserId
    );
    const currentAvatarId = useRuntimeStore(
        (state: any) => state.auth.currentUserSnapshot?.currentAvatar || ''
    );
    const previousAvatarSwapTime = useRuntimeStore(
        (state: any) =>
            Number(state.auth.currentUserSnapshot?.$previousAvatarSwapTime) || 0
    );
    const isLocalUserVrcPlusSupporter = useRuntimeStore((state: any) =>
        Boolean(
            state.auth.currentUserSnapshot?.$isVRCPlus ||
            state.auth.currentUserSnapshot?.tags?.includes?.(
                'system_supporter'
            ) ||
            (globalThis as typeof globalThis & { $debug?: AppDebug })?.$debug
                ?.debugVrcPlus
        )
    );
    const inGameGroupOrder = useRuntimeStore((state: any) =>
        state.groupInstances.userId === state.auth.currentUserId &&
        state.groupInstances.endpoint === state.auth.currentUserEndpoint
            ? state.groupInstances.groupOrder
            : EMPTY_GROUP_ORDER
    );
    const friendsById = useFriendRosterStore((state: any) => state.friendsById);
    const openImagePreview = useModalStore(
        (state: any) => state.openImagePreview
    );
    const prompt = useModalStore((state: any) => state.prompt);
    const confirm = useModalStore((state: any) => state.confirm);

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
