// @ts-nocheck
import { useEffect, useMemo, useRef, useState } from 'react';

import { userProfileRepository } from '@/repositories/index.js';
import {
    buildCurrentUserPresenceView,
    mergeCurrentUserPresenceFields
} from '@/shared/utils/currentUserPresence.js';

import { normalizeUserId } from './userProfileFields.js';

function resolveProfileUserId(profile) {
    return normalizeUserId(
        profile?.id ||
            profile?.userId ||
            profile?.user_id ||
            profile?.targetUserId ||
            profile?.target_user_id
    );
}

const SNAPSHOT_DEFAULT_FIELDS = [
    '$location',
    '$location_at',
    '$online_for',
    '$travelingToTime',
    '$active_for'
];

function hasOwnField(source, field) {
    return Object.prototype.hasOwnProperty.call(source, field);
}

function stripSyntheticSnapshotDefaults(profile, snapshot) {
    if (!profile || !snapshot || typeof snapshot !== 'object') {
        return profile;
    }

    let nextProfile = profile;
    for (const field of SNAPSHOT_DEFAULT_FIELDS) {
        if (!hasOwnField(snapshot, field) && hasOwnField(nextProfile, field)) {
            if (nextProfile === profile) {
                nextProfile = { ...profile };
            }
            delete nextProfile[field];
        }
    }
    return nextProfile;
}

function valuesEqual(left, right) {
    if (left === right) {
        return true;
    }
    if (
        left &&
        right &&
        typeof left === 'object' &&
        typeof right === 'object'
    ) {
        return JSON.stringify(left) === JSON.stringify(right);
    }
    return false;
}

function profilesEqual(left, right) {
    if (left === right) {
        return true;
    }
    if (
        !left ||
        !right ||
        typeof left !== 'object' ||
        typeof right !== 'object'
    ) {
        return false;
    }

    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    for (const key of keys) {
        if (!valuesEqual(left[key], right[key])) {
            return false;
        }
    }
    return true;
}

function preserveProfileIdentity(currentProfile, nextProfile, targetUserId) {
    const currentTargetProfile = previousTargetProfile(
        currentProfile,
        targetUserId
    );
    return currentTargetProfile &&
        profilesEqual(currentTargetProfile, nextProfile)
        ? currentProfile
        : nextProfile;
}

function mergeSnapshotIntoCurrentProfile({
    currentProfile,
    isTargetCurrentUser,
    snapshot,
    targetUserId
}) {
    const previousProfile = previousTargetProfile(currentProfile, targetUserId);
    const nextProfile =
        isTargetCurrentUser && snapshot
            ? mergeCurrentUserPresenceFields(snapshot, previousProfile)
            : mergeLocalSnapshotIntoProfile(snapshot, previousProfile);
    return preserveProfileIdentity(currentProfile, nextProfile, targetUserId);
}

function normalizeTargetSnapshot(
    snapshot,
    targetUserId,
    { allowMissingId = true } = {}
) {
    if (!snapshot) {
        return null;
    }

    const nextProfile = stripSyntheticSnapshotDefaults(
        userProfileRepository.normalize(snapshot),
        snapshot
    );
    const snapshotUserId = resolveProfileUserId(nextProfile);
    if (snapshotUserId && snapshotUserId !== targetUserId) {
        return null;
    }
    if (!snapshotUserId && targetUserId && allowMissingId) {
        return {
            ...nextProfile,
            id: targetUserId
        };
    }
    return nextProfile;
}

function profileMatchesTarget(profile, targetUserId) {
    return Boolean(
        profile &&
        targetUserId &&
        resolveProfileUserId(profile) === targetUserId
    );
}

function previousTargetProfile(profile, targetUserId) {
    return profileMatchesTarget(profile, targetUserId) ? profile : null;
}

const LOCAL_SNAPSHOT_REFRESH_FIELDS = [
    'status',
    'statusDescription',
    'state',
    'stateBucket',
    'location',
    '$location',
    '$location_at',
    'locationAt',
    'locationUpdatedAt',
    'worldId',
    'instanceId',
    'travelingToLocation',
    'travelingToWorld',
    'travelingToInstance',
    '$travelingToLocation',
    '$travelingToTime'
];

function hasRefreshValue(value) {
    return value !== undefined && value !== null && value !== '';
}

export function mergeLocalSnapshotIntoProfile(localSnapshot, profile) {
    if (!localSnapshot) {
        return profile || null;
    }
    if (!profile || typeof profile !== 'object') {
        return localSnapshot;
    }

    const localUserId = resolveProfileUserId(localSnapshot);
    const profileUserId = resolveProfileUserId(profile);
    if (localUserId && profileUserId && localUserId !== profileUserId) {
        return localSnapshot;
    }

    const merged = { ...localSnapshot, ...profile };
    for (const field of LOCAL_SNAPSHOT_REFRESH_FIELDS) {
        if (hasRefreshValue(localSnapshot[field])) {
            merged[field] = localSnapshot[field];
        }
    }
    return profilesEqual(merged, profile) ? profile : merged;
}

export function mergeUserDialogLocalSnapshot({
    friendSnapshot = null,
    seedData = null,
    knownTargetUser = null
} = {}) {
    const baseSnapshot = seedData || knownTargetUser || null;
    if (friendSnapshot && baseSnapshot) {
        return mergeLocalSnapshotIntoProfile(friendSnapshot, baseSnapshot);
    }
    return friendSnapshot || baseSnapshot;
}

