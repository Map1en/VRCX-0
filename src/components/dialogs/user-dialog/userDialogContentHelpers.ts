import { AppleIcon, MonitorIcon, RectangleGogglesIcon } from 'lucide-react';

import {
    isExplicitlyOfflineFriend,
    resolveObservedPlayerUserIds
} from '@/domain/friends/sameInstanceFriends';
import { hasGroupIdPrefix } from '@/shared/constants/vrchatIds';
import {
    parseLocation,
    resolveFriendPresenceLocation
} from '@/shared/utils/location';
export { resolveCurrentInviteLocation } from '@/shared/utils/invite';

import { normalizeUserId } from './userProfileFields';

type LocationUserRow = Record<string, unknown> & {
    id: string;
    userId: string;
    displayName: string;
};

function record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object'
        ? Object.fromEntries(Object.entries(value))
        : {};
}

export function isGroupId(value: unknown) {
    return hasGroupIdPrefix(normalizeUserId(value));
}

export function groupSeed(value: unknown) {
    const group = record(value);
    if (!Object.keys(group).length) {
        return null;
    }
    const groupId = normalizeUserId(
        group.groupId || group.group_id || group.id
    );
    return isGroupId(groupId) ? group : null;
}

export function groupDisplayName(...values: unknown[]) {
    const fallback: string[] = [];
    for (const value of values) {
        const text = normalizeUserId(value);
        if (!text) {
            continue;
        }
        if (!isGroupId(text)) {
            return text;
        }
        fallback.push(text);
    }
    return fallback[0] || '';
}

export function hasGroupProfileDetails(
    source: unknown,
    fallbackSource: unknown = {}
) {
    const group = record(source);
    if (!Object.keys(group).length) {
        return false;
    }
    const fallback = record(fallbackSource);
    const nestedGroup = record(group.group);
    const name = groupDisplayName(
        group.name,
        group.displayName,
        group.display_name,
        group.groupName,
        group.group_name,
        group.shortCode,
        nestedGroup.name,
        nestedGroup.displayName,
        nestedGroup.display_name,
        fallback.name,
        fallback.displayName,
        fallback.display_name
    );
    const image = normalizeUserId(
        group.iconUrl ||
            group.icon_url ||
            group.thumbnailImageUrl ||
            group.thumbnail_image_url ||
            group.imageUrl ||
            group.image_url ||
            nestedGroup.iconUrl ||
            nestedGroup.icon_url ||
            nestedGroup.thumbnailImageUrl ||
            nestedGroup.thumbnail_image_url ||
            nestedGroup.imageUrl ||
            nestedGroup.image_url
    );
    return Boolean((name && !isGroupId(name)) || image);
}

export function resolvePlatformMeta(platform: unknown) {
    const normalized = normalizeUserId(platform).toLowerCase();

    if (
        normalized === 'standalonewindows' ||
        normalized === 'pc' ||
        normalized === 'windows'
    ) {
        return {
            label: 'PC',
            icon: MonitorIcon
        };
    }

    if (normalized === 'android' || normalized === 'quest') {
        return {
            label: 'Android',
            icon: RectangleGogglesIcon
        };
    }

    if (normalized === 'ios') {
        return {
            label: 'iOS',
            icon: AppleIcon
        };
    }

    return {
        label: normalized ? normalized : 'Unknown',
        icon: null
    };
}

export function resolvePresenceLocation(profile: unknown) {
    return resolveFriendPresenceLocation(profile);
}

export function resolveUserDialogTargetPresenceLocation({
    profile,
    targetUserId,
    currentLocation,
    currentLocationPlayerIds,
    currentLocationPlayers,
    friendsById = {}
}: {
    profile: unknown;
    targetUserId: unknown;
    currentLocation: unknown;
    currentLocationPlayerIds: unknown;
    currentLocationPlayers?: unknown;
    friendsById?: Record<string, unknown>;
}) {
    const presenceLocation = resolvePresenceLocation(profile);
    const normalizedTargetUserId = normalizeUserId(targetUserId);
    if (
        normalizedTargetUserId &&
        isExplicitlyOfflineFriend(friendsById[normalizedTargetUserId])
    ) {
        return 'offline';
    }
    if (parseLocation(presenceLocation).isRealInstance) {
        return presenceLocation;
    }

    const normalizedCurrentLocation = normalizeUserId(currentLocation);
    if (
        !normalizedTargetUserId ||
        !parseLocation(normalizedCurrentLocation).isRealInstance ||
        !resolveObservedPlayerUserIds(
            currentLocationPlayerIds,
            currentLocationPlayers,
            friendsById
        ).includes(normalizedTargetUserId)
    ) {
        return presenceLocation;
    }

    return normalizedCurrentLocation;
}

