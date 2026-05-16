// @ts-nocheck
import { useCallback, useEffect, useState } from 'react';

import {
    gameLogRepository,
    userProfileRepository
} from '@/repositories/index.js';

import {
    cachePreviousInstances,
    cacheUserStats,
    DEFAULT_USER_STATS,
    readCachedPreviousInstances,
    readCachedUserStats
} from './userDialogCache.js';
import {
    isSameLocationTag,
    resolvePresenceLocation
} from './userDialogContentHelpers.js';

function normalizeMutualFriendCount(value) {
    const source = value && typeof value === 'object' ? value : {};
    return (
        Number(
            source.friends ??
                source.friendCount ??
                source.mutualFriendCount ??
                source.mutualFriends
        ) || 0
    );
}

export function useUserDialogSupplementalData({
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
}) {
    const [previousInstancesState, setPreviousInstancesState] = useState(
        () => ({
            targetKey,
            rows: readCachedPreviousInstances(targetKey)
        })
    );
    const [userStatsState, setUserStatsState] = useState(() => ({
        targetKey,
        stats: readCachedUserStats(targetKey)
    }));
    const [representedGroupState, setRepresentedGroupState] = useState(() => ({
        endpoint: currentEndpoint,
        group: null,
        status: normalizedUserId ? 'running' : 'idle',
        userId: normalizedUserId
    }));
    const visiblePreviousInstances =
        previousInstancesState.targetKey === targetKey
            ? previousInstancesState.rows
            : [];
    const visibleUserStats =
        userStatsState.targetKey === targetKey
            ? userStatsState.stats
            : DEFAULT_USER_STATS;
    const representedGroupMatchesTarget =
        representedGroupState.userId === normalizedUserId &&
        representedGroupState.endpoint === currentEndpoint;
    const visibleRepresentedGroup = representedGroupMatchesTarget
        ? representedGroupState.group
        : null;
    const visibleRepresentedGroupStatus = representedGroupMatchesTarget
        ? representedGroupState.status
        : normalizedUserId
          ? 'running'
          : 'idle';

    const setPreviousInstances = useCallback(
        (nextValue) => {
            setPreviousInstancesState((currentState) => {
                const currentRows =
                    currentState.targetKey === targetKey
                        ? currentState.rows
                        : [];
                const nextRows =
                    typeof nextValue === 'function'
                        ? nextValue(currentRows)
                        : nextValue;
                const normalizedRows = Array.isArray(nextRows) ? nextRows : [];
                cachePreviousInstances(targetKey, normalizedRows);
                return {
                    targetKey,
                    rows: normalizedRows
                };
            });
        },
        [targetKey]
    );

    const setUserStatsForTarget = useCallback(
        (nextValue) => {
            setUserStatsState((currentState) => {
                const currentStats =
                    currentState.targetKey === targetKey
                        ? currentState.stats
                        : readCachedUserStats(targetKey);
                const nextStats =
                    typeof nextValue === 'function'
                        ? nextValue(currentStats)
                        : nextValue;
                const normalizedStats = nextStats || DEFAULT_USER_STATS;
                cacheUserStats(targetKey, normalizedStats);
                return {
                    targetKey,
                    stats: normalizedStats
                };
            });
        },
        [targetKey]
    );

    useEffect(() => {
        let active = true;

        if (!normalizedUserId) {
            setRepresentedGroupState({
                endpoint: currentEndpoint,
                group: null,
                status: 'idle',
                userId: ''
            });
            return () => {
                active = false;
            };
        }

        const targetUserId = normalizedUserId;
        const targetEndpoint = currentEndpoint;
        setRepresentedGroupState({
            endpoint: targetEndpoint,
            group: null,
            status: 'running',
            userId: targetUserId
        });

        userProfileRepository
            .getRepresentedGroup({
                userId: targetUserId,
                endpoint: targetEndpoint,
                force: reloadToken > 0
            })
            .then((group) => {
                if (
                    !active ||
                    activeUserTargetRef.current.userId !== targetUserId ||
                    activeUserTargetRef.current.endpoint !== targetEndpoint
                ) {
                    return;
                }
                setRepresentedGroupState({
                    endpoint: targetEndpoint,
                    group,
                    status: 'ready',
                    userId: targetUserId
                });
            })
            .catch(() => {
                if (
                    !active ||
                    activeUserTargetRef.current.userId !== targetUserId ||
                    activeUserTargetRef.current.endpoint !== targetEndpoint
                ) {
                    return;
                }
                setRepresentedGroupState({
                    endpoint: targetEndpoint,
                    group: null,
                    status: 'error',
                    userId: targetUserId
                });
            });

        return () => {
            active = false;
        };
    }, [currentEndpoint, normalizedUserId, reloadToken]);

    useEffect(() => {
        let active = true;
        setPreviousInstancesState({
            targetKey,
            rows: readCachedPreviousInstances(targetKey)
        });

        if (!profile?.id) {
            return () => {
                active = false;
            };
        }

        gameLogRepository
            .getPreviousInstancesByUserId({
                id: profile.id
            })
            .then((rows) => {
                if (!active) {
                    return;
                }
                const values =
                    rows instanceof Set ? Array.from(rows.values()) : [];
                const nextInstances = values.reverse();
                cachePreviousInstances(targetKey, nextInstances);
                setPreviousInstancesState({
                    targetKey,
                    rows: nextInstances
                });
            })
            .catch(() => {
                // Keep the last visible rows while a refresh fails.
            });

        return () => {
            active = false;
        };
    }, [
        openNonce,
        profile?.displayName,
        profile?.id,
        profile?.username,
        reloadToken,
        targetKey
    ]);

    useEffect(() => {
        let active = true;
        setUserStatsState({
            targetKey,
            stats: readCachedUserStats(targetKey)
        });

        if (!profile?.id) {
            return () => {
                active = false;
            };
        }

        const activeLocation = resolvePresenceLocation(profile);
        const currentLocation =
            currentGameLocation === 'traveling'
                ? currentGameDestination
                : currentGameLocation ||
                  currentGameDestination ||
                  currentSnapshotLocation;
        const inCurrentWorld = Boolean(
            activeLocation &&
            currentLocation &&
            isSameLocationTag(activeLocation, currentLocation)
        );

        gameLogRepository
            .getUserStats(
                {
                    id: profile.id,
                    displayName: profile.displayName || profile.username || ''
                },
                inCurrentWorld
            )
            .then((stats) => {
                if (!active) {
                    return;
                }
                const previousDisplayNames =
                    stats?.previousDisplayNames instanceof Map
                        ? Array.from(
                              stats.previousDisplayNames,
                              ([displayName, updated_at]) => ({
                                  displayName,
                                  updated_at
                              })
                          )
                        : Array.isArray(stats?.previousDisplayNames)
                          ? stats.previousDisplayNames
                          : [];
                const nextStats = {
                    timeSpent: Number(stats?.timeSpent) || 0,
                    lastSeen: stats?.lastSeen || '',
                    joinCount: Number(stats?.joinCount) || 0,
                    previousDisplayNames
                };
                setUserStatsForTarget((current) => {
                    const mergedStats = {
                        ...current,
                        ...nextStats
                    };
                    return mergedStats;
                });
            })
            .catch(() => {
                // Keep the last visible stats while a refresh fails.
            });

        return () => {
            active = false;
        };
    }, [
        currentGameDestination,
        currentGameLocation,
        currentSnapshotLocation,
        profile?.displayName,
        profile?.id,
        profile?.location,
        profile?.travelingToLocation,
        profile?.username,
        openNonce,
        reloadToken,
        setUserStatsForTarget,
        targetKey
    ]);

    useEffect(() => {
        let active = true;

        if (
            !profile?.id ||
            isTargetCurrentUser ||
            currentUserSnapshot?.hasSharedConnectionsOptOut
        ) {
            return () => {
                active = false;
            };
        }

        userProfileRepository
            .getMutualCounts({
                userId: profile.id,
                endpoint: currentEndpoint
            })
            .then((counts) => {
                if (!active) {
                    return;
                }
                const mutualFriendCount = normalizeMutualFriendCount(counts);
                setUserStatsForTarget((current) => {
                    const nextStats = {
                        ...current,
                        mutualFriendCount
                    };
                    return nextStats;
                });
            })
            .catch(() => {
                // Keep cached stats while mutual count refresh fails.
            });

        return () => {
            active = false;
        };
    }, [
        currentEndpoint,
        currentUserSnapshot?.hasSharedConnectionsOptOut,
        isTargetCurrentUser,
        profile?.id,
        reloadToken,
        setUserStatsForTarget,
        targetKey
    ]);

    return {
        previousInstances: visiblePreviousInstances,
        representedGroup: visibleRepresentedGroup,
        representedGroupStatus: visibleRepresentedGroupStatus,
        setPreviousInstances,
        userStats: visibleUserStats
    };
}
