import { useEffect, useMemo } from 'react';

import { instancePresenceKey } from '@/domain/presence/instancePresence';
import playerListPersistenceRepository from '@/repositories/playerListPersistenceRepository';
import { recordGameRuntimePresence } from '@/services/domainIngestionService';
import {
    normalizeLocationValue,
    parseLocation,
    resolveFriendPresenceLocation
} from '@/shared/utils/location';
import { useInstancePresenceStore } from '@/state/instancePresenceStore';
import { useRuntimeStore } from '@/state/runtimeStore';

const currentInstanceRecoveryRequests = new Map<string, Promise<void>>();
const recoveredCurrentInstanceScopes = new Set<string>();

function useCurrentInstancePresence() {
    const endpoint = useRuntimeStore((state) => state.auth.currentUserEndpoint);
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const currentUserSnapshot = useRuntimeStore(
        (state) => state.auth.currentUserSnapshot
    );
    const runtimeCurrentLocation = useRuntimeStore(
        (state) => state.gameState.currentLocation
    );
    const currentLocationStartedAt = useRuntimeStore(
        (state) => state.gameState.currentLocationStartedAt
    );
    const isGameRunning = useRuntimeStore(
        (state) => state.gameState.isGameRunning
    );
    const currentLocation = useMemo(() => {
        const runtimeLocation = normalizeLocationValue(runtimeCurrentLocation);
        if (parseLocation(runtimeLocation).isRealInstance) {
            return runtimeLocation;
        }
        return resolveFriendPresenceLocation(currentUserSnapshot, {
            requireInstance: true
        });
    }, [currentUserSnapshot, runtimeCurrentLocation]);
    const key = useMemo(
        () => instancePresenceKey(endpoint, currentLocation),
        [currentLocation, endpoint]
    );
    const presence = useInstancePresenceStore((state) =>
        key ? state.presenceByKey[key] || null : null
    );

    useEffect(() => {
        if (!isGameRunning) {
            recoveredCurrentInstanceScopes.clear();
            return;
        }
        if (!currentUserId || presence?.userIds.length) {
            return;
        }

        const scope = [
            currentUserId,
            key || 'latest',
            normalizeLocationValue(currentLocationStartedAt)
        ].join('::');
        if (
            recoveredCurrentInstanceScopes.has(scope) ||
            currentInstanceRecoveryRequests.has(scope)
        ) {
            return;
        }

        const request = playerListPersistenceRepository
            .getCurrentInstanceSnapshot({
                currentUserId,
                currentLocation,
                currentLocationStartedAt
            })
            .then((snapshot) => {
                const snapshotLocation = normalizeLocationValue(
                    snapshot.context.location || currentLocation
                );
                const snapshotKey = instancePresenceKey(
                    endpoint,
                    snapshotLocation
                );
                if (!snapshotKey || (key && snapshotKey !== key)) {
                    return;
                }

                const snapshotStartedAt =
                    snapshot.context.createdAt ||
                    currentLocationStartedAt ||
                    '';
                const snapshotPlayerIds = snapshot.players
                    .map((player) => player.userId.trim())
                    .filter(Boolean);
                const runtimeStore = useRuntimeStore.getState();
                if (
                    runtimeStore.gameState.isGameRunning &&
                    !runtimeStore.gameState.currentLocationPlayerIds.length
                ) {
                    const parsedLocation = parseLocation(snapshotLocation);
                    runtimeStore.setGameState({
                        currentLocation: snapshotLocation,
                        currentLocationStartedAt: snapshotStartedAt || null,
                        currentLocationPlayerIds: snapshotPlayerIds,
                        currentLocationPlayers: snapshot.players,
                        currentWorldId: parsedLocation.worldId,
                        currentWorldName: snapshot.context.worldName
                    });
                }
                recordGameRuntimePresence({
                    endpoint,
                    currentUserId,
                    currentUserSnapshot,
                    currentLocation: snapshotLocation,
                    currentLocationStartedAt: snapshotStartedAt,
                    currentLocationPlayers: snapshot.players,
                    currentWorldName: snapshot.context.worldName
                });
                recoveredCurrentInstanceScopes.add(scope);
                recoveredCurrentInstanceScopes.add(
                    [
                        currentUserId,
                        snapshotKey,
                        normalizeLocationValue(snapshotStartedAt)
                    ].join('::')
                );
            })
            .catch((error: unknown) => {
                console.warn(
                    'Failed to restore current instance presence:',
                    error
                );
            })
            .finally(() => {
                currentInstanceRecoveryRequests.delete(scope);
            });
        currentInstanceRecoveryRequests.set(scope, request);
    }, [
        currentLocation,
        currentLocationStartedAt,
        currentUserId,
        currentUserSnapshot,
        endpoint,
        isGameRunning,
        key,
        presence?.userIds.length
    ]);

    return presence;
}

export { useCurrentInstancePresence };
