import type { FriendRecordInput } from '@/domain/friends/types';
import { isUserId } from '@/shared/constants/vrchatIds';
import { isRecord } from '@/shared/utils/record';
export { resolveCurrentInviteLocation as resolveFeedCurrentInviteLocation } from '@/shared/utils/invite';
import type {
    FavoriteGroupMap,
    FavoriteRecord
} from '@/domain/favorites/types';
import {
    SOLID_USER_STATUS_DOT_CLASS_NAMES,
    userStatusFromValue
} from '@/shared/utils/friendStatus';

import type { FeedRow } from './feedTypes';

export const UNKNOWN_FEED_USER_DISPLAY_NAME = 'Unknown';

type FeedRecord = Record<string, unknown>;
type FriendLike = FriendRecordInput | FeedRecord | null | undefined;
type CurrentUserSnapshotLike =
    | (FeedRecord & {
          activeFriends?: string[];
          offlineFriends?: string[];
          onlineFriends?: string[];
      })
    | null
    | undefined;
function recordValue(value: unknown, key: string): unknown {
    return isRecord(value) ? value[key] : undefined;
}

function recordListIncludes(value: unknown, target: string): boolean {
    return (
        Array.isArray(value) &&
        value.some((entry) => normalizeFeedId(entry) === target)
    );
}

export function normalizeFeedId(value: unknown) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

export function isUserIdLike(value: unknown) {
    return isUserId(normalizeFeedId(value));
}

export function resolveDisplayNameCandidate(value: unknown, userId: string) {
    const normalized = normalizeFeedId(value);
    if (
        !normalized ||
        normalized === normalizeFeedId(userId) ||
        normalized === UNKNOWN_FEED_USER_DISPLAY_NAME ||
        isUserIdLike(normalized)
    ) {
        return '';
    }
    return normalized;
}

export function resolveFeedUserId(row: FeedRow | null | undefined) {
    const directUserId = normalizeFeedId(row?.userId);
    if (directUserId) {
        return directUserId;
    }

    const displayName = normalizeFeedId(row?.displayName);
    return isUserIdLike(displayName) ? displayName : '';
}

export function resolveFeedUserDisplayName(
    row: FeedRow | null | undefined,
    friend: FriendLike,
    cachedDisplayName: string = ''
) {
    const userId = resolveFeedUserId(row);
    const rowDisplayName = resolveDisplayNameCandidate(
        row?.displayName,
        userId
    );
    const friendDisplayName = resolveDisplayNameCandidate(
        recordValue(friend, 'displayName') || recordValue(friend, 'username'),
        userId
    );
    const logDisplayName = resolveDisplayNameCandidate(
        cachedDisplayName,
        userId
    );
    if (rowDisplayName) {
        return rowDisplayName;
    }
    if (friendDisplayName) {
        return friendDisplayName;
    }
    return logDisplayName || UNKNOWN_FEED_USER_DISPLAY_NAME;
}

function normalizePresenceState(value: unknown) {
    const state = normalizeFeedId(value).toLowerCase();
    if (state === 'offline:offline' || state.startsWith('offline ')) {
        return 'offline';
    }
    if (state === 'private:private') {
        return 'private';
    }
    if (state === 'traveling:traveling') {
        return 'traveling';
    }
    return state;
}

export function resolveFeedLocationForDisplay(row: FeedRow | null | undefined) {
    const type = normalizeFeedId(row?.type);
    const location = normalizeFeedId(row?.location);
    if (type === 'Online' && normalizePresenceState(location) === 'offline') {
        return '';
    }
    return location;
}

const feedRowCreatedAtMsCache = new WeakMap<FeedRow, number>();

export function getFeedRowCreatedAtMs(row: FeedRow | null | undefined): number {
    if (!row) {
        return 0;
    }
    const cached = feedRowCreatedAtMsCache.get(row);
    if (cached !== undefined) {
        return cached;
    }
    const parsed = new Date(row.created_at || 0).valueOf() || 0;
    feedRowCreatedAtMsCache.set(row, parsed);
    return parsed;
}

