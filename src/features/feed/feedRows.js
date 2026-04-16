export const UNKNOWN_FEED_USER_DISPLAY_NAME = 'Unknown';

export function normalizeFeedId(value) {
    return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

export function isUserIdLike(value) {
    return /^usr_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        normalizeFeedId(value)
    );
}

export function resolveDisplayNameCandidate(value, userId) {
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

export function resolveFeedUserId(row) {
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

export function resolveFeedUserDisplayName(row, friend, cachedDisplayName = '') {
    const userId = resolveFeedUserId(row);
    const rowDisplayName = resolveDisplayNameCandidate(row?.displayName, userId);
    const friendDisplayName = resolveDisplayNameCandidate(friend?.displayName || friend?.username, userId);
    const logDisplayName = resolveDisplayNameCandidate(cachedDisplayName, userId);
    if (rowDisplayName) {
        return rowDisplayName;
    }
    if (friendDisplayName) {
        return friendDisplayName;
    }
    return logDisplayName || UNKNOWN_FEED_USER_DISPLAY_NAME;
}

export function normalizePresenceState(value) {
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

export function resolveFeedFriendStateBucket(friend, currentUserSnapshot) {
    const friendId = normalizeFeedId(friend?.id || friend?.userId);
    const explicitState = normalizePresenceState(friend?.stateBucket || friend?.state);
    if (explicitState === 'online' || explicitState === 'active' || explicitState === 'offline') {
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

export function canRequestInviteFromFeedFriend(friend, currentUserSnapshot) {
    return resolveFeedFriendStateBucket(friend, currentUserSnapshot) === 'online';
}

export function resolveFeedCurrentInviteLocation(gameState, currentUserSnapshot) {
    const currentLocation = normalizeFeedId(gameState?.currentLocation);
    if (currentLocation === 'traveling') {
        return normalizeFeedId(gameState?.currentDestination);
    }

    return (
        currentLocation ||
        normalizeFeedId(gameState?.currentDestination) ||
        normalizeFeedId(currentUserSnapshot?.$locationTag || currentUserSnapshot?.location)
    );
}

export function buildFeedFavoriteIdSet(remoteFavoritesById, localFriendFavorites, selectedFavoriteGroupIds = []) {
    const ids = new Set();
    const selectedGroups = Array.isArray(selectedFavoriteGroupIds) ? selectedFavoriteGroupIds : [];
    const hasRemoteGroupFilter = selectedGroups.some((groupKey) => !String(groupKey || '').startsWith('local:'));

    for (const favorite of Object.values(remoteFavoritesById ?? {})) {
        if (favorite?.type !== 'friend') {
            continue;
        }
        if (hasRemoteGroupFilter && !selectedGroups.includes(favorite.$groupKey)) {
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

export function feedSearchMatches(row, search) {
    const query = String(search || '').trim().toUpperCase();
    if (!query) {
        return true;
    }
    if ((query.startsWith('WRLD_') || query.startsWith('GRP_')) && String(row?.location || '').toUpperCase().includes(query)) {
        return true;
    }
    return [
        row?.displayName,
        row?.worldName,
        row?.groupName,
        row?.status,
        row?.statusDescription,
        row?.previousStatus,
        row?.previousStatusDescription,
        row?.bio,
        row?.previousBio,
        row?.avatarName,
        row?.message
    ].some((value) => String(value || '').toUpperCase().includes(query));
}

export function toIsoRangeStart(value) {
    if (!value) {
        return '';
    }

    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.valueOf()) ? '' : date.toISOString();
}

export function toIsoRangeEnd(value) {
    if (!value) {
        return '';
    }

    const date = new Date(`${value}T23:59:59.999`);
    return Number.isNaN(date.valueOf()) ? '' : date.toISOString();
}

export function feedEntryMatchesView({
    currentUserId,
    row,
    activeFilters,
    dateFrom,
    dateTo,
    favoriteIdSet,
    favoritesOnly,
    search
}) {
    if (!row || typeof row !== 'object') {
        return false;
    }
    if (row.ownerUserId && row.ownerUserId !== currentUserId) {
        return false;
    }
    if (Array.isArray(activeFilters) && activeFilters.length && !activeFilters.includes(row.type)) {
        return false;
    }
    if (favoritesOnly && !favoriteIdSet.has(normalizeFeedId(row.userId))) {
        return false;
    }
    const start = toIsoRangeStart(dateFrom);
    const end = toIsoRangeEnd(dateTo);
    const createdAt = String(row.created_at || '');
    if (start && createdAt && createdAt < start) {
        return false;
    }
    if (end && createdAt && createdAt > end) {
        return false;
    }
    return feedSearchMatches(row, search);
}

export function getFeedRowId(row) {
    if (row?.id != null) {
        return `id:${row.id}`;
    }
    if (row?.rowId != null) {
        return `row:${row.rowId}`;
    }
    const type = row?.type ?? '';
    const createdAt = row?.created_at ?? row?.createdAt ?? '';
    const userId = row?.userId ?? row?.senderUserId ?? '';
    const location = row?.location ?? row?.details?.location ?? '';
    const message = row?.message ?? '';
    return `${type}:${createdAt}:${userId}:${location}:${message}`;
}

export function collectMatchingLiveFeedEntries(entries, minSequence, context) {
    const unseenEntries = (Array.isArray(entries) ? entries : [])
        .filter((item) => item.sequence > minSequence);
    if (!unseenEntries.length) {
        return {
            matchingEntries: [],
            maxSequence: minSequence
        };
    }

    const matchingEntries = unseenEntries
        .map((item) => item.entry)
        .filter((entry) => feedEntryMatchesView({
            ...context,
            row: entry
        }));

    return {
        matchingEntries,
        maxSequence: Math.max(...unseenEntries.map((item) => item.sequence))
    };
}

export function mergeLiveFeedEntries(rows, matchingEntries, maxRows) {
    const nextRowsById = new Map();
    for (const entry of [...matchingEntries].reverse()) {
        nextRowsById.set(getFeedRowId(entry), entry);
    }
    for (const row of Array.isArray(rows) ? rows : []) {
        const rowId = getFeedRowId(row);
        if (!nextRowsById.has(rowId)) {
            nextRowsById.set(rowId, row);
        }
    }
    return Array.from(nextRowsById.values()).slice(0, maxRows);
}

export function parseDateInput(value) {
    const normalizedValue = normalizeFeedId(value);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedValue)) {
        return undefined;
    }
    const [year, month, day] = normalizedValue.split('-').map((part) => Number.parseInt(part, 10));
    const date = new Date(year, month - 1, day);
    return Number.isNaN(date.valueOf()) ? undefined : date;
}

export function toDateInputValue(date) {
    if (!(date instanceof Date) || Number.isNaN(date.valueOf())) {
        return '';
    }
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

export function resolveFeedStatusMeta(status) {
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
