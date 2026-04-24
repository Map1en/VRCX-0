import { useEffect, useState } from 'react';

import { gameLogRepository, userProfileRepository } from '@/repositories/index.js';

import {
    isSameLocationTag,
    resolvePresenceLocation
} from './userDialogContentHelpers.js';
import {
    cachePreviousInstances,
    cacheUserStats,
    readCachedPreviousInstances,
    readCachedUserStats
} from './userDialogCache.js';

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
    const [previousInstances, setPreviousInstances] = useState(() =>
        readCachedPreviousInstances(targetKey)
    );
    const [userStats, setUserStats] = useState(() =>
        readCachedUserStats(targetKey)
    );
    const [representedGroup, setRepresentedGroup] = useState(null);
    const [representedGroupStatus, setRepresentedGroupStatus] =
        useState('idle');

    useEffect(() => {
        let active = true;

        if (!normalizedUserId) {
            setRepresentedGroup(null);
            setRepresentedGroupStatus('idle');
            return () => {
                active = false;
            };
        }

        const targetUserId = normalizedUserId;
        const targetEndpoint = currentEndpoint;
        setRepresentedGroup(null);
        setRepresentedGroupStatus('running');

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
                setRepresentedGroup(group);
                setRepresentedGroupStatus('ready');
            })
            .catch(() => {
                if (
                    !active ||
                    activeUserTargetRef.current.userId !== targetUserId ||
                    activeUserTargetRef.current.endpoint !== targetEndpoint
                ) {
                    return;
                }
                setRepresentedGroup(null);
                setRepresentedGroupStatus('error');
            });

        return () => {
            active = false;
        };
    }, [currentEndpoint, normalizedUserId, reloadToken]);

    useEffect(() => {
        let active = true;
        setPreviousInstances(readCachedPreviousInstances(targetKey));

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
                setPreviousInstances(nextInstances);
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
        setUserStats(readCachedUserStats(targetKey));

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
                setUserStats((current) => {
                    const mergedStats = {
                        ...current,
                        ...nextStats
                    };
                    cacheUserStats(targetKey, mergedStats);
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
                setUserStats((current) => {
                    const nextStats = {
                        ...current,
                        mutualFriendCount
                    };
                    cacheUserStats(targetKey, nextStats);
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
        targetKey
    ]);

    return {
        previousInstances,
        representedGroup,
        representedGroupStatus,
        setPreviousInstances,
        userStats
    };
}