export function canExpandFeedRow(row: FeedRow): boolean {
    const type = normalizeFeedId(row.type);
    switch (type) {
        case 'GPS':
            return Boolean(row.previousLocation);
        case 'Online':
        case 'Offline':
            return false;
        case 'Status':
            return (
                (row.statusDescription || '') !==
                (row.previousStatusDescription || '')
            );
        case 'Avatar':
            return Boolean(
                row.previousCurrentAvatarThumbnailImageUrl ||
                row.previousCurrentAvatarImageUrl ||
                row.currentAvatarThumbnailImageUrl ||
                row.currentAvatarImageUrl
            );
        case 'Bio':
            return Boolean(row.bio || row.previousBio);
        default:
            return false;
    }
}

export function resolveFeedFriendStateBucket(
    friend: FriendLike,
    currentUserSnapshot: CurrentUserSnapshotLike
) {
    const friendId = normalizeFeedId(
        recordValue(friend, 'id') || recordValue(friend, 'userId')
    );
    const explicitState = normalizePresenceState(
        recordValue(friend, 'stateBucket') || recordValue(friend, 'state')
    );
    if (
        explicitState === 'online' ||
        explicitState === 'active' ||
        explicitState === 'offline'
    ) {
        return explicitState;
    }
    if (!friendId) {
        return '';
    }
    if (
        recordListIncludes(
            recordValue(currentUserSnapshot, 'onlineFriends'),
            friendId
        )
    ) {
        return 'online';
    }
    if (
        recordListIncludes(
            recordValue(currentUserSnapshot, 'activeFriends'),
            friendId
        )
    ) {
        return 'active';
    }
    if (
        recordListIncludes(
            recordValue(currentUserSnapshot, 'offlineFriends'),
            friendId
        )
    ) {
        return 'offline';
    }
    return '';
}

export function canRequestInviteFromFeedFriend(
    friend: FriendLike,
    currentUserSnapshot: CurrentUserSnapshotLike
) {
    return (
        resolveFeedFriendStateBucket(friend, currentUserSnapshot) === 'online'
    );
}

export function buildFeedFavoriteIdSet(
    remoteFavoritesById: Record<string, FavoriteRecord> | null | undefined,
    localFriendFavorites: FavoriteGroupMap | null | undefined,
    selectedFavoriteGroupIds: readonly string[] = []
) {
    const ids = new Set<string>();
    const remoteFavorites = Object.values(remoteFavoritesById ?? {});
    const hasRemoteGroupFilter = selectedFavoriteGroupIds.some(
        (groupKey) => !groupKey.startsWith('local:')
    );

    for (const favorite of remoteFavorites) {
        if (favorite?.type !== 'friend') {
            continue;
        }
        if (
            hasRemoteGroupFilter &&
            !selectedFavoriteGroupIds.includes(favorite.$groupKey ?? '')
        ) {
            continue;
        }
        const favoriteId = normalizeFeedId(favorite.favoriteId);
        if (favoriteId) {
            ids.add(favoriteId);
        }
    }

    for (const groupIds of Object.values(localFriendFavorites ?? {})) {
        for (const id of groupIds) {
            const normalized = normalizeFeedId(id);
            if (normalized) {
                ids.add(normalized);
            }
        }
    }
    return ids;
}

export function getFeedRowId(row: FeedRow | null | undefined) {
    const type = row?.type ?? '';
    if (row?.rowId != null) {
        return `row:${type}:${row.sourceRank ?? ''}:${row.rowId}`;
    }
    return `${type}:${row?.created_at ?? ''}:${row?.userId ?? ''}:${row?.location ?? ''}`;
}

export function resolveFeedStatusMeta(status: string | null | undefined) {
    const normalizedStatus = userStatusFromValue(status);
    switch (normalizedStatus) {
        case 'active':
            return {
                label: 'Online',
                className: SOLID_USER_STATUS_DOT_CLASS_NAMES.active
            };
        case 'join me':
            return {
                label: 'Join Me',
                className: SOLID_USER_STATUS_DOT_CLASS_NAMES['join me']
            };
        case 'ask me':
            return {
                label: 'Ask Me',
                className: SOLID_USER_STATUS_DOT_CLASS_NAMES['ask me']
            };
        case 'busy':
            return {
                label: 'Busy',
                className: SOLID_USER_STATUS_DOT_CLASS_NAMES.busy
            };
        default:
            return { label: normalizedStatus || 'Offline', className: '' };
    }
}
