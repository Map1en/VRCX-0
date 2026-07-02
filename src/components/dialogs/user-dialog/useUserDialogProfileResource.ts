import { useEffect, useMemo, useRef, useState } from 'react';

import avatarProfileRepository from '@/repositories/avatarProfileRepository';
import myAvatarRepository from '@/repositories/myAvatarRepository';
import userProfileRepository from '@/repositories/userProfileRepository';
import {
    buildCurrentUserPresenceView,
    mergeCurrentUserPresenceFields,
    type CurrentUserPresenceGameState,
    type CurrentUserPresenceRecord
} from '@/shared/utils/currentUserPresence';
import { useFriendRosterStore } from '@/state/friendRosterStore';

import { normalizeUserId } from './userProfileFields';

type UserDialogProfileRecord = CurrentUserPresenceRecord & {
    id?: string;
    userId?: string;
    user_id?: string;
    targetUserId?: string;
    target_user_id?: string;
    displayName?: string;
    display_name?: string;
    username?: string;
    name?: string;
    currentAvatar?: string;
    currentAvatarName?: string;
    avatarName?: string;
    currentAvatarImageUrl?: string;
    currentAvatarThumbnailImageUrl?: string;
    profilePicOverride?: string;
    profilePicOverrideThumbnail?: string;
};

type UserDialogProfileSnapshot = UserDialogProfileRecord | null;

type UserDialogAvatarRecord = Record<string, unknown> & {
    id?: unknown;
    name?: unknown;
    imageUrl?: unknown;
    thumbnailImageUrl?: unknown;
    avatarName?: unknown;
};

type UserDialogProfileLoadStatus = 'idle' | 'running' | 'ready' | 'error';

type ActiveUserTarget = {
    userId: string;
    endpoint?: string;
};

type MergeSnapshotIntoCurrentProfileInput = {
    currentProfile: UserDialogProfileSnapshot;
    isTargetCurrentUser: boolean;
    snapshot: UserDialogProfileSnapshot;
    targetUserId: string;
};

type NormalizeTargetSnapshotOptions = {
    allowMissingId?: boolean;
};

type CurrentAvatarDetailsInput = {
    avatarId: string;
    currentUserId: string;
    endpoint?: string;
    profile: UserDialogProfileSnapshot;
};

type MergeUserDialogLocalSnapshotInput = {
    friendSnapshot?: unknown;
    seedData?: unknown;
    knownTargetUser?: unknown;
};

type UserDialogGameStateInput = Omit<
    CurrentUserPresenceGameState,
    'isGameRunning'
> & {
    isGameRunning?: boolean | null;
};

type UseUserDialogProfileResourceInput = {
    activitySnapshot?: unknown;
    currentEndpoint?: string;
    currentUserSnapshot?: unknown;
    gameLogDisabled?: boolean;
    gameState?: UserDialogGameStateInput | null;
    isFriend?: boolean;
    isTargetCurrentUser: boolean;
    localSnapshot?: unknown;
    normalizedUserId: string;
    updateEntityDialogMetadata: (metadata: {
        kind: 'user';
        entityId: string;
        title: string;
    }) => void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object');
}

function toProfileSnapshot(value: unknown): UserDialogProfileSnapshot {
    return isRecord(value) ? value : null;
}

function resolveProfileUserId(profile: unknown) {
    const record = isRecord(profile) ? profile : {};
    return normalizeUserId(
        record.id ||
            record.userId ||
            record.user_id ||
            record.targetUserId ||
            record.target_user_id
    );
}

const SNAPSHOT_DEFAULT_FIELDS = [
    '$location',
    '$location_at',
    '$online_for',
    '$travelingToTime',
    '$active_for'
];

function hasOwnField(source: unknown, field: PropertyKey) {
    return Object.prototype.hasOwnProperty.call(source, field);
}

const FRIEND_PRESENCE_OVERRIDE_FIELDS = [
    'state',
    'stateBucket',
    'location',
    'status',
    'travelingToLocation',
    'travelingToTime',
    'locationAt',
    'pendingOffline'
];

function overlayFriendPresence(
    base: UserDialogProfileSnapshot,
    friend: Record<string, unknown> | null | undefined
): UserDialogProfileSnapshot {
    if (!base || !friend) {
        return base;
    }
    let next: UserDialogProfileRecord = base;
    for (const field of FRIEND_PRESENCE_OVERRIDE_FIELDS) {
        const value = friend[field];
        if (value === undefined) {
            continue;
        }
        if (next === base) {
            next = { ...base };
        }
        next[field] = value;
    }
    return next;
}

