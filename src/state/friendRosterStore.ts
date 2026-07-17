import { create } from 'zustand';

import type {
    FriendLocationProjection,
    FriendPatchEntry,
    FriendProfileFields,
    FriendRecord,
    FriendRecordInput,
    FriendRosterBucket,
    FriendRosterById,
    FriendRosterInputById,
    FriendRosterOrdering,
    FriendRosterSeedSnapshot,
    FriendRosterSnapshotInput,
    FriendRosterState,
    FriendRosterStore
} from '@/domain/friends/friendRosterTypes';
import {
    computeTrustLevel,
    computeUserPlatform
} from '@/shared/utils/userTransforms';

function normalizeUserId(value: unknown): string {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function normalizeStateBucket(value: unknown): FriendRosterBucket | '' {
    const normalized = normalizeUserId(value).toLowerCase();
    if (
        normalized === 'online' ||
        normalized === 'active' ||
        normalized === 'offline'
    ) {
        return normalized;
    }
    return '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function normalizeOptionalString(value: unknown): string | null | undefined {
    if (typeof value === 'string') {
        return value;
    }
    return value === null ? null : undefined;
}

function normalizeOptionalBoolean(value: unknown): boolean | undefined {
    return typeof value === 'boolean' ? value : undefined;
}

function normalizeOptionalTimestamp(
    value: unknown
): number | string | null | undefined {
    if (typeof value === 'number' || typeof value === 'string') {
        return value;
    }
    return value === null ? null : undefined;
}

function normalizeOptionalStringArray(value: unknown): string[] | undefined {
    return Array.isArray(value) ? value.map(String) : undefined;
}

function normalizeOptionalArray(value: unknown): unknown[] | undefined {
    return Array.isArray(value) ? [...value] : undefined;
}

function normalizeOptionalLocationProjection(
    value: unknown
): FriendLocationProjection | null | undefined {
    if (value === null) {
        return null;
    }
    return isRecord(value) ? { ...value } : undefined;
}

function normalizeFriendProfileFields(
    source: FriendRecordInput
): FriendProfileFields {
    const profile: FriendProfileFields = {};

    const location = normalizeOptionalLocationProjection(source.$location);
    if (location !== undefined) {
        profile.$location = location;
    }
    const locationAt = normalizeOptionalTimestamp(source.$location_at);
    if (locationAt !== undefined) {
        profile.$location_at = locationAt;
    }
    const previousLocation = normalizeOptionalString(source.$previousLocation);
    if (previousLocation !== undefined) {
        profile.$previousLocation = previousLocation;
    }
    const previousLocationAt = normalizeOptionalTimestamp(
        source.$previousLocation_at
    );
    if (previousLocationAt !== undefined) {
        profile.$previousLocation_at = previousLocationAt;
    }
    const travelingToLocation = normalizeOptionalLocationProjection(
        source.$travelingToLocation
    );
    if (travelingToLocation !== undefined) {
        profile.$travelingToLocation = travelingToLocation;
    }
    const travelingToTime = normalizeOptionalString(source.$travelingToTime);
    if (travelingToTime !== undefined) {
        profile.$travelingToTime = travelingToTime;
    }
    const ageVerificationStatus = normalizeOptionalString(
        source.ageVerificationStatus
    );
    if (ageVerificationStatus !== undefined) {
        profile.ageVerificationStatus = ageVerificationStatus;
    }
    const ageVerified = normalizeOptionalBoolean(source.ageVerified);
    if (ageVerified !== undefined) {
        profile.ageVerified = ageVerified;
    }
    const allowAvatarCopying = normalizeOptionalBoolean(
        source.allowAvatarCopying
    );
    if (allowAvatarCopying !== undefined) {
        profile.allowAvatarCopying = allowAvatarCopying;
    }
    const badges = normalizeOptionalArray(source.badges);
    if (badges !== undefined) {
        profile.badges = badges;
    }
    const bannerColor = normalizeOptionalString(source.bannerColor);
    if (bannerColor !== undefined) {
        profile.bannerColor = bannerColor;
    }
    const bannerType = normalizeOptionalString(source.bannerType);
    if (bannerType !== undefined) {
        profile.bannerType = bannerType;
    }
    const bannerUrl = normalizeOptionalString(source.bannerUrl);
    if (bannerUrl !== undefined) {
        profile.bannerUrl = bannerUrl;
    }
    const bio = normalizeOptionalString(source.bio);
    if (bio !== undefined) {
        profile.bio = bio;
    }
    const bioLinks = normalizeOptionalStringArray(source.bioLinks);
    if (bioLinks !== undefined) {
        profile.bioLinks = bioLinks;
    }
    const currentAvatarAuthorId = normalizeOptionalString(
        source.currentAvatarAuthorId
    );
    if (currentAvatarAuthorId !== undefined) {
        profile.currentAvatarAuthorId = currentAvatarAuthorId;
    }
    const currentAvatarImageUrl = normalizeOptionalString(
        source.currentAvatarImageUrl
    );
    if (currentAvatarImageUrl !== undefined) {
        profile.currentAvatarImageUrl = currentAvatarImageUrl;
    }
    const currentAvatarName = normalizeOptionalString(source.currentAvatarName);
    if (currentAvatarName !== undefined) {
        profile.currentAvatarName = currentAvatarName;
    }
    const currentAvatarTags = normalizeOptionalStringArray(
        source.currentAvatarTags
    );
    if (currentAvatarTags !== undefined) {
        profile.currentAvatarTags = currentAvatarTags;
    }
    const currentAvatarThumbnailImageUrl = normalizeOptionalString(
        source.currentAvatarThumbnailImageUrl
    );
    if (currentAvatarThumbnailImageUrl !== undefined) {
        profile.currentAvatarThumbnailImageUrl = currentAvatarThumbnailImageUrl;
    }
    const discordId = normalizeOptionalString(source.discordId);
    if (discordId !== undefined) {
        profile.discordId = discordId;
    }
    const friendKey = normalizeOptionalString(source.friendKey);
    if (friendKey !== undefined) {
        profile.friendKey = friendKey;
    }
    const iconFrame = normalizeOptionalString(source.iconFrame);
    if (iconFrame !== undefined) {
        profile.iconFrame = iconFrame;
    }
    const iconUrl = normalizeOptionalString(source.iconUrl);
    if (iconUrl !== undefined) {
        profile.iconUrl = iconUrl;
    }
    const profilePicOverride = normalizeOptionalString(
        source.profilePicOverride
    );
    if (profilePicOverride !== undefined) {
        profile.profilePicOverride = profilePicOverride;
    }
    const profilePicOverrideThumbnail = normalizeOptionalString(
        source.profilePicOverrideThumbnail
    );
    if (profilePicOverrideThumbnail !== undefined) {
        profile.profilePicOverrideThumbnail = profilePicOverrideThumbnail;
    }
    const status = normalizeOptionalString(source.status);
    if (status !== undefined) {
        profile.status = status;
    }
    const statusDescription = normalizeOptionalString(source.statusDescription);
    if (statusDescription !== undefined) {
        profile.statusDescription = statusDescription;
    }
    const userIcon = normalizeOptionalString(source.userIcon);
    if (userIcon !== undefined) {
        profile.userIcon = userIcon;
    }

    return profile;
}

function normalizeFriendRecordMap(
    value: FriendRosterInputById | null | undefined
): FriendRosterInputById {
    const friendsById: FriendRosterInputById = {};
    if (!isRecord(value)) {
        return friendsById;
    }
    for (const [userId, friend] of Object.entries(value)) {
        if (isRecord(friend)) {
            friendsById[userId] = { ...friend };
        }
    }
    return friendsById;
}

function resolveFriendStateBucket({
    patch,
    stateBucket,
    stateBucketAuthority,
    existingEntry
}: {
    patch?: FriendRecordInput | null;
    stateBucket?: unknown;
    stateBucketAuthority?: unknown;
    existingEntry?: FriendRecord | null;
}): FriendRosterBucket {
    if (normalizeUserId(stateBucketAuthority).toLowerCase() === 'preserve') {
        return (
            normalizeStateBucket(existingEntry?.stateBucket) ||
            normalizeStateBucket(existingEntry?.state) ||
            'offline'
        );
    }

    const explicitStateBucket =
        normalizeStateBucket(stateBucket) ||
        normalizeStateBucket(patch?.stateBucket) ||
        normalizeStateBucket(patch?.state);

    return (
        explicitStateBucket ||
        normalizeStateBucket(existingEntry?.stateBucket) ||
        normalizeStateBucket(existingEntry?.state) ||
        'offline'
    );
}

function getDisplayName(user: FriendRecordInput | null | undefined): string {
    return (
        normalizeUserId(user?.displayName) ||
        normalizeUserId(user?.username) ||
        normalizeUserId(user?.id)
    );
}

function createFallbackFriendUser(
    userId: string,
    existingRow?: FriendRecord | null
): FriendRecordInput {
    return {
        id: userId,
        displayName: existingRow?.displayName || userId,
        username: '',
        tags: [],
        developerType: '',
        platform: 'offline',
        last_platform: '',
        location: 'offline',
        state: 'offline'
    };
}

function normalizePlatformAliases(
    friend: FriendRecordInput
): FriendRecordInput {
    const normalizedFriend = { ...friend };
    const lastPlatform = normalizeUserId(normalizedFriend.lastPlatform);
    if (lastPlatform) {
        normalizedFriend.last_platform = lastPlatform;
    }
    delete normalizedFriend.lastPlatform;
    return normalizedFriend;
}

function normalizeFriendEntry(
    friend: FriendRecordInput | null | undefined,
    stateBucket: FriendRosterBucket,
    existingRow?: FriendRecord | null
): FriendRecord {
    const fallbackUserId = normalizeUserId(
        existingRow?.id || existingRow?.userId
    );
    const source = normalizePlatformAliases(
        friend ?? createFallbackFriendUser(fallbackUserId, existingRow)
    );
    const tags = Array.isArray(source.tags) ? source.tags.map(String) : [];
    const trust = computeTrustLevel(tags, String(source.developerType || ''));
    const explicitTrustLevel = String(
        source.$trustLevel || source.trustLevel || ''
    );
    const hasTrustMetadata =
        Boolean(friend) &&
        (tags.length > 0 ||
            Boolean(source.developerType) ||
            Boolean(explicitTrustLevel));
    const trustLevel =
        explicitTrustLevel ||
        (hasTrustMetadata
            ? trust.trustLevel
            : String(
                  existingRow?.trustLevel || existingRow?.$trustLevel || ''
              )) ||
        trust.trustLevel;
    const friendNumberSource =
        source?.friendNumber ??
        source?.$friendNumber ??
        existingRow?.friendNumber ??
        existingRow?.$friendNumber ??
        0;
    const friendNumber = Number.parseInt(String(friendNumberSource), 10) || 0;
    const displayName =
        getDisplayName(source) ||
        normalizeUserId(existingRow?.displayName) ||
        normalizeUserId(source.id);

    return {
        ...source,
        ...normalizeFriendProfileFields(source),
        id: normalizeUserId(source.id),
        displayName,
        tags,
        state: stateBucket,
        stateBucket,
        friendNumber,
        trustLevel,
        $friendNumber: friendNumber,
        $trustLevel: trustLevel,
        $trustClass: trust.trustClass,
        $trustSortNum: trust.trustSortNum,
        $isModerator: trust.isModerator,
        $isTroll: trust.isTroll,
        $isProbableTroll: trust.isProbableTroll,
        $platform: computeUserPlatform(
            typeof source.platform === 'string' ? source.platform : '',
            typeof source.last_platform === 'string' ? source.last_platform : ''
        )
    };
}

function compareFriendEntries(
    left: FriendRecord | null | undefined,
    right: FriendRecord | null | undefined
): number {
    const leftNumber =
        Number.parseInt(
            String(left?.friendNumber ?? left?.$friendNumber ?? 0),
            10
        ) || 0;
    const rightNumber =
        Number.parseInt(
            String(right?.friendNumber ?? right?.$friendNumber ?? 0),
            10
        ) || 0;
    const leftHasNumber = leftNumber > 0;
    const rightHasNumber = rightNumber > 0;

    if (leftHasNumber !== rightHasNumber) {
        return leftHasNumber ? -1 : 1;
    }

    if (leftHasNumber && rightHasNumber && leftNumber !== rightNumber) {
        return leftNumber - rightNumber;
    }

    const leftName = String(left?.displayName || left?.id || '').toLowerCase();
    const rightName = String(
        right?.displayName || right?.id || ''
    ).toLowerCase();
    const nameComparison = leftName.localeCompare(rightName);
    if (nameComparison !== 0) {
        return nameComparison;
    }

    return String(left?.id || '').localeCompare(String(right?.id || ''));
}

function buildBucketIds(
    friendIds: string[],
    friendsById: FriendRosterById,
    stateBucket: FriendRosterBucket
): string[] {
    return friendIds
        .filter(
            (friendId) => friendsById[friendId]?.stateBucket === stateBucket
        )
        .sort((leftId, rightId) =>
            compareFriendEntries(friendsById[leftId], friendsById[rightId])
        );
}

function buildRosterOrdering(
    friendsById: FriendRosterById
): FriendRosterOrdering {
    const friendIds = Object.keys(friendsById);
    const onlineIds = buildBucketIds(friendIds, friendsById, 'online');
    const activeIds = buildBucketIds(friendIds, friendsById, 'active');
    const offlineIds = buildBucketIds(friendIds, friendsById, 'offline');

    return {
        onlineIds,
        activeIds,
        offlineIds,
        orderedFriendIds: [...onlineIds, ...activeIds, ...offlineIds]
    };
}

function normalizeRosterSnapshotFriends(
    friendsById: FriendRosterInputById | null | undefined
): FriendRosterById {
    const normalizedFriendsById: FriendRosterById = {};
    for (const [rawUserId, friend] of Object.entries(
        normalizeFriendRecordMap(friendsById)
    )) {
        const normalizedUserId =
            normalizeUserId(friend?.id || friend?.userId) ||
            normalizeUserId(rawUserId);
        if (!normalizedUserId) {
            continue;
        }
        const stateBucket = resolveFriendStateBucket({
            patch: friend
        });
        normalizedFriendsById[normalizedUserId] = normalizeFriendEntry(
            {
                ...friend,
                id: normalizedUserId
            },
            stateBucket
        );
    }
    return normalizedFriendsById;
}

function friendEntryNeedsOrderingUpdate(
    existingEntry: FriendRecord | null | undefined,
    nextEntry: FriendRecord
): boolean {
    if (!existingEntry) {
        return true;
    }
    const existingBucket =
        normalizeStateBucket(existingEntry?.stateBucket) ||
        normalizeStateBucket(existingEntry?.state) ||
        'offline';
    const nextBucket =
        normalizeStateBucket(nextEntry?.stateBucket) ||
        normalizeStateBucket(nextEntry?.state) ||
        'offline';

    if (existingBucket !== nextBucket) {
        return true;
    }

    return compareFriendEntries(existingEntry, nextEntry) !== 0;
}

function friendEntryIsUnchanged(
    existingEntry: FriendRecord | null | undefined,
    nextEntry: FriendRecord
): boolean {
    if (!existingEntry) {
        return false;
    }
    return JSON.stringify(existingEntry) === JSON.stringify(nextEntry);
}

const initialState: FriendRosterState = {
    currentUserId: null,
    loadStatus: 'idle',
    detail: '',
    lastLoadedAt: null,
    friendsById: {},
    orderedFriendIds: [],
    onlineIds: [],
    activeIds: [],
    offlineIds: []
};

export const useFriendRosterStore = create<FriendRosterStore>((set) => ({
    ...initialState,
    setRosterLoading(currentUserId: unknown, detail = '') {
        set((state) => {
            const normalizedCurrentUserId =
                normalizeUserId(currentUserId) || null;
            const isSameUser =
                normalizeUserId(state.currentUserId) ===
                normalizedCurrentUserId;
            const hasRoster =
                Object.keys(state.friendsById || {}).length > 0 ||
                state.orderedFriendIds.length > 0;

            if (isSameUser && hasRoster) {
                return {
                    ...state,
                    currentUserId: normalizedCurrentUserId,
                    loadStatus: 'running',
                    detail
                };
            }

            return {
                currentUserId: normalizedCurrentUserId,
                loadStatus: 'running',
                detail,
                lastLoadedAt: null,
                friendsById: {},
                orderedFriendIds: [],
                onlineIds: [],
                activeIds: [],
                offlineIds: []
            };
        });
    },
    setRosterReady(detail = '') {
        set((state) => ({
            ...state,
            loadStatus: 'ready',
            detail,
            lastLoadedAt: new Date().toISOString()
        }));
    },
    setRosterSnapshot({
        currentUserId,
        friendsById,
        orderedFriendIds,
        onlineIds,
        activeIds,
        offlineIds,
        detail = ''
    }: FriendRosterSnapshotInput) {
        const normalizedCurrentUserId = normalizeUserId(currentUserId) || null;
        const sourceFriendsById = normalizeFriendRecordMap(friendsById);
        // Guard against an empty `[]` ordering blanking a populated roster.
        const hasPrecomputedOrdering =
            Array.isArray(orderedFriendIds) &&
            Array.isArray(onlineIds) &&
            Array.isArray(activeIds) &&
            Array.isArray(offlineIds) &&
            (Object.keys(sourceFriendsById).length === 0 ||
                orderedFriendIds.length > 0);
        if (hasPrecomputedOrdering) {
            const normalizedFriendsById =
                normalizeRosterSnapshotFriends(sourceFriendsById);
            const nextState: FriendRosterState = {
                currentUserId: normalizedCurrentUserId,
                loadStatus: 'ready',
                detail,
                lastLoadedAt: new Date().toISOString(),
                friendsById: normalizedFriendsById,
                orderedFriendIds,
                onlineIds,
                activeIds,
                offlineIds
            };
            set(nextState);
            return;
        }
        const normalizedFriendsById =
            normalizeRosterSnapshotFriends(sourceFriendsById);
        const ordering = buildRosterOrdering(normalizedFriendsById);
        const nextState: FriendRosterState = {
            currentUserId: normalizedCurrentUserId,
            loadStatus: 'ready',
            detail,
            lastLoadedAt: new Date().toISOString(),
            friendsById: normalizedFriendsById,
            orderedFriendIds: ordering.orderedFriendIds,
            onlineIds: ordering.onlineIds,
            activeIds: ordering.activeIds,
            offlineIds: ordering.offlineIds
        };
        set(nextState);
    },
    setRosterSeedSnapshot({
        currentUserId,
        friendsById,
        detail = ''
    }: FriendRosterSeedSnapshot) {
        const normalizedFriendsById =
            normalizeRosterSnapshotFriends(friendsById);
        const ordering = buildRosterOrdering(normalizedFriendsById);
        const nextState: FriendRosterState = {
            currentUserId: normalizeUserId(currentUserId) || null,
            loadStatus: 'running',
            detail,
            lastLoadedAt: new Date().toISOString(),
            friendsById: normalizedFriendsById,
            orderedFriendIds: ordering.orderedFriendIds,
            onlineIds: ordering.onlineIds,
            activeIds: ordering.activeIds,
            offlineIds: ordering.offlineIds
        };
        set(nextState);
    },
    setRosterError(detail: string) {
        set((state) => ({
            ...state,
            loadStatus: 'error',
            detail,
            lastLoadedAt: new Date().toISOString()
        }));
    },
    applyFriendPatch({
        userId,
        patch = {},
        stateBucket,
        stateBucketAuthority,
        detail = ''
    }: FriendPatchEntry & { detail?: string }) {
        set((state) => {
            const normalizedUserId = normalizeUserId(userId || patch?.id);
            if (!normalizedUserId) {
                return state;
            }

            const existingEntry = state.friendsById[normalizedUserId] ?? null;
            const nextStateBucket = resolveFriendStateBucket({
                patch,
                stateBucket,
                stateBucketAuthority,
                existingEntry
            });
            const mergedUser: FriendRecordInput = {
                ...(existingEntry ??
                    createFallbackFriendUser(normalizedUserId, existingEntry)),
                ...(isRecord(patch) ? patch : {}),
                id: normalizedUserId
            };
            const normalizedEntry = normalizeFriendEntry(
                mergedUser,
                nextStateBucket,
                existingEntry ?? {
                    id: normalizedUserId,
                    userId: normalizedUserId,
                    displayName: normalizedUserId,
                    friendNumber: 0
                }
            );
            const orderingDirty = friendEntryNeedsOrderingUpdate(
                existingEntry,
                normalizedEntry
            );
            if (
                !orderingDirty &&
                friendEntryIsUnchanged(existingEntry, normalizedEntry)
            ) {
                return state;
            }
            const friendsById: FriendRosterById = {
                ...state.friendsById,
                [normalizedUserId]: normalizedEntry
            };
            const nextState = {
                ...state,
                ...(orderingDirty ? buildRosterOrdering(friendsById) : {}),
                friendsById,
                loadStatus:
                    state.loadStatus === 'idle' ? 'ready' : state.loadStatus,
                detail: detail || state.detail,
                lastLoadedAt: new Date().toISOString()
            };
            return nextState;
        });
    },
    applyFriendPatches(patches: FriendPatchEntry[] = [], detail = '') {
        set((state) => {
            if (!Array.isArray(patches) || patches.length === 0) {
                return state;
            }

            let changed = false;
            let orderingDirty = false;
            const friendsById: FriendRosterById = { ...state.friendsById };

            for (const entry of patches) {
                const patch: FriendRecordInput = isRecord(entry?.patch)
                    ? entry.patch
                    : {};
                const normalizedUserId = normalizeUserId(
                    entry?.userId || patch?.id
                );
                if (!normalizedUserId) {
                    continue;
                }

                const existingEntry = friendsById[normalizedUserId] ?? null;
                const nextStateBucket = resolveFriendStateBucket({
                    patch,
                    stateBucket: entry?.stateBucket,
                    stateBucketAuthority: entry?.stateBucketAuthority,
                    existingEntry
                });
                const mergedUser: FriendRecordInput = {
                    ...(existingEntry ??
                        createFallbackFriendUser(
                            normalizedUserId,
                            existingEntry
                        )),
                    ...patch,
                    id: normalizedUserId
                };
                const normalizedEntry = normalizeFriendEntry(
                    mergedUser,
                    nextStateBucket,
                    existingEntry ?? {
                        id: normalizedUserId,
                        userId: normalizedUserId,
                        displayName: normalizedUserId,
                        friendNumber: 0
                    }
                );
                if (
                    friendEntryNeedsOrderingUpdate(
                        existingEntry,
                        normalizedEntry
                    )
                ) {
                    orderingDirty = true;
                }
                friendsById[normalizedUserId] = normalizedEntry;
                changed = true;
            }

            if (!changed) {
                return state;
            }

            const nextState = {
                ...state,
                ...(orderingDirty ? buildRosterOrdering(friendsById) : {}),
                friendsById,
                loadStatus:
                    state.loadStatus === 'idle' ? 'ready' : state.loadStatus,
                detail: detail || state.detail,
                lastLoadedAt: new Date().toISOString()
            };
            return nextState;
        });
    },
    removeFriend(userId: unknown, detail = '') {
        set((state) => {
            const normalizedUserId = normalizeUserId(userId);
            if (!normalizedUserId || !state.friendsById[normalizedUserId]) {
                return state;
            }

            const friendsById: FriendRosterById = { ...state.friendsById };
            delete friendsById[normalizedUserId];

            const nextState = {
                ...state,
                ...buildRosterOrdering(friendsById),
                friendsById,
                detail: detail || state.detail,
                lastLoadedAt: new Date().toISOString()
            };
            return nextState;
        });
    },
    resetRoster() {
        set(initialState);
    }
}));
