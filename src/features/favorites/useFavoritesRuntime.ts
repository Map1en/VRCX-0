import { useMemo } from 'react';

import { useCurrentInviteContext } from '@/lib/useCurrentInviteContext';
import { useRuntimeStore } from '@/state/runtimeStore';

export function useFavoritesRuntime() {
    const currentEndpoint = useRuntimeStore(
        (state) => state.auth.currentUserEndpoint
    );
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const currentUserSnapshot = useRuntimeStore(
        (state) => state.auth.currentUserSnapshot
    );
    const runtimeCurrentLocation = useRuntimeStore(
        (state) => state.gameState.currentLocation
    );
    const runtimeCurrentDestination = useRuntimeStore(
        (state) => state.gameState.currentDestination
    );
    const isGameRunning = useRuntimeStore(
        (state) => state.gameState.isGameRunning
    );
    const normalizedCurrentUserId = currentUserId ?? '';
    const gameState = useMemo(
        () => ({
            currentLocation: runtimeCurrentLocation,
            currentDestination: runtimeCurrentDestination,
            isGameRunning
        }),
        [isGameRunning, runtimeCurrentDestination, runtimeCurrentLocation]
    );
    const {
        currentInviteLocation,
        canInviteFromCurrentLocation,
        canSendInvite
    } = useCurrentInviteContext();

    return {
        canBoop: currentUserSnapshot?.isBoopingEnabled === true,
        canInviteFromCurrentLocation,
        canSendInvite,
        currentAvatarId: currentUserSnapshot?.currentAvatar || '',
        currentEndpoint,
        currentInviteLocation,
        currentUserId: normalizedCurrentUserId,
        currentUserSnapshot,
        gameState
    };
}
