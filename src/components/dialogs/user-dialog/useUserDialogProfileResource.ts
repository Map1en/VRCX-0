import { useEffect, useMemo, useRef, useState } from 'react';

import avatarProfileRepository from '@/repositories/avatarProfileRepository';
import myAvatarRepository from '@/repositories/myAvatarRepository';
import userProfileRepository from '@/repositories/userProfileRepository';
import {
    buildCurrentUserPresenceView,
    mergeCurrentUserPresenceFields
} from '@/shared/utils/currentUserPresence';

import { normalizeUserId } from './userProfileFields';

function resolveProfileUserId(profile: any) {
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

function hasOwnField(source: any, field: any) {
    return Object.prototype.hasOwnProperty.call(source, field);
}

function stripSyntheticSnapshotDefaults(profile: any, snapshot: any) {
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

function valuesEqual(left: any, right: any) {
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

function profilesEqual(left: any, right: any) {
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

function preserveProfileIdentity(currentProfile: any, nextProfile: any, targetUserId: any) {
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
}: any) {
    const previousProfile = previousTargetProfile(currentProfile, targetUserId);
    const nextProfile =
        isTargetCurrentUser && snapshot
            ? mergeCurrentUserPresenceFields(snapshot, previousProfile)
            : mergeLocalSnapshotIntoProfile(snapshot, previousProfile);
    return preserveProfileIdentity(currentProfile, nextProfile, targetUserId);
}

function normalizeTargetSnapshot(
    snapshot: any,
    targetUserId: any,
    { allowMissingId = true }: any = {}
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

function profileMatchesTarget(profile: any, targetUserId: any) {
    return Boolean(
        profile &&
        targetUserId &&
        resolveProfileUserId(profile) === targetUserId
    );
}

function previousTargetProfile(profile: any, targetUserId: any) {
    return profileMatchesTarget(profile, targetUserId) ? profile : null;
}

const ACTIVITY_TIMESTAMP_FIELDS = ['last_activity', 'last_login'];

function mergeActivityTimestampsIntoProfile(profile: any, snapshot: any) {
    if (!profile || !snapshot || typeof snapshot !== 'object') {
        return profile;
    }

    const profileUserId = resolveProfileUserId(profile);
    const snapshotUserId = resolveProfileUserId(snapshot);
    if (profileUserId && snapshotUserId && profileUserId !== snapshotUserId) {
        return profile;
    }

    let nextProfile = profile;
    for (const field of ACTIVITY_TIMESTAMP_FIELDS) {
        if (!hasRefreshValue(snapshot[field])) {
            continue;
        }
        if (nextProfile === profile) {
            nextProfile = { ...profile };
        }
        nextProfile[field] = snapshot[field];
    }
    return nextProfile;
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

const ID_ONLY_SEED_FIELDS = new Set([
    'id',
    'userId',
    'user_id',
    'targetUserId',
    'target_user_id',
    'displayName',
    'display_name',
    'username',
    'name',
    'subtitle',
    '$subtitle',
    ...LOCAL_SNAPSHOT_REFRESH_FIELDS
]);

function hasRefreshValue(value: any) {
    return value !== undefined && value !== null && value !== '';
}

function normalizedAvatarName(value: any) {
    return typeof value === 'string' ? value.trim() : '';
}

function isUnknownAvatarName(value: any) {
    const name = normalizedAvatarName(value).toLowerCase();
    return !name || name === '-' || name === 'unknown' || name === 'unknown avatar';
}

function shouldHydrateCurrentAvatar(profile: any) {
    return Boolean(
        normalizeUserId(profile?.currentAvatar) &&
            (isUnknownAvatarName(
                profile?.currentAvatarName || profile?.avatarName
            ) ||
                (!hasRefreshValue(profile?.currentAvatarImageUrl) &&
                    !hasRefreshValue(profile?.currentAvatarThumbnailImageUrl)))
    );
}

function mergeCurrentAvatarProfile(profile: any, avatar: any) {
    if (!profile || !avatar || typeof avatar !== 'object') {
        return profile;
    }

    const avatarId = normalizeUserId(avatar.id);
    const currentAvatar = normalizeUserId(profile.currentAvatar) || avatarId;
    if (!currentAvatar || !avatarId || currentAvatar !== avatarId) {
        return profile;
    }

    let nextProfile = normalizeUserId(profile.currentAvatar)
        ? profile
        : { ...profile, currentAvatar: avatarId };
    const profileAvatarNameUnknown = isUnknownAvatarName(
        profile.currentAvatarName || profile.avatarName
    );
    const avatarName = normalizedAvatarName(avatar.name);
    if (avatarName && profileAvatarNameUnknown) {
        nextProfile = { ...nextProfile, currentAvatarName: avatarName };
    }

    const thumbnailImageUrl =
        normalizedAvatarName(avatar.thumbnailImageUrl) ||
        normalizedAvatarName(avatar.imageUrl);
    if (
        thumbnailImageUrl &&
        (profileAvatarNameUnknown ||
            !hasRefreshValue(nextProfile.currentAvatarThumbnailImageUrl))
    ) {
        nextProfile = {
            ...nextProfile,
            currentAvatarThumbnailImageUrl: thumbnailImageUrl
        };
    }

    const imageUrl =
        normalizedAvatarName(avatar.imageUrl) ||
        normalizedAvatarName(avatar.thumbnailImageUrl);
    if (
        imageUrl &&
        (profileAvatarNameUnknown ||
            !hasRefreshValue(nextProfile.currentAvatarImageUrl))
    ) {
        nextProfile = { ...nextProfile, currentAvatarImageUrl: imageUrl };
    }

    return nextProfile;
}

function mergeCurrentUserAvatarFields(profile: any, previousProfile: any) {
    if (!previousProfile || !profile || typeof profile !== 'object') {
        return profile;
    }
    const previousAvatarId = normalizeUserId(previousProfile.currentAvatar);
    const nextProfile =
        previousAvatarId && !normalizeUserId(profile.currentAvatar)
            ? { ...profile, currentAvatar: previousAvatarId }
            : profile;
    return mergeCurrentAvatarProfile(nextProfile, {
        id: previousProfile.currentAvatar,
        name: previousProfile.currentAvatarName || previousProfile.avatarName,
        imageUrl: previousProfile.currentAvatarImageUrl,
        thumbnailImageUrl: previousProfile.currentAvatarThumbnailImageUrl
    });
}

function hasUsefulAvatarDetails(avatar: any) {
    if (!avatar || typeof avatar !== 'object') {
        return false;
    }
    return Boolean(
        !isUnknownAvatarName(avatar.name) ||
            hasRefreshValue(avatar.imageUrl) ||
            hasRefreshValue(avatar.thumbnailImageUrl)
    );
}

function hasUsefulAvatarName(avatar: any) {
    return Boolean(
        avatar && typeof avatar === 'object' && !isUnknownAvatarName(avatar.name)
    );
}

async function getCurrentAvatarDetails({
    avatarId,
    currentUserId,
    endpoint,
    profile
}: any) {
    let avatarProfile = null;
    try {
        avatarProfile = await avatarProfileRepository.getAvatarProfile({
            avatarId,
            endpoint,
            force: true,
            dialog: true,
            allowLocalFallback: true,
            currentUserId
        });
    } catch {
        avatarProfile = null;
    }

    if (hasUsefulAvatarName(avatarProfile)) {
        return avatarProfile;
    }

    let myAvatar = null;
    try {
        myAvatar = await myAvatarRepository.getMyAvatarById({
            avatarId,
            endpoint
        });
    } catch {
        myAvatar = null;
    }
    if (hasUsefulAvatarName(myAvatar)) {
        return myAvatar;
    }

    const imageUrl =
        normalizedAvatarName(profile?.currentAvatarImageUrl) ||
        normalizedAvatarName(profile?.currentAvatarThumbnailImageUrl) ||
        normalizedAvatarName(avatarProfile?.imageUrl) ||
        normalizedAvatarName(avatarProfile?.thumbnailImageUrl) ||
        normalizedAvatarName(myAvatar?.imageUrl) ||
        normalizedAvatarName(myAvatar?.thumbnailImageUrl);
    if (imageUrl) {
        const imageAvatarInfo =
            await avatarProfileRepository.getAvatarNameFromImageUrl(imageUrl, {
                endpoint
            });
        const imageAvatarName = normalizedAvatarName(
            imageAvatarInfo?.avatarName
        );
        if (!isUnknownAvatarName(imageAvatarName)) {
            return {
                ...(avatarProfile || myAvatar || {}),
                id: avatarId,
                name: imageAvatarName,
                imageUrl:
                    normalizedAvatarName(profile?.currentAvatarImageUrl) ||
                    normalizedAvatarName(avatarProfile?.imageUrl) ||
                    normalizedAvatarName(myAvatar?.imageUrl) ||
                    imageUrl,
                thumbnailImageUrl:
                    normalizedAvatarName(
                        profile?.currentAvatarThumbnailImageUrl
                    ) ||
                    normalizedAvatarName(avatarProfile?.thumbnailImageUrl) ||
                    normalizedAvatarName(myAvatar?.thumbnailImageUrl) ||
                    imageUrl
            };
        }
    }

    return hasUsefulAvatarDetails(myAvatar)
        ? myAvatar
        : avatarProfile || myAvatar;
}

function hasUsefulDisplayName(snapshot: any, userId: any) {
    const displayName = normalizeUserId(
        snapshot?.displayName ||
            snapshot?.display_name ||
            snapshot?.username ||
            snapshot?.name
    );
    return Boolean(displayName && displayName !== normalizeUserId(userId));
}

function isIdOnlyUserSeed(snapshot: any) {
    if (!snapshot || typeof snapshot !== 'object') {
        return false;
    }
    const userId = resolveProfileUserId(snapshot);
    if (!userId || hasUsefulDisplayName(snapshot, userId)) {
        return false;
    }
    return !Object.entries(snapshot).some(
        ([key, value]) =>
            !ID_ONLY_SEED_FIELDS.has(key) && hasRefreshValue(value)
    );
}

function sameSnapshotTarget(left: any, right: any) {
    const leftUserId = resolveProfileUserId(left);
    const rightUserId = resolveProfileUserId(right);
    return Boolean(leftUserId && rightUserId && leftUserId === rightUserId);
}

function mergeSeedAndKnownSnapshot(seedData: any, knownTargetUser: any) {
    if (!seedData || !knownTargetUser) {
        return seedData || knownTargetUser || null;
    }
    if (!sameSnapshotTarget(seedData, knownTargetUser)) {
        return seedData;
    }
    return isIdOnlyUserSeed(seedData)
        ? mergeLocalSnapshotIntoProfile(seedData, knownTargetUser)
        : seedData;
}

export function mergeLocalSnapshotIntoProfile(localSnapshot: any, profile: any) {
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

    const merged: any = { ...localSnapshot, ...profile };
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
}: any = {}) {
    const baseSnapshot = mergeSeedAndKnownSnapshot(seedData, knownTargetUser);
    if (friendSnapshot && baseSnapshot) {
        return mergeLocalSnapshotIntoProfile(friendSnapshot, baseSnapshot);
    }
    return friendSnapshot || baseSnapshot;
}

export function useUserDialogProfileResource({
    activitySnapshot = null,
    currentEndpoint,
    currentUserSnapshot,
    gameLogDisabled,
    gameState,
    isFriend = false,
    isTargetCurrentUser,
    localSnapshot,
    normalizedUserId,
    updateEntityDialogMetadata
}: any) {
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
    const normalizedActivitySnapshot = useMemo(
        () => normalizeTargetSnapshot(activitySnapshot, normalizedUserId),
        [activitySnapshot, normalizedUserId]
    );
    const localSnapshotRef = useRef(normalizedLocalSnapshot);
    localSnapshotRef.current = normalizedLocalSnapshot;
    const activitySnapshotRef = useRef(normalizedActivitySnapshot);
    activitySnapshotRef.current = normalizedActivitySnapshot;
    const avatarHydrationKeyRef = useRef('');
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
    const profileRef = useRef(profile);
    profileRef.current = profile;
    const [loadStatus, setLoadStatus] = useState(
        normalizedUserId ? 'running' : 'idle'
    );
    const [reloadToken, setReloadToken] = useState(0);
    const [detail, setDetail] = useState('');
    const activeUserTargetRef = useRef<any>({
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
            setBaseProfile((currentProfile: any) =>
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
        setBaseProfile((currentProfile: any) =>
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
                dialog: true,
                isFriend
            })
            .then((nextProfile: any) => {
                if (!active) {
                    return;
                }
                const remoteProfile = stripSyntheticSnapshotDefaults(
                    nextProfile,
                    {}
                );

                setBaseProfile((currentProfile: any) =>
                    preserveProfileIdentity(
                        currentProfile,
                        mergeActivityTimestampsIntoProfile(
                            (() => {
                                const previousProfile = previousTargetProfile(
                                    currentProfile,
                                    normalizedUserId
                                );
                                return isTargetCurrentUser
                                    ? mergeCurrentUserAvatarFields(
                                          mergeCurrentUserPresenceFields(
                                              remoteProfile,
                                              previousProfile
                                          ),
                                          previousProfile
                                      )
                                    : mergeLocalSnapshotIntoProfile(
                                          localSnapshotRef.current,
                                          remoteProfile
                                      );
                            })(),
                            activitySnapshotRef.current
                        ),
                        normalizedUserId
                    )
                );
                setLoadStatus('ready');
            })
            .catch((error: any) => {
                if (!active) {
                    return;
                }

                const fallbackSnapshot = localSnapshotRef.current;
                if (fallbackSnapshot) {
                    setBaseProfile((currentProfile: any) =>
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

    useEffect(() => {
        if (!isTargetCurrentUser || !shouldHydrateCurrentAvatar(profile)) {
            return undefined;
        }

        const currentAvatar = normalizeUserId(profile?.currentAvatar);
        const currentAvatarImageUrl =
            normalizedAvatarName(profile?.currentAvatarImageUrl) ||
            normalizedAvatarName(profile?.currentAvatarThumbnailImageUrl);
        const hydrationKey = `${currentEndpoint || ''}\u0000${normalizedUserId || ''}\u0000${currentAvatar}\u0000${currentAvatarImageUrl}\u0000${reloadToken}`;
        if (avatarHydrationKeyRef.current === hydrationKey) {
            return undefined;
        }
        avatarHydrationKeyRef.current = hydrationKey;

        let active = true;
        getCurrentAvatarDetails({
            avatarId: currentAvatar,
            endpoint: currentEndpoint,
            currentUserId: normalizedUserId,
            profile
        })
            .then((avatar: any) => {
                if (!active) {
                    return;
                }
                setBaseProfile((currentProfile: any) =>
                    preserveProfileIdentity(
                        currentProfile,
                        mergeCurrentAvatarProfile(
                            previousTargetProfile(
                                currentProfile,
                                normalizedUserId
                            ) ||
                                profileRef.current ||
                                profile,
                            avatar
                        ),
                        normalizedUserId
                    )
                );
            })
            .catch(() => {
                // Keep the existing user profile; avatar details are optional.
            });

        return () => {
            active = false;
            if (avatarHydrationKeyRef.current === hydrationKey) {
                avatarHydrationKeyRef.current = '';
            }
        };
    }, [
        currentEndpoint,
        isTargetCurrentUser,
        normalizedUserId,
        profile?.avatarName,
        profile?.currentAvatar,
        profile?.currentAvatarImageUrl,
        profile?.currentAvatarName,
        profile?.currentAvatarThumbnailImageUrl,
        reloadToken
    ]);

    function refreshProfile() {
        setReloadToken((value: any) => value + 1);
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
