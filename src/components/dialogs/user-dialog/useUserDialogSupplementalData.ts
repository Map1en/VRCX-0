import {
    useCallback,
    useEffect,
    useEffectEvent,
    useRef,
    useState,
    type SetStateAction
} from 'react';

import type { LoadStatus } from '@/domain/shared/types';
import friendLogHistoryRepository from '@/repositories/friendLogHistoryRepository';
import gameLogRepository from '@/repositories/gameLogRepository';
import userProfileRepository from '@/repositories/userProfileRepository';
import {
    cachePreviousInstances,
    cacheUserStats,
    DEFAULT_USER_STATS,
    normalizeUserRelationshipHistory,
    readCachedPreviousInstances,
    readCachedUserStats,
    type UserDialogPreviousInstance,
    type UserDialogStats
} from '@/services/userDialogSessionCacheService';

import {
    isSameLocationTag,
    resolvePresenceLocation
} from './userDialogContentHelpers';
import {
    mergePreviousDisplayNames,
    replacePreviousDisplayNameSource
} from './userDialogRows';
import { normalizeUserId } from './userProfileFields';
import type { UserDialogProfileRecord } from './useUserDialogProfileResource';

type DialogRecord = Record<string, unknown>;
type SupplementalStats = UserDialogStats & { mutualFriendCount?: number };

export const USER_DIALOG_INSTANCE_HISTORY_LIMIT = 50;

type RepresentedGroupState = {
    endpoint: string;
    group: Awaited<
        ReturnType<
            typeof import('@/repositories/userProfileRepository').default.getRepresentedGroup
        >
    >;
    status: LoadStatus;
    userId: string;
};

