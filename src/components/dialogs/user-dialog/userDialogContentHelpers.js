import { AppleIcon, MonitorIcon, SmartphoneIcon } from 'lucide-react';

import { parseLocation, resolveFriendPresenceLocation } from '@/shared/utils/location.js';

import { normalizeUserId } from './userProfileFields.js';

export function isGroupId(value) {
    return normalizeUserId(value).startsWith('grp_');
}

export function groupSeed(value) {
    if (!value || typeof value !== 'object') {
        return null;
    }
    const groupId = normalizeUserId(
        value.groupId || value.group_id || value.id
    );
    return isGroupId(groupId) ? value : null;
}

export function groupDisplayName(...values) {
    const fallback = [];
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

export function hasGroupProfileDetails(group, fallback = {}) {
    if (!group || typeof group !== 'object') {
        return false;
    }
    const nestedGroup =
        group.group && typeof group.group === 'object' ? group.group : {};
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

export function resolvePlatformMeta(platform) {
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
            icon: SmartphoneIcon
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

export function resolvePresenceLocation(profile) {
    return resolveFriendPresenceLocation(profile);
}

export function isSameLocationTag(left, right) {
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

export function userDisplayName(user) {
    if (typeof user === 'string') {
        return normalizeUserId(user);
    }
    return normalizeUserId(
        user?.displayName ||
            user?.display_name ||
            user?.username ||
            user?.name ||
            user?.user?.displayName ||
            user?.user?.display_name ||
            user?.user?.username ||
            user?.user?.name ||
            user?.userId ||
            user?.user_id ||
            user?.id ||
            user?.user?.id ||
            user?.user?.userId ||
            user?.user?.user_id
    );
}

export function createLocationUserRow(user, fallback = {}) {
    const source =
        typeof user === 'string'
            ? { id: user, userId: user, displayName: user }
            : user || {};
    const userId = normalizeUserId(
        source.id ||
            source.userId ||
            source.user_id ||
            source.targetUserId ||
            source.target_user_id ||
            source.user?.id ||
            source.user?.userId ||
            source.user?.user_id ||
            fallback.id ||
            fallback.userId ||
            fallback.user_id
    );
    const displayName =
        userDisplayName(source) ||
        normalizeUserId(fallback.displayName || fallback.display_name) ||
        userId;
    return {
        ...(source && typeof source === 'object' ? source : {}),
        id: userId,
        userId,
        displayName,
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

export function createLocationGroupRow(group, fallback = {}) {
    const source =
        typeof group === 'string'
            ? { id: group, groupId: group, name: group }
            : group || {};
    const nestedGroup =
        source.group && typeof source.group === 'object' ? source.group : {};
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

export function mergeLocationUser(rowsById, user, fallback = {}) {
    const row = createLocationUserRow(user, fallback);
    const key = row.id || `display:${row.displayName}`;
    if (!key || rowsById.has(key)) {
        return;
    }
    rowsById.set(key, row);
}

export function pushLocationUserSource(source, push) {
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
        if (
            source.id ||
            source.userId ||
            source.user_id ||
            source.targetUserId ||
            source.target_user_id ||
            source.displayName ||
            source.display_name ||
            source.username ||
            source.name ||
            source.user?.id ||
            source.user?.userId ||
            source.user?.displayName ||
            source.user?.username
        ) {
            push(source);
            return;
        }
        for (const value of Object.values(source)) {
            pushLocationUserSource(value, push);
        }
        return;
    }
    push(source);
}

export function resolveCurrentInviteLocation(gameState, currentUserSnapshot) {
    const currentLocation = normalizeUserId(gameState?.currentLocation);
    if (currentLocation === 'traveling') {
        return normalizeUserId(gameState?.currentDestination);
    }
    return (
        currentLocation ||
        normalizeUserId(gameState?.currentDestination) ||
        normalizeUserId(
            currentUserSnapshot?.$locationTag || currentUserSnapshot?.location
        )
    );
}

export function instanceLocation(instance) {
    const source = instance?.instance || instance;
    return normalizeUserId(
        source?.location ||
            source?.tag ||
            source?.$location?.tag ||
            instance?.location ||
            instance?.tag ||
            instance?.$location?.tag
    );
}

export function locationCacheKey(location) {
    const parsed = parseLocation(location);
    if (!parsed.worldId || !parsed.instanceId) {
        return '';
    }
    return `${parsed.worldId}:${parsed.instanceId}`;
}

export function buildCachedInstanceMap(instances) {
    const map = new Map();
    for (const instance of Array.isArray(instances) ? instances : []) {
        const source = instance?.instance || instance;
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

export function resolveFriendRequestState(profile) {
    const status = normalizeUserId(profile?.friendRequestStatus).toLowerCase();
    return {
        incoming:
            Boolean(profile?.incomingRequest) || status.includes('incoming'),
        outgoing:
            Boolean(profile?.outgoingRequest) || status.includes('outgoing')
    };
}
