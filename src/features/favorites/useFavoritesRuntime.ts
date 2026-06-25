import { useMemo } from 'react';

import { checkCanInvite } from '@/shared/utils/invite';
import { useRuntimeStore } from '@/state/runtimeStore';

import { resolveCurrentInviteLocation } from './favoritesItems';

export function useFavoritesRuntime() {
    const currentEndpoint = useRuntimeStore(
        (state: any) => state.auth.currentUserEndpoint
    );
    const currentUserId = useRuntimeStore(
        (state: any) => state.auth.currentUserId
    );
    const currentUserSnapshot = useRuntimeStore(
        (state: any) => state.auth.currentUserSnapshot
    );
    const runtimeCurrentLocation = useRuntimeStore(
        (state: any) => state.gameState.currentLocation
    );
    const runtimeCurrentDestination = useRuntimeStore(
        (state: any) => state.gameState.currentDestination
    );
    const isGameRunning = useRuntimeStore(
        (state: any) => state.gameState.isGameRunning
    );
    const gameState = useMemo(
        () => ({
            currentLocation: runtimeCurrentLocation,
            currentDestination: runtimeCurrentDestination,
            isGameRunning
        }),
        [isGameRunning, runtimeCurrentDestination, runtimeCurrentLocation]
    );
    const currentInviteLocation = useMemo(
        () => resolveCurrentInviteLocation(gameState, currentUserSnapshot),
        [currentUserSnapshot, gameState]
    );
    const canInviteFromCurrentLocation = useMemo(
        () =>
            checkCanInvite(currentInviteLocation, {
                currentUserId,
                lastLocationStr: currentInviteLocation,
                cachedInstances: new Map()
            }),
        [currentInviteLocation, currentUserId]
    );
    const canSendInvite = Boolean(
        gameState.isGameRunning &&
        currentInviteLocation &&
        canInviteFromCurrentLocation
    );

    return {
        canBoop: Boolean(currentUserSnapshot?.isBoopingEnabled),
        canInviteFromCurrentLocation,
        canSendInvite,
        currentAvatarId: currentUserSnapshot?.currentAvatar || '',
        currentEndpoint,
        currentInviteLocation,
        currentUserId,
        currentUserSnapshot,
        gameState
    };
}