type UseUserDialogSupplementalDataInput = {
    activeUserTargetRef: {
        current: {
            endpoint?: string;
            userId?: string;
        };
    };
    currentEndpoint: string;
    currentGameDestination: string;
    currentGameLocation: string;
    currentSnapshotLocation: string;
    currentUserId: string | null;
    currentUserSnapshot: DialogRecord | null;
    isTargetCurrentUser: boolean;
    normalizedUserId: string;
    openNonce: number;
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
    const targetIsActive = useEffectEvent(
        (userId: string, endpoint: string) =>
            activeUserTargetRef.current.userId === userId &&
            activeUserTargetRef.current.endpoint === endpoint
    );
    const previousInstancesRequestRef = useRef(0);
    const [previousInstancesState, setPreviousInstancesState] = useState(
        () => ({
            targetKey,
            rows: readCachedPreviousInstances(targetKey),
            status: 'idle',
            error: ''
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
    const visiblePreviousInstancesStatus =
        previousInstancesState.targetKey === targetKey
            ? previousInstancesState.status
            : 'idle';
    const visiblePreviousInstancesError =
        previousInstancesState.targetKey === targetKey
            ? previousInstancesState.error
            : '';
    const visibleUserStats =
        userStatsState.targetKey === targetKey
            ? userStatsState.stats
            : DEFAULT_USER_STATS;
    const profileDisplayName = normalizeUserId(
        profile?.displayName || profile?.username
    );
    const profileId = profile?.id;
    const profilePresenceLocation = resolvePresenceLocation(profile);
    const profileDisplayNameRef = useRef('');
    profileDisplayNameRef.current = profileDisplayName;
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
        (nextValue: SetStateAction<UserDialogPreviousInstance[]>) => {
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
                    rows: normalizedRows,
                    status: 'ready',
                    error: ''
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
        setUserStatsForTarget((current) => {
            const sources = current.previousDisplayNameSources;
            return {
                ...current,
                previousDisplayNames: sources
                    ? mergePreviousDisplayNames(
                          profileDisplayName,
                          sources.friendLog,
                          sources.gameLog
                      )
                    : mergePreviousDisplayNames(
                          profileDisplayName,
                          current.previousDisplayNames
                      )
            };
        });
    }, [profileDisplayName, setUserStatsForTarget]);

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
                if (!active || !targetIsActive(targetUserId, targetEndpoint)) {
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
                if (!active || !targetIsActive(targetUserId, targetEndpoint)) {
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
        previousInstancesRequestRef.current += 1;
        setPreviousInstancesState({
            targetKey,
            rows: readCachedPreviousInstances(targetKey),
            status: 'idle',
            error: ''
        });
    }, [reloadToken, targetKey]);

    const loadPreviousInstances = useCallback(async () => {
        const targetUserId = normalizeUserId(profile?.id);
        if (!targetUserId) {
            return;
        }
        const targetEndpoint = currentEndpoint;
        const requestId = previousInstancesRequestRef.current + 1;
        previousInstancesRequestRef.current = requestId;
        setPreviousInstancesState((currentState) => ({
            targetKey,
            rows:
                currentState.targetKey === targetKey
                    ? currentState.rows
                    : readCachedPreviousInstances(targetKey),
            status: 'running',
            error: ''
        }));

        try {
            const rows = await gameLogRepository.getPreviousInstancesByUserId(
                { id: targetUserId },
                { limit: USER_DIALOG_INSTANCE_HISTORY_LIMIT }
            );
            if (
                previousInstancesRequestRef.current !== requestId ||
                activeUserTargetRef.current.userId !== targetUserId ||
                activeUserTargetRef.current.endpoint !== targetEndpoint
            ) {
                return;
            }
            const nextInstances = [...rows].reverse();
            cachePreviousInstances(targetKey, nextInstances);
            setPreviousInstancesState({
                targetKey,
                rows: nextInstances,
                status: 'ready',
                error: ''
            });
        } catch (error) {
            if (
                previousInstancesRequestRef.current !== requestId ||
                activeUserTargetRef.current.userId !== targetUserId ||
                activeUserTargetRef.current.endpoint !== targetEndpoint
            ) {
                return;
            }
            setPreviousInstancesState({
                targetKey,
                rows: [],
                status: 'error',
                error: error instanceof Error ? error.message : ''
            });
        }
    }, [activeUserTargetRef, currentEndpoint, profile?.id, targetKey]);

    useEffect(() => {
        let active = true;
        setUserStatsState({
            targetKey,
            stats: readCachedUserStats(targetKey)
        });

        if (!profileId) {
            return () => {
                active = false;
            };
        }

        const currentLocation =
            currentGameLocation === 'traveling'
                ? currentGameDestination
                : currentGameLocation ||
                  currentGameDestination ||
                  currentSnapshotLocation;
        const inCurrentWorld = Boolean(
            profilePresenceLocation &&
            currentLocation &&
            isSameLocationTag(profilePresenceLocation, currentLocation)
        );

        gameLogRepository
            .getUserStats(
                {
                    id: profileId,
                    displayName: profileDisplayNameRef.current
                },
                inCurrentWorld
            )
            .then((stats) => {
                if (!active) {
                    return;
                }
                const nextStats = {
                    timeSpent: Number(stats?.timeSpent) || 0,
                    lastSeen: normalizeUserId(stats?.lastSeen),
                    joinCount: Number(stats?.joinCount) || 0
                };
                setUserStatsForTarget((current) => {
                    const previousDisplayNames =
                        replacePreviousDisplayNameSource(
                            profileDisplayNameRef.current,
                            current.previousDisplayNameSources,
                            'gameLog',
                            stats?.previousDisplayNames
                        );
                    const mergedStats = {
                        ...current,
                        ...nextStats,
                        ...previousDisplayNames
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
        openNonce,
        profileId,
        profilePresenceLocation,
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
            setUserStatsForTarget((current) => {
                if (!isTargetCurrentUser) {
                    return {
                        ...current,
                        friendedAt: '',
                        relationshipHistory: []
                    };
                }
                return {
                    ...current,
                    friendedAt: '',
                    relationshipHistory: [],
                    ...replacePreviousDisplayNameSource(
                        profileDisplayNameRef.current,
                        current.previousDisplayNameSources,
                        'friendLog',
                        []
                    )
                };
            });
            return () => {
                active = false;
            };
        }

        friendLogHistoryRepository
            .getFriendLogHistory(ownerUserId, {
                targetUserId,
                types: ['Friend', 'Unfriend', 'DisplayName']
            })
            .then((rows) => {
                if (!active) {
                    return;
                }
                const relationshipHistory =
                    normalizeUserRelationshipHistory(rows);
                const latestRelationship = relationshipHistory[0];
                const friendedAt =
                    latestRelationship?.type === 'Friend'
                        ? latestRelationship.created_at
                        : '';
                const friendLogPreviousDisplayNames = rows
                    .filter((row) => row.type === 'DisplayName')
                    .map((row) => ({
                        displayName: row.previousDisplayName,
                        updated_at: row.created_at
                    }));
                setUserStatsForTarget((current) => ({
                    ...current,
                    friendedAt,
                    relationshipHistory,
                    ...replacePreviousDisplayNameSource(
                        profileDisplayNameRef.current,
                        current.previousDisplayNameSources,
                        'friendLog',
                        friendLogPreviousDisplayNames
                    )
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
        previousInstancesError: visiblePreviousInstancesError,
        previousInstancesStatus: visiblePreviousInstancesStatus,
        loadPreviousInstances,
        representedGroup: visibleRepresentedGroup,
        representedGroupStatus: visibleRepresentedGroupStatus,
        setPreviousInstances,
        userStats: visibleUserStats
    };
}
