import userProfileRepository from '@/repositories/userProfileRepository';
import { mergeCurrentUserPresenceFields } from '@/shared/utils/currentUserPresence';

import type {
    UserDialogProfileRecord,
    UserDialogProfileSnapshot
} from './userDialogProfileTypes';
import { normalizeUserId } from './userProfileFields';

type MergeSnapshotIntoCurrentProfileInput = {
    currentProfile: UserDialogProfileSnapshot;
    isTargetCurrentUser: boolean;
    snapshot: UserDialogProfileSnapshot;
    targetUserId: string;
};

type NormalizeTargetSnapshotOptions = {
    allowMissingId?: boolean;
};

type MergeUserDialogLocalSnapshotInput = {
    friendSnapshot?: unknown;
    seedData?: unknown;
    knownTargetUser?: unknown;
};

const SNAPSHOT_DEFAULT_FIELDS = [
    '$location',
    '$location_at',
    '$online_for',
    '$travelingToTime',
    '$active_for'
];

const FRIEND_PRESENCE_OVERRIDE_FIELDS = [
    'state',
    'stateBucket',
    'location',
    'status',
    'travelingToLocation',
    'travelingToTime',
    '$travelingToTime',
    '$location_at',
    'locationAt',
    'pendingOffline'
];

const ACTIVITY_TIMESTAMP_FIELDS = ['last_activity', 'last_login'];

const LOCAL_SNAPSHOT_REFRESH_FIELDS = [
    'friendNumber',
    '$friendNumber',
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

function hasOwnField(source: unknown, field: PropertyKey) {
    return Object.prototype.hasOwnProperty.call(source, field);
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

function hasRefreshValue(value: unknown) {
    return value !== undefined && value !== null && value !== '';
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

export function overlayFriendPresence(
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

export function stripSyntheticSnapshotDefaults(
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

export function preserveProfileIdentity(
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

export function mergeSnapshotIntoCurrentProfile({
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

export function normalizeTargetSnapshot(
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

export function profileMatchesTarget(profile: unknown, targetUserId: string) {
    return Boolean(
        profile &&
        targetUserId &&
        resolveProfileUserId(profile) === targetUserId
    );
}

export function previousTargetProfile(
    profile: UserDialogProfileSnapshot,
    targetUserId: string
): UserDialogProfileSnapshot {
    return profileMatchesTarget(profile, targetUserId) ? profile : null;
}

export function mergeActivityTimestampsIntoProfile(
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