export function useUserDialogProfileResource({
    currentEndpoint,
    currentUserSnapshot,
    gameLogDisabled,
    gameState,
    isTargetCurrentUser,
    localSnapshot,
    normalizedUserId,
    updateEntityDialogMetadata
}) {
    const normalizedLocalSnapshot = useMemo(
        () => normalizeTargetSnapshot(localSnapshot, normalizedUserId),
        [localSnapshot, normalizedUserId]
    );
    const currentUserPresenceSnapshot = useMemo(
        () =>
            normalizeTargetSnapshot(currentUserSnapshot, normalizedUserId, {
                allowMissingId: false
            }),
        [currentUserSnapshot, normalizedUserId]
    );
    const localSnapshotRef = useRef(normalizedLocalSnapshot);
    localSnapshotRef.current = normalizedLocalSnapshot;
    const [baseProfile, setBaseProfile] = useState(
        () => normalizedLocalSnapshot
    );
    const activeBaseProfile = useMemo(
        () =>
            profileMatchesTarget(baseProfile, normalizedUserId)
                ? baseProfile
                : normalizedLocalSnapshot,
        [baseProfile, normalizedLocalSnapshot, normalizedUserId]
    );
    const profile = useMemo(
        () =>
            isTargetCurrentUser
                ? buildCurrentUserPresenceView(activeBaseProfile, {
                      currentUserSnapshot: currentUserPresenceSnapshot,
                      gameState,
                      gameLogDisabled
                  })
                : activeBaseProfile,
        [
            activeBaseProfile,
            currentUserPresenceSnapshot,
            gameState?.currentDestination,
            gameState?.currentLocation,
            gameState?.currentWorldId,
            gameState?.isGameRunning,
            gameLogDisabled,
            isTargetCurrentUser
        ]
    );
    const [loadStatus, setLoadStatus] = useState(
        normalizedUserId ? 'running' : 'idle'
    );
    const [reloadToken, setReloadToken] = useState(0);
    const [detail, setDetail] = useState('');
    const activeUserTargetRef = useRef({
        userId: normalizedUserId,
        endpoint: currentEndpoint
    });
    activeUserTargetRef.current.userId = normalizedUserId;
    activeUserTargetRef.current.endpoint = currentEndpoint;

    const effectiveLoadStatus =
        normalizedUserId && !profile && loadStatus !== 'error'
            ? 'running'
            : loadStatus;

    useEffect(() => {
        if (normalizedLocalSnapshot) {
            setBaseProfile((currentProfile) =>
                mergeSnapshotIntoCurrentProfile({
                    currentProfile,
                    isTargetCurrentUser,
                    snapshot: normalizedLocalSnapshot,
                    targetUserId: normalizedUserId
                })
            );
        } else if (!normalizedUserId) {
            setBaseProfile(null);
        }
    }, [isTargetCurrentUser, normalizedLocalSnapshot, normalizedUserId]);

    useEffect(() => {
        const title = normalizeUserId(
            profile?.displayName || profile?.username
        );
        if (!profile?.id || !title) {
            return;
        }
        updateEntityDialogMetadata({
            kind: 'user',
            entityId: profile.id,
            title
        });
    }, [
        profile?.displayName,
        profile?.id,
        profile?.username,
        updateEntityDialogMetadata
    ]);

    useEffect(() => {
        let active = true;

        if (!normalizedUserId) {
            setBaseProfile(null);
            setLoadStatus('error');
            setDetail('No user id was provided for this dialog.');
            return () => {
                active = false;
            };
        }

        const snapshot = localSnapshotRef.current;
        setBaseProfile((currentProfile) =>
            mergeSnapshotIntoCurrentProfile({
                currentProfile,
                isTargetCurrentUser,
                snapshot,
                targetUserId: normalizedUserId
            })
        );
        setLoadStatus('running');
        setDetail('');

        userProfileRepository
            .getUserProfile({
                userId: normalizedUserId,
                endpoint: currentEndpoint,
                force: reloadToken > 0,
                dialog: true
            })
            .then((nextProfile) => {
                if (!active) {
                    return;
                }

                setBaseProfile((currentProfile) =>
                    preserveProfileIdentity(
                        currentProfile,
                        isTargetCurrentUser
                            ? mergeCurrentUserPresenceFields(
                                  nextProfile,
                                  previousTargetProfile(
                                      currentProfile,
                                      normalizedUserId
                                  )
                              )
                            : mergeLocalSnapshotIntoProfile(
                                  localSnapshotRef.current,
                                  nextProfile
                              ),
                        normalizedUserId
                    )
                );
                setLoadStatus('ready');
            })
            .catch((error) => {
                if (!active) {
                    return;
                }

                const fallbackSnapshot = localSnapshotRef.current;
                if (fallbackSnapshot) {
                    setBaseProfile((currentProfile) =>
                        mergeSnapshotIntoCurrentProfile({
                            currentProfile,
                            isTargetCurrentUser,
                            snapshot: fallbackSnapshot,
                            targetUserId: normalizedUserId
                        })
                    );
                    setLoadStatus('ready');
                    setDetail(
                        error instanceof Error
                            ? error.message
                            : 'Failed to refresh the remote user snapshot.'
                    );
                    return;
                }

                setBaseProfile(null);
                setLoadStatus('error');
                setDetail(
                    error instanceof Error
                        ? error.message
                        : 'Failed to load the user profile.'
                );
            });

        return () => {
            active = false;
        };
    }, [currentEndpoint, isTargetCurrentUser, normalizedUserId, reloadToken]);

    function refreshProfile() {
        setReloadToken((value) => value + 1);
    }

    return {
        activeUserTargetRef,
        baseProfile: activeBaseProfile,
        detail,
        loadStatus: effectiveLoadStatus,
        profile,
        refreshProfile,
        reloadToken,
        setBaseProfile
    };
}
