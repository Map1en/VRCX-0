import { useCallback, useEffect, useState, type SetStateAction } from 'react';

import friendLogHistoryRepository from '@/repositories/friendLogHistoryRepository';
import gameLogRepository from '@/repositories/gameLogRepository';
import userProfileRepository from '@/repositories/userProfileRepository';

import {
    cachePreviousInstances,
    cacheUserStats,
    DEFAULT_USER_STATS,
    readCachedPreviousInstances,
    readCachedUserStats,
    type UserDialogStats
} from './userDialogCache';
import {
    isSameLocationTag,
    resolvePresenceLocation
} from './userDialogContentHelpers';
import { normalizeUserId } from './userProfileFields';
import type { UserDialogProfileRecord } from './useUserDialogProfileResource';

type DialogRecord = Record<string, unknown>;
type SupplementalStats = UserDialogStats & { mutualFriendCount?: number };

function record(value: unknown): DialogRecord {
    return value && typeof value === 'object'
        ? Object.fromEntries(Object.entries(value))
        : {};
}

function normalizeMutualFriendCount(value: unknown) {
    const source = record(value);
    return (
        Number(
            source.friends ??
                source.friendCount ??
                source.mutualFriendCount ??
                source.mutualFriends
        ) || 0
    );
}

function resolveFriendedAtFromHistoryRows(rows: unknown) {
    const latestRelationshipRow = Array.isArray(rows)
        ? rows
              .map(record)
              .find((row) => row.type === 'Friend' || row.type === 'Unfriend')
        : null;
    return latestRelationshipRow?.type === 'Friend'
        ? normalizeUserId(latestRelationshipRow.created_at)
        : '';
}

type RepresentedGroupState = {
    endpoint: unknown;
    group: Awaited<
        ReturnType<
            typeof import('@/repositories/userProfileRepository').getRepresentedGroup
        >
    >;
    status: string;
    userId: unknown;
};

type UseUserDialogSupplementalDataInput = {
    activeUserTargetRef: {
        current: {
            endpoint?: string;
            userId?: string;
        };
    };
    currentEndpoint: string;
    currentGameDestination: unknown;
    currentGameLocation: unknown;
    currentSnapshotLocation: unknown;
    currentUserId: unknown;
    currentUserSnapshot: DialogRecord | null;
    isTargetCurrentUser: boolean;
    normalizedUserId: string;
    openNonce: unknown;
    profile: UserDialogProfileRecord | null;
    reloadToken: number;
    targetKey: string;
};

export function useUserDialogSupplementalData({
    activeUserTargetRef,
    currentEndpoint,
    currentGameDestination,
    currentGameLocation,
    currentSnapshotLocation,
    currentUserId,
    currentUserSnapshot,
    isTargetCurrentUser,
    normalizedUserId,
    openNonce,
    profile,
    reloadToken,
    targetKey
}: UseUserDialogSupplementalDataInput) {
    const [previousInstancesState, setPreviousInstancesState] = useState(
        () => ({
            targetKey,
            rows: readCachedPreviousInstances(targetKey)
        })
    );
    const [userStatsState, setUserStatsState] = useState<{
        targetKey: string;
        stats: SupplementalStats;
    }>(() => ({
        targetKey,
        stats: readCachedUserStats(targetKey)
    }));
    const [representedGroupState, setRepresentedGroupState] =
        useState<RepresentedGroupState>(() => ({
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
        (nextValue: SetStateAction<unknown[]>) => {
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
        (nextValue: SetStateAction<SupplementalStats>) => {
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
            .catch(() => {});

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
                                  displayName: normalizeUserId(displayName),
                                  updated_at: normalizeUserId(updated_at)
                              })
                          )
                        : Array.isArray(stats?.previousDisplayNames)
                          ? stats.previousDisplayNames
                          : [];
                const nextStats = {
                    timeSpent: Number(stats?.timeSpent) || 0,
                    lastSeen: normalizeUserId(stats?.lastSeen),
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
            .catch(() => {});

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
                userId: profile.id
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
            .catch(() => {});

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

    useEffect(() => {
        let active = true;
        const ownerUserId = normalizeUserId(
            currentUserId ||
                currentUserSnapshot?.id ||
                currentUserSnapshot?.userId ||
                currentUserSnapshot?.user_id
        );
        const targetUserId = normalizeUserId(profile?.id);

        if (!ownerUserId || !targetUserId || isTargetCurrentUser) {
            setUserStatsForTarget((current) => ({
                ...current,
                friendedAt: ''
            }));
            return () => {
                active = false;
            };
        }

        friendLogHistoryRepository
            .getFriendLogHistory(ownerUserId, {
                targetUserId,
                types: ['Friend', 'Unfriend']
            })
            .then((rows) => {
                if (!active) {
                    return;
                }
                const friendedAt = normalizeUserId(
                    resolveFriendedAtFromHistoryRows(rows)
                );
                setUserStatsForTarget((current) => ({
                    ...current,
                    friendedAt
                }));
            })
            .catch(() => {});

        return () => {
            active = false;
        };
    }, [
        currentUserId,
        currentUserSnapshot?.id,
        currentUserSnapshot?.userId,
        currentUserSnapshot?.user_id,
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