export function isSameLocationTag(left: unknown, right: unknown) {
    const leftTag = normalizeUserId(left);
    const rightTag = normalizeUserId(right);
    if (!leftTag || !rightTag) {
        return false;
    }
    if (leftTag === rightTag) {
        return true;
    }
    const leftLocation = parseLocation(leftTag);
    const rightLocation = parseLocation(rightTag);
    return Boolean(
        leftLocation.worldId &&
        rightLocation.worldId &&
        leftLocation.instanceId &&
        rightLocation.instanceId &&
        leftLocation.worldId === rightLocation.worldId &&
        leftLocation.instanceId === rightLocation.instanceId
    );
}

export function userDisplayName(user: unknown) {
    if (typeof user === 'string') {
        return normalizeUserId(user);
    }
    const source = record(user);
    const nestedUser = record(source.user);
    return normalizeUserId(
        source.displayName ||
            source.display_name ||
            source.username ||
            source.name ||
            nestedUser.displayName ||
            nestedUser.display_name ||
            nestedUser.username ||
            nestedUser.name ||
            source.userId ||
            source.user_id ||
            source.id ||
            nestedUser.id ||
            nestedUser.userId ||
            nestedUser.user_id
    );
}

export function createLocationUserRow(
    user: unknown,
    fallbackSource: unknown = {}
): LocationUserRow {
    const source =
        typeof user === 'string'
            ? { id: user, userId: user, displayName: user }
            : record(user);
    const fallback = record(fallbackSource);
    const nestedUser = record(source.user);
    const userId = normalizeUserId(
        source.id ||
            source.userId ||
            source.user_id ||
            source.targetUserId ||
            source.target_user_id ||
            nestedUser.id ||
            nestedUser.userId ||
            nestedUser.user_id ||
            fallback.id ||
            fallback.userId ||
            fallback.user_id
    );
    const displayName =
        userDisplayName(source) ||
        normalizeUserId(fallback.displayName || fallback.display_name) ||
        userId;
    return {
        ...nestedUser,
        ...(source && typeof source === 'object' ? source : {}),
        id: userId,
        userId,
        displayName,
        userIcon:
            source.userIcon || nestedUser.userIcon || fallback.userIcon || '',
        profilePicOverrideThumbnail:
            source.profilePicOverrideThumbnail ||
            nestedUser.profilePicOverrideThumbnail ||
            fallback.profilePicOverrideThumbnail ||
            '',
        profilePicOverride:
            source.profilePicOverride ||
            nestedUser.profilePicOverride ||
            fallback.profilePicOverride ||
            '',
        thumbnailUrl:
            source.thumbnailUrl ||
            nestedUser.thumbnailUrl ||
            fallback.thumbnailUrl ||
            '',
        currentAvatarThumbnailImageUrl:
            source.currentAvatarThumbnailImageUrl ||
            nestedUser.currentAvatarThumbnailImageUrl ||
            fallback.currentAvatarThumbnailImageUrl ||
            '',
        currentAvatarImageUrl:
            source.currentAvatarImageUrl ||
            nestedUser.currentAvatarImageUrl ||
            fallback.currentAvatarImageUrl ||
            '',
        $subtitle: fallback.subtitle || '',
        $location_at:
            source?.$location_at ||
            source?.locationAt ||
            source?.location_at ||
            fallback.joinedAt ||
            fallback.joined_at ||
            '',
        joinedAt:
            source?.joinedAt ||
            source?.joined_at ||
            fallback.joinedAt ||
            fallback.joined_at ||
            ''
    };
}

export function createLocationGroupRow(
    group: unknown,
    fallbackSource: unknown = {}
) {
    const source =
        typeof group === 'string'
            ? { id: group, groupId: group, name: group }
            : record(group);
    const fallback = record(fallbackSource);
    const nestedGroup = record(source.group);
    const groupId = normalizeUserId(
        source.groupId ||
            source.group_id ||
            nestedGroup.id ||
            nestedGroup.groupId ||
            nestedGroup.group_id ||
            (isGroupId(source.id) ? source.id : '') ||
            fallback.groupId ||
            fallback.group_id ||
            fallback.id
    );
    const name = groupDisplayName(
        source.name,
        source.displayName,
        source.display_name,
        source.groupName,
        source.group_name,
        source.shortCode,
        nestedGroup.name,
        nestedGroup.displayName,
        nestedGroup.display_name,
        fallback.name,
        fallback.displayName,
        fallback.display_name,
        groupId
    );
    return {
        ...nestedGroup,
        ...(source && typeof source === 'object' ? source : {}),
        id: groupId,
        groupId,
        name,
        displayName: source.displayName || source.display_name || name,
        iconUrl:
            source.iconUrl ||
            source.icon_url ||
            nestedGroup.iconUrl ||
            nestedGroup.icon_url ||
            fallback.iconUrl ||
            fallback.icon_url ||
            '',
        thumbnailImageUrl:
            source.thumbnailImageUrl ||
            source.thumbnail_image_url ||
            nestedGroup.thumbnailImageUrl ||
            nestedGroup.thumbnail_image_url ||
            '',
        imageUrl:
            source.imageUrl ||
            source.image_url ||
            nestedGroup.imageUrl ||
            nestedGroup.image_url ||
            ''
    };
}

