export const UNKNOWN_FEED_USER_DISPLAY_NAME = 'Unknown';

export function normalizeFeedId(value: any) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

export function isUserIdLike(value: any) {
    return /^usr_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        normalizeFeedId(value)
    );
}

export function resolveDisplayNameCandidate(value: any, userId: any) {
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

export function resolveFeedUserId(row: any) {
    const directUserId = normalizeFeedId(
        row?.userId ||
            row?.senderUserId ||
            row?.sender_user_id ||
            row?.receiverUserId ||
            row?.receiver_user_id ||
            row?.targetUserId ||
            row?.target_user_id ||
            row?.user?.id ||
            row?.user?.userId
    );
    if (directUserId) {
        return directUserId;
    }

    for (const candidate of [row?.displayName, row?.username, row?.name]) {
        const normalized = normalizeFeedId(candidate);
        if (isUserIdLike(normalized)) {
            return normalized;
        }
    }

    return '';
}

export function resolveFeedUserDisplayName(
    row: any,
    friend: any,
    cachedDisplayName: any = ''
) {
    const userId = resolveFeedUserId(row);
    const rowDisplayName = resolveDisplayNameCandidate(
        row?.displayName,
        userId
    );
    const friendDisplayName = resolveDisplayNameCandidate(
        friend?.displayName || friend?.username,
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

export function normalizePresenceState(value: any) {
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

export function resolveFeedLocationForDisplay(row: any) {
    const type = normalizeFeedId(row?.type);
    const location = normalizeFeedId(row?.location);
    if (type === 'Online' && normalizePresenceState(location) === 'offline') {
        return '';
    }
    return location;
}

export function resolveFeedFriendStateBucket(
    friend: any,
    currentUserSnapshot: any
) {
    const friendId = normalizeFeedId(friend?.id || friend?.userId);
    const explicitState = normalizePresenceState(
        friend?.stateBucket || friend?.state
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
    if ((currentUserSnapshot?.onlineFriends || []).includes(friendId)) {
        return 'online';
    }
    if ((currentUserSnapshot?.activeFriends || []).includes(friendId)) {
        return 'active';
    }
    if ((currentUserSnapshot?.offlineFriends || []).includes(friendId)) {
        return 'offline';
    }
    return '';
}

export function canRequestInviteFromFeedFriend(
    friend: any,
    currentUserSnapshot: any
) {
    return (
        resolveFeedFriendStateBucket(friend, currentUserSnapshot) === 'online'
    );
}

export function resolveFeedCurrentInviteLocation(
    gameState: any,
    currentUserSnapshot: any
) {
    const currentLocation = normalizeFeedId(gameState?.currentLocation);
    if (currentLocation === 'traveling') {
        return normalizeFeedId(gameState?.currentDestination);
    }

    return (
        currentLocation ||
        normalizeFeedId(gameState?.currentDestination) ||
        normalizeFeedId(
            currentUserSnapshot?.$locationTag || currentUserSnapshot?.location
        )
    );
}

export function buildFeedFavoriteIdSet(
    remoteFavoritesById: any,
    localFriendFavorites: any,
    selectedFavoriteGroupIds: any[] = []
) {
    const ids = new Set();
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
        (groupKey: any) => !String(groupKey || '').startsWith('local:')
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

export function toIsoRangeStart(value: any) {
    if (!value) {
        return '';
    }

    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.valueOf()) ? '' : date.toISOString();
}

export function toIsoRangeEnd(value: any) {
    if (!value) {
        return '';
    }

    const date = new Date(`${value}T23:59:59.999`);
    return Number.isNaN(date.valueOf()) ? '' : date.toISOString();
}

export function getFeedRowId(row: any) {
    if (row?.id != null) {
        return `id:${row.id}`;
    }
    const rowId = row?.rowId ?? row?.row_id;
    if (rowId != null) {
        const sourceRank = row?.sourceRank ?? row?.source_rank;
        if (sourceRank != null) {
            return `row:${row?.type ?? ''}:${sourceRank}:${rowId}`;
        }
        return `row:${row?.type ?? ''}:${rowId}`;
    }
    const type = row?.type ?? '';
    const createdAt = row?.created_at ?? row?.createdAt ?? '';
    const userId = row?.userId ?? row?.senderUserId ?? '';
    const location = row?.location ?? row?.details?.location ?? '';
    const message = row?.message ?? '';
    return `${type}:${createdAt}:${userId}:${location}:${message}`;
}

export function parseDateInput(value: any) {
    const normalizedValue = normalizeFeedId(value);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedValue)) {
        return undefined;
    }
    const [year, month, day] = normalizedValue
        .split('-')
        .map((part: any) => Number.parseInt(part, 10));
    const date = new Date(year, month - 1, day);
    return Number.isNaN(date.valueOf()) ? undefined : date;
}

export function toDateInputValue(date: any) {
    if (!(date instanceof Date) || Number.isNaN(date.valueOf())) {
        return '';
    }
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

export function resolveFeedStatusMeta(status: any) {
    switch (status) {
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
            return { label: status || 'Offline', className: '' };
    }
}
