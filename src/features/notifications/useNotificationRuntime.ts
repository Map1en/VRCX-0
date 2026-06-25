import { useMemo } from 'react';

import { checkCanInvite } from '@/shared/utils/invite';
import { useRuntimeStore } from '@/state/runtimeStore';

import {
    buildCachedInstanceMap,
    resolveCurrentInviteLocation
} from './notificationRows';

export function useNotificationRuntime() {
    const currentUserId = useRuntimeStore(
        (state: any) => state.auth.currentUserId
    );
    const endpoint = useRuntimeStore(
        (state: any) => state.auth.currentUserEndpoint
    );
    const currentUserLocationTag = useRuntimeStore(
        (state: any) => state.auth.currentUserSnapshot?.$locationTag
    );
    const currentUserLocation = useRuntimeStore(
        (state: any) => state.auth.currentUserSnapshot?.location
    );
    const isLocalUserVrcPlusSupporter = useRuntimeStore((state: any) =>
        Boolean(
            state.auth.currentUserSnapshot?.$isVRCPlus ||
            state.auth.currentUserSnapshot?.tags?.includes?.(
                'system_supporter'
            ) ||
            globalThis.$debug?.debugVrcPlus
        )
    );
    const currentLocation = useRuntimeStore(
        (state: any) => state.gameState.currentLocation
    );
    const currentDestination = useRuntimeStore(
        (state: any) => state.gameState.currentDestination
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

    const groupInstanceRows =
        groupInstancesUserId === currentUserId &&
        groupInstancesEndpoint === endpoint
            ? groupInstances
            : [];
    const gameState = useMemo(
        () => ({
            currentDestination,
            currentLocation
        }),
        [currentDestination, currentLocation]
    );
    const currentUserSnapshot = useMemo(
        () => ({
            $locationTag: currentUserLocationTag,
            location: currentUserLocation
        }),
        [currentUserLocation, currentUserLocationTag]
    );
    const currentInviteLocation = useMemo(
        () => resolveCurrentInviteLocation(gameState, currentUserSnapshot),
        [gameState, currentUserSnapshot]
    );
    const cachedInstances = useMemo(
        () => buildCachedInstanceMap(groupInstanceRows),
        [groupInstanceRows]
    );
    const canInviteFromCurrentLocation = useMemo(
        () =>
            checkCanInvite(currentInviteLocation, {
                cachedInstances,
                currentUserId,
                lastLocationStr: currentInviteLocation
            }),
        [cachedInstances, currentInviteLocation, currentUserId]
    );

    return {
        canInviteFromCurrentLocation,
        currentInviteLocation,
        currentUserId,
        endpoint,
        isLocalUserVrcPlusSupporter
    };
}