function isPresentValue(value: unknown) {
    return value !== undefined && value !== null && value !== '';
}

export function mergeLocationUserRows(
    existing: LocationUserRow | undefined,
    incoming: LocationUserRow | undefined
) {
    if (!existing) {
        return incoming;
    }
    if (!incoming) {
        return existing;
    }

    const merged: LocationUserRow = { ...incoming, ...existing };
    for (const [key, value] of Object.entries(incoming)) {
        if (!isPresentValue(merged[key]) && isPresentValue(value)) {
            merged[key] = value;
        }
    }
    return merged;
}

export function mergeLocationUser(
    rowsById: Map<string, LocationUserRow>,
    user: unknown,
    fallback: unknown = {}
) {
    const row = createLocationUserRow(user, fallback);
    const key = row.id || `display:${row.displayName}`;
    if (!key) {
        return;
    }
    const existing = rowsById.get(key);
    if (existing) {
        rowsById.set(key, mergeLocationUserRows(existing, row) || row);
        return;
    }
    rowsById.set(key, row);
}

export function pushLocationUserSource(
    source: unknown,
    push: (value: unknown) => void
) {
    if (!source) {
        return;
    }
    if (source instanceof Map) {
        for (const value of source.values()) {
            pushLocationUserSource(value, push);
        }
        return;
    }
    if (Array.isArray(source)) {
        for (const value of source) {
            pushLocationUserSource(value, push);
        }
        return;
    }
    if (typeof source === 'object') {
        const sourceRecord = record(source);
        const nestedUser = record(sourceRecord.user);
        if (
            sourceRecord.id ||
            sourceRecord.userId ||
            sourceRecord.user_id ||
            sourceRecord.targetUserId ||
            sourceRecord.target_user_id ||
            sourceRecord.displayName ||
            sourceRecord.display_name ||
            sourceRecord.username ||
            sourceRecord.name ||
            nestedUser.id ||
            nestedUser.userId ||
            nestedUser.displayName ||
            nestedUser.username
        ) {
            push(sourceRecord);
            return;
        }
        for (const value of Object.values(sourceRecord)) {
            pushLocationUserSource(value, push);
        }
        return;
    }
    push(source);
}

export function instanceLocation(instance: unknown) {
    const instanceRecord = record(instance);
    const source = record(instanceRecord.instance || instanceRecord);
    const sourceLocation = record(source.$location);
    const instanceLocationRecord = record(instanceRecord.$location);
    return normalizeUserId(
        source.location ||
            source.tag ||
            sourceLocation.tag ||
            instanceRecord.location ||
            instanceRecord.tag ||
            instanceLocationRecord.tag
    );
}

export function locationCacheKey(location: unknown) {
    const parsed = parseLocation(location);
    if (!parsed.worldId || !parsed.instanceId) {
        return '';
    }
    return `${parsed.worldId}:${parsed.instanceId}`;
}

export function buildCachedInstanceMap(instances: unknown) {
    const map = new Map<string, Record<string, unknown>>();
    for (const instance of Array.isArray(instances) ? instances : []) {
        const instanceRecord = record(instance);
        const source = record(instanceRecord.instance || instanceRecord);
        const location = instanceLocation(instance);
        if (!location) {
            continue;
        }
        map.set(location, source);
        const key = locationCacheKey(location);
        if (key) {
            map.set(key, source);
        }
    }
    return map;
}

export function resolveFriendRequestState(source: unknown) {
    const profile = record(source);
    const status = normalizeUserId(profile.friendRequestStatus).toLowerCase();
    return {
        incoming:
            Boolean(profile?.incomingRequest) || status.includes('incoming'),
        outgoing:
            Boolean(profile?.outgoingRequest) || status.includes('outgoing')
    };
}