function stripSyntheticSnapshotDefaults(
    profile: UserDialogProfileSnapshot,
    snapshot: unknown
) {
    if (!profile || !isRecord(snapshot)) {
        return profile;
    }

    let nextProfile: UserDialogProfileRecord = profile;
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

function valuesEqual(left: unknown, right: unknown) {
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

function profilesEqual(left: unknown, right: unknown) {
    if (left === right) {
        return true;
    }
    if (!isRecord(left) || !isRecord(right)) {
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

function preserveProfileIdentity(
    currentProfile: UserDialogProfileSnapshot,
    nextProfile: UserDialogProfileSnapshot,
    targetUserId: string
): UserDialogProfileSnapshot {
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
}: MergeSnapshotIntoCurrentProfileInput) {
    const previousProfile = previousTargetProfile(currentProfile, targetUserId);
    const nextProfile =
        isTargetCurrentUser && snapshot
            ? mergeCurrentUserPresenceFields(snapshot, previousProfile)
            : mergeLocalSnapshotIntoProfile(snapshot, previousProfile);
    return preserveProfileIdentity(currentProfile, nextProfile, targetUserId);
}

function normalizeTargetSnapshot(
    snapshot: unknown,
    targetUserId: string,
    { allowMissingId = true }: NormalizeTargetSnapshotOptions = {}
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

function profileMatchesTarget(profile: unknown, targetUserId: string) {
    return Boolean(
        profile &&
        targetUserId &&
        resolveProfileUserId(profile) === targetUserId
    );
}

function previousTargetProfile(
    profile: UserDialogProfileSnapshot,
    targetUserId: string
): UserDialogProfileSnapshot {
    return profileMatchesTarget(profile, targetUserId) ? profile : null;
}

const ACTIVITY_TIMESTAMP_FIELDS = ['last_activity', 'last_login'];

function mergeActivityTimestampsIntoProfile(
    profile: UserDialogProfileSnapshot,
    snapshot: unknown
) {
    if (!profile || !isRecord(snapshot)) {
        return profile;
    }

    const profileUserId = resolveProfileUserId(profile);
    const snapshotUserId = resolveProfileUserId(snapshot);
    if (profileUserId && snapshotUserId && profileUserId !== snapshotUserId) {
        return profile;
    }

    let nextProfile: UserDialogProfileRecord = profile;
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

function hasRefreshValue(value: unknown) {
    return value !== undefined && value !== null && value !== '';
}

function normalizedAvatarName(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
}

function isUnknownAvatarName(value: unknown) {
    const name = normalizedAvatarName(value).toLowerCase();
    return (
        !name || name === '-' || name === 'unknown' || name === 'unknown avatar'
    );
}

function shouldHydrateCurrentAvatar(profile: UserDialogProfileSnapshot) {
    return Boolean(
        normalizeUserId(profile?.currentAvatar) &&
        (isUnknownAvatarName(
            profile?.currentAvatarName || profile?.avatarName
        ) ||
            (!hasRefreshValue(profile?.currentAvatarImageUrl) &&
                !hasRefreshValue(profile?.currentAvatarThumbnailImageUrl)))
    );
}

function mergeCurrentAvatarProfile(
    profile: UserDialogProfileSnapshot,
    avatar: unknown
) {
    if (!profile || !isRecord(avatar)) {
        return profile;
    }
    const avatarRecord: UserDialogAvatarRecord = avatar;

    const avatarId = normalizeUserId(avatarRecord.id);
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
    const avatarName = normalizedAvatarName(avatarRecord.name);
    if (avatarName && profileAvatarNameUnknown) {
        nextProfile = { ...nextProfile, currentAvatarName: avatarName };
    }

    const thumbnailImageUrl =
        normalizedAvatarName(avatarRecord.thumbnailImageUrl) ||
        normalizedAvatarName(avatarRecord.imageUrl);
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
        normalizedAvatarName(avatarRecord.imageUrl) ||
        normalizedAvatarName(avatarRecord.thumbnailImageUrl);
    if (
        imageUrl &&
        (profileAvatarNameUnknown ||
            !hasRefreshValue(nextProfile.currentAvatarImageUrl))
    ) {
        nextProfile = { ...nextProfile, currentAvatarImageUrl: imageUrl };
    }

    return nextProfile;
}

function mergeCurrentUserAvatarFields(
    profile: UserDialogProfileSnapshot,
    previousProfile: UserDialogProfileSnapshot
) {
    if (!previousProfile || !profile) {
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

function hasUsefulAvatarDetails(avatar: unknown) {
    if (!isRecord(avatar)) {
        return false;
    }
    return Boolean(
        !isUnknownAvatarName(avatar.name) ||
        hasRefreshValue(avatar.imageUrl) ||
        hasRefreshValue(avatar.thumbnailImageUrl)
    );
}

function hasUsefulAvatarName(avatar: unknown) {
    return Boolean(isRecord(avatar) && !isUnknownAvatarName(avatar.name));
}

async function getCurrentAvatarDetails({
    avatarId,
    currentUserId,
    endpoint,
    profile
}: CurrentAvatarDetailsInput) {
    let avatarProfile: UserDialogAvatarRecord | null = null;
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

    let myAvatar: UserDialogAvatarRecord | null = null;
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

function hasUsefulDisplayName(snapshot: unknown, userId: unknown) {
    const record = isRecord(snapshot) ? snapshot : {};
    const displayName = normalizeUserId(
        record.displayName ||
            record.display_name ||
            record.username ||
            record.name
    );
    return Boolean(displayName && displayName !== normalizeUserId(userId));
}

function isIdOnlyUserSeed(snapshot: unknown) {
    if (!isRecord(snapshot)) {
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

function sameSnapshotTarget(left: unknown, right: unknown) {
    const leftUserId = resolveProfileUserId(left);
    const rightUserId = resolveProfileUserId(right);
    return Boolean(leftUserId && rightUserId && leftUserId === rightUserId);
}

function mergeSeedAndKnownSnapshot(
    seedData: UserDialogProfileSnapshot,
    knownTargetUser: UserDialogProfileSnapshot
) {
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

export function mergeLocalSnapshotIntoProfile(
    localSnapshot: UserDialogProfileSnapshot,
    profile: UserDialogProfileSnapshot
) {
    if (!localSnapshot) {
        return profile || null;
    }
    if (!profile) {
        return localSnapshot;
    }

    const localUserId = resolveProfileUserId(localSnapshot);
    const profileUserId = resolveProfileUserId(profile);
    if (localUserId && profileUserId && localUserId !== profileUserId) {
        return localSnapshot;
    }

    const merged: UserDialogProfileRecord = { ...localSnapshot, ...profile };
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
}: MergeUserDialogLocalSnapshotInput = {}) {
    const friendProfile = toProfileSnapshot(friendSnapshot);
    const baseSnapshot = mergeSeedAndKnownSnapshot(
        toProfileSnapshot(seedData),
        toProfileSnapshot(knownTargetUser)
    );
    if (friendProfile && baseSnapshot) {
        return mergeLocalSnapshotIntoProfile(friendProfile, baseSnapshot);
    }
    return friendProfile || baseSnapshot;
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
}: UseUserDialogProfileResourceInput) {
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
    const normalizedGameState = useMemo<CurrentUserPresenceGameState | null>(
        () =>
            gameState
                ? {
                      ...gameState,
                      isGameRunning: gameState.isGameRunning === true
                  }
                : null,
        [gameState]
    );
    const localSnapshotRef = useRef(normalizedLocalSnapshot);
    localSnapshotRef.current = normalizedLocalSnapshot;
    const activitySnapshotRef = useRef(normalizedActivitySnapshot);
    activitySnapshotRef.current = normalizedActivitySnapshot;
    const avatarHydrationKeyRef = useRef('');
    const [baseProfile, setBaseProfile] = useState<UserDialogProfileSnapshot>(
        () => normalizedLocalSnapshot
    );
    const activeBaseProfile = useMemo(
        () =>
            profileMatchesTarget(baseProfile, normalizedUserId)
                ? baseProfile
                : normalizedLocalSnapshot,
        [baseProfile, normalizedLocalSnapshot, normalizedUserId]
    );
    const friendPresenceSource = useFriendRosterStore((state) =>
        isFriend && !isTargetCurrentUser
            ? state.friendsById[normalizedUserId] || null
            : null
    );
    const profile = useMemo(() => {
        const base = isTargetCurrentUser
            ? buildCurrentUserPresenceView(activeBaseProfile, {
                  currentUserSnapshot: currentUserPresenceSnapshot,
                  gameState: normalizedGameState,
                  gameLogDisabled
              })
            : activeBaseProfile;
        return overlayFriendPresence(base, friendPresenceSource);
    }, [
        activeBaseProfile,
        currentUserPresenceSnapshot,
        gameLogDisabled,
        isTargetCurrentUser,
        friendPresenceSource,
        normalizedGameState
    ]);
    const profileRef = useRef(profile);
    profileRef.current = profile;
    const [loadStatus, setLoadStatus] = useState<UserDialogProfileLoadStatus>(
        normalizedUserId ? 'running' : 'idle'
    );
    const [reloadToken, setReloadToken] = useState(0);
    const [detail, setDetail] = useState('');
    const activeUserTargetRef = useRef<ActiveUserTarget>({
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
                dialog: true,
                isFriend
            })
            .then((nextProfile) => {
                if (!active) {
                    return;
                }
                const remoteProfile = stripSyntheticSnapshotDefaults(
                    nextProfile,
                    {}
                );

                setBaseProfile((currentProfile) =>
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
            .catch((error: unknown) => {
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
            .then((avatar) => {
                if (!active) {
                    return;
                }
                setBaseProfile((currentProfile) =>
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
                // no-op
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
