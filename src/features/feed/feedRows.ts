import type { FriendRecordInput } from '@/domain/friends/friendRosterTypes';
import { isUserId } from '@/shared/constants/vrchatIds';
export { resolveCurrentInviteLocation as resolveFeedCurrentInviteLocation } from '@/shared/utils/invite';
import type {
    FavoriteGroupMap,
    FavoriteRecord
} from '@/state/favoriteStoreTypes';

import type { FeedRow } from './feedTypes';

export const UNKNOWN_FEED_USER_DISPLAY_NAME = 'Unknown';

type FeedRecord = Record<string, unknown>;
type FeedRowLike = FeedRecord | null | undefined;
type FriendLike = FriendRecordInput | FeedRecord | null | undefined;
type CurrentUserSnapshotLike =
    | (FeedRecord & {
          activeFriends?: unknown;
          offlineFriends?: unknown;
          onlineFriends?: unknown;
      })
    | null
    | undefined;
function isRecord(value: unknown): value is FeedRecord {
    return Boolean(value && typeof value === 'object');
}

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

export function resolveDisplayNameCandidate(value: unknown, userId: unknown) {
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

export function resolveFeedUserId(row: FeedRowLike) {
    const user = recordValue(row, 'user');
    const directUserId = normalizeFeedId(
        recordValue(row, 'userId') ||
            recordValue(row, 'senderUserId') ||
            recordValue(row, 'sender_user_id') ||
            recordValue(row, 'receiverUserId') ||
            recordValue(row, 'receiver_user_id') ||
            recordValue(row, 'targetUserId') ||
            recordValue(row, 'target_user_id') ||
            recordValue(user, 'id') ||
            recordValue(user, 'userId')
    );
    if (directUserId) {
        return directUserId;
    }

    for (const candidate of [
        recordValue(row, 'displayName'),
        recordValue(row, 'username'),
        recordValue(row, 'name')
    ]) {
        const normalized = normalizeFeedId(candidate);
        if (isUserIdLike(normalized)) {
            return normalized;
        }
    }

    return '';
}

export function resolveFeedUserDisplayName(
    row: FeedRowLike,
    friend: FriendLike,
    cachedDisplayName: unknown = ''
) {
    const userId = resolveFeedUserId(row);
    const rowDisplayName = resolveDisplayNameCandidate(
        recordValue(row, 'displayName'),
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

export function normalizePresenceState(value: unknown) {
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

export function resolveFeedLocationForDisplay(row: FeedRowLike) {
    const type = normalizeFeedId(recordValue(row, 'type'));
    const location = normalizeFeedId(recordValue(row, 'location'));
    if (type === 'Online' && normalizePresenceState(location) === 'offline') {
        return '';
    }
    return location;
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
                String(row.statusDescription || '') !==
                String(row.previousStatusDescription || '')
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
    selectedFavoriteGroupIds: unknown[] = []
) {
    const ids = new Set<string>();
    const remoteFavorites =
        remoteFavoritesById && typeof remoteFavoritesById === 'object'
            ? Object.values(remoteFavoritesById).filter(
                  (favorite): favorite is Record<string, unknown> =>
                      Boolean(favorite && typeof favorite === 'object')
              )
            : [];
    const selectedGroups = Array.isArray(selectedFavoriteGroupIds)
        ? selectedFavoriteGroupIds
        : [];
    const hasRemoteGroupFilter = selectedGroups.some(
        (groupKey) => !String(groupKey || '').startsWith('local:')
    );

    for (const favorite of remoteFavorites) {
        if (favorite?.type !== 'friend') {
            continue;
        }
        if (
            hasRemoteGroupFilter &&
            !selectedGroups.includes(favorite.$groupKey)
        ) {
            continue;
        }
        const favoriteId = normalizeFeedId(favorite.favoriteId);
        if (favoriteId) {
            ids.add(favoriteId);
        }
    }

    for (const groupIds of Object.values(localFriendFavorites ?? {})) {
        if (!Array.isArray(groupIds)) {
            continue;
        }
        for (const id of groupIds) {
            const normalized = normalizeFeedId(id);
            if (normalized) {
                ids.add(normalized);
            }
        }
    }
    return ids;
}

export function toIsoRangeStart(value: unknown) {
    if (!value) {
        return '';
    }

    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.valueOf()) ? '' : date.toISOString();
}

export function toIsoRangeEnd(value: unknown) {
    if (!value) {
        return '';
    }

    const date = new Date(`${value}T23:59:59.999`);
    return Number.isNaN(date.valueOf()) ? '' : date.toISOString();
}

export function getFeedRowId(row: FeedRowLike) {
    if (recordValue(row, 'id') != null) {
        return `id:${recordValue(row, 'id')}`;
    }
    const rowId = recordValue(row, 'rowId') ?? recordValue(row, 'row_id');
    if (rowId != null) {
        const sourceRank =
            recordValue(row, 'sourceRank') ?? recordValue(row, 'source_rank');
        if (sourceRank != null) {
            return `row:${recordValue(row, 'type') ?? ''}:${sourceRank}:${rowId}`;
        }
        return `row:${recordValue(row, 'type') ?? ''}:${rowId}`;
    }
    const details = recordValue(row, 'details');
    const type = recordValue(row, 'type') ?? '';
    const createdAt =
        recordValue(row, 'created_at') ?? recordValue(row, 'createdAt') ?? '';
    const userId =
        recordValue(row, 'userId') ?? recordValue(row, 'senderUserId') ?? '';
    const location =
        recordValue(row, 'location') ?? recordValue(details, 'location') ?? '';
    const message = recordValue(row, 'message') ?? '';
    return `${type}:${createdAt}:${userId}:${location}:${message}`;
}

export function parseDateInput(value: unknown) {
    const normalizedValue = normalizeFeedId(value);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedValue)) {
        return undefined;
    }
    const [year, month, day] = normalizedValue
        .split('-')
        .map((part) => Number.parseInt(part, 10));
    const date = new Date(year, month - 1, day);
    return Number.isNaN(date.valueOf()) ? undefined : date;
}

export function toDateInputValue(date: unknown) {
    if (!(date instanceof Date) || Number.isNaN(date.valueOf())) {
        return '';
    }
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

export function resolveFeedStatusMeta(status: unknown) {
    const normalizedStatus = normalizeFeedId(status);
    switch (normalizedStatus) {
        case 'active':
            return { label: 'Online', className: 'bg-[var(--status-online)]' };
        case 'join me':
        case 'joinme':
            return { label: 'Join Me', className: 'bg-[var(--status-joinme)]' };
        case 'ask me':
        case 'askme':
            return { label: 'Ask Me', className: 'bg-[var(--status-askme)]' };
        case 'busy':
            return { label: 'Busy', className: 'bg-[var(--status-busy)]' };
        default:
            return { label: normalizedStatus || 'Offline', className: '' };
    }
}
