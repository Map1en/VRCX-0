// @ts-nocheck
import {
    parseLocation,
    resolveFriendPresenceLocation
} from '@/shared/utils/location.js';

export function firstText(...values) {
    for (const value of values) {
        const text =
            typeof value === 'string'
                ? value.trim()
                : String(value ?? '').trim();
        if (text) {
            return text;
        }
    }
    return '';
}

export function isGroupId(value) {
    return firstText(value).startsWith('grp_');
}

function isPresentValue(value) {
    return value !== undefined && value !== null && value !== '';
}

export function userIdForRosterRow(user) {
    return firstText(
        user?.id,
        user?.userId,
        user?.user_id,
        user?.targetUserId,
        user?.target_user_id
    );
}

export function userDisplayName(user) {
    if (typeof user === 'string') {
        return firstText(user);
    }
    return firstText(
        user?.displayName,
        user?.display_name,
        user?.username,
        user?.name,
        user?.user?.displayName,
        user?.user?.display_name,
        user?.user?.username,
        user?.user?.name,
        user?.userId,
        user?.user_id,
        user?.id,
        user?.user?.id,
        user?.user?.userId,
        user?.user?.user_id
    );
}

export function createInstanceUserRow(user, fallback = {}) {
    const fallbackUserId = firstText(
        fallback.id,
        fallback.userId,
        fallback.user_id
    );
    const source =
        typeof user === 'string'
            ? {
                  id: fallbackUserId || user,
                  userId: fallbackUserId || user,
                  displayName: user
              }
            : user || {};
    const nestedUser =
        source.user && typeof source.user === 'object' ? source.user : {};
    const userId = firstText(
        source.id,
        source.userId,
        source.user_id,
        source.targetUserId,
        source.target_user_id,
        nestedUser.id,
        nestedUser.userId,
        nestedUser.user_id,
        fallback.id,
        fallback.userId,
        fallback.user_id
    );
    const displayName =
        userDisplayName(source) ||
        firstText(fallback.displayName, fallback.display_name) ||
        userId;

    return {
        ...nestedUser,
        ...(source && typeof source === 'object' ? source : {}),
        id: userId || source.id,
        userId: source.userId || userId,
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
        $subtitle:
            fallback.subtitle || source.$subtitle || source.subtitle || '',
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

export function mergeInstanceUserRows(existing, incoming) {
    if (!existing) {
        return incoming;
    }
    if (!incoming) {
        return existing;
    }

    const merged = { ...incoming, ...existing };
    for (const [key, value] of Object.entries(incoming)) {
        if (!isPresentValue(merged[key]) && isPresentValue(value)) {
            merged[key] = value;
        }
    }
    return merged;
}

function rosterUserKey(user) {
    const id = userIdForRosterRow(user);
    if (id) {
        return id;
    }
    const displayName = userDisplayName(user);
    return displayName ? `display:${displayName.toLowerCase()}` : '';
}

export function mergeInstanceUser(rowsByKey, user, fallback = {}) {
    const row = createInstanceUserRow(user, fallback);
    const key = rosterUserKey(row);
    if (!key) {
        return;
    }
    const existing = rowsByKey.get(key);
    rowsByKey.set(key, existing ? mergeInstanceUserRows(existing, row) : row);
}

export function pushInstanceUserSource(source, push, fallback = {}) {
    const pushWithFallback = (value, fallback = {}) => {
        push(value, fallback);
    };
    if (!source) {
        return;
    }
    if (source instanceof Map) {
        for (const [key, value] of source.entries()) {
            pushInstanceUserSource(value, push, { id: key, userId: key });
        }
        return;
    }
    if (Array.isArray(source)) {
        for (const value of source) {
            pushInstanceUserSource(value, push);
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
            pushWithFallback(source, fallback);
            return;
        }
        for (const [key, value] of Object.entries(source)) {
            pushInstanceUserSource(value, push, { id: key, userId: key });
        }
        return;
    }
    pushWithFallback(source, fallback);
}

export function normalizeInstanceUsers(...sources) {
    const rows = [];
    for (const source of sources) {
        pushInstanceUserSource(source, (user, fallback) => {
            const row = createInstanceUserRow(user, fallback);
            if (rosterUserKey(row)) {
                rows.push(row);
            }
        });
    }
    return rows;
}

export function mergeInstanceUsers(...sources) {
    const rowsByKey = new Map();
    for (const user of normalizeInstanceUsers(...sources)) {
        mergeInstanceUser(rowsByKey, user);
    }
    return Array.from(rowsByKey.values());
}

export function isSameInstanceLocation(left, right) {
    const leftTag = firstText(left);
    const rightTag = firstText(right);
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

export function resolvePresenceLocation(profile, options) {
    return resolveFriendPresenceLocation(profile, options);
}

export function userHasExplicitSameInstance(user, location) {
    const explicitLocation = resolvePresenceLocation(user, {
        requireInstance: true
    });
    return isSameInstanceLocation(explicitLocation, location);
}

export function buildInstanceRosterRows({
    includeProfileFallback = false,
    instanceCreatorLabel = 'Instance creator',
    ownerFallbackId = '',
    ownerGroup = null,
    ownerUser = null,
    parsedLocation = null,
    profile = null,
    users = []
} = {}) {
    const rowsByKey = new Map();
    for (const user of users) {
        mergeInstanceUser(rowsByKey, user);
    }

    if (
        includeProfileFallback &&
        !rowsByKey.size &&
        parsedLocation?.isRealInstance
    ) {
        mergeInstanceUser(rowsByKey, profile);
    }

    const ownerUserId = userIdForRosterRow(ownerUser);
    const ownerGroupId = firstText(
        ownerGroup?.id,
        ownerGroup?.groupId,
        isGroupId(ownerFallbackId) ? ownerFallbackId : '',
        isGroupId(parsedLocation?.groupId) ? parsedLocation.groupId : ''
    );
    const ownerId = firstText(
        ownerGroupId,
        ownerUserId,
        ownerFallbackId,
        parsedLocation?.userId,
        parsedLocation?.groupId
    );
    const ownerIsGroup = Boolean(
        ownerGroupId || isGroupId(ownerUserId) || isGroupId(ownerId)
    );
    const ownerName = ownerIsGroup
        ? firstText(
              ownerGroup?.name,
              ownerGroup?.displayName,
              ownerGroup?.display_name,
              ownerGroup?.shortCode,
              ownerId
          )
        : firstText(
              ownerUser?.displayName,
              ownerUser?.username,
              ownerUser?.name,
              ownerId
          );
    const ownerRow =
        !ownerIsGroup && ownerUser
            ? createInstanceUserRow(ownerUser, {
                  subtitle: instanceCreatorLabel
              })
            : !ownerIsGroup && ownerId
              ? createInstanceUserRow(
                    {
                        id: ownerId,
                        userId: ownerId,
                        displayName: ownerName
                    },
                    { subtitle: instanceCreatorLabel }
                )
              : null;
    const ownerRowId = userIdForRosterRow(ownerRow);
    if (ownerRow) {
        mergeInstanceUser(rowsByKey, ownerRow);
    }
    const mergedOwnerRow = ownerRowId ? rowsByKey.get(ownerRowId) : null;
    const playerRows = Array.from(rowsByKey.values()).filter(
        (user) => !ownerRowId || userIdForRosterRow(user) !== ownerRowId
    );

    return {
        ownerId,
        ownerIsGroup,
        rows: mergedOwnerRow ? [mergedOwnerRow, ...playerRows] : playerRows
    };
}
