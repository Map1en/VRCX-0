import removeConfusables, { removeWhitespace } from '@/services/confusables.js';

export const FRIEND_LIST_DEFAULT_SEARCH_FILTER_IDS = [
    'displayName',
    'rank',
    'status',
    'bio',
    'note',
    'memo'
];

export function normalizeFriendListId(value) {
    return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

export function buildFriendListFavoriteIdSet(remoteFavoriteIds, localFriendFavorites) {
    const set = new Set();
    for (const id of remoteFavoriteIds ?? []) {
        const normalized = normalizeFriendListId(id);
        if (normalized) {
            set.add(normalized);
        }
    }
    for (const values of Object.values(localFriendFavorites ?? {})) {
        if (!Array.isArray(values)) {
            continue;
        }
        for (const id of values) {
            const normalized = normalizeFriendListId(id);
            if (normalized) {
                set.add(normalized);
            }
        }
    }
    return set;
}

export function buildFriendListUserStatsById(statsRows, rosterRows) {
    const dataByDisplayName = new Map();
    const friendsByDisplayName = new Map();
    const statsById = new Map();

    for (const row of Array.isArray(statsRows) ? statsRows : []) {
        const displayName = String(row?.displayName || '').trim();
        const userId = normalizeFriendListId(row?.userId);
        if (displayName && userId) {
            dataByDisplayName.set(displayName, userId);
        }
    }

    for (const friend of Array.isArray(rosterRows) ? rosterRows : []) {
        const displayName = String(friend?.displayName || '').trim();
        const userId = normalizeFriendListId(friend?.id);
        if (displayName && userId) {
            friendsByDisplayName.set(displayName, userId);
        }
    }

    for (const row of Array.isArray(statsRows) ? statsRows : []) {
        const displayName = String(row?.displayName || '').trim();
        const userId =
            normalizeFriendListId(row?.userId) ||
            normalizeFriendListId(dataByDisplayName.get(displayName)) ||
            normalizeFriendListId(friendsByDisplayName.get(displayName));
        if (!userId) {
            continue;
        }

        const current = statsById.get(userId);
        const next = {
            lastSeen: row?.lastSeen || '',
            timeSpent: Number(row?.timeSpent) || 0,
            joinCount: Number(row?.joinCount) || 0,
            displayName
        };
        if (!current) {
            statsById.set(userId, next);
            continue;
        }

        if (Date.parse(next.lastSeen) > Date.parse(current.lastSeen)) {
            current.lastSeen = next.lastSeen;
        }
        current.timeSpent += next.timeSpent;
        current.joinCount += next.joinCount;
        current.displayName = next.displayName || current.displayName;
    }

    return statsById;
}

export function friendNumberForSort(friend) {
    return Number.parseInt(friend?.$friendNumber ?? friend?.friendNumber ?? 0, 10) || 0;
}

export function matchesFriendListSearch(
    friend,
    searchQuery,
    activeSearchFilters,
    userMemoById,
    userNoteById
) {
    if (!searchQuery) {
        return true;
    }

    const filters = activeSearchFilters.size
        ? activeSearchFilters
        : new Set(FRIEND_LIST_DEFAULT_SEARCH_FILTER_IDS);
    const query = searchQuery.trim();
    if (!query) {
        return true;
    }

    const loweredQuery = query.toLowerCase();
    const cleanedQuery = removeWhitespace(loweredQuery);
    const uppercaseQuery = query.toUpperCase();

    if (filters.has('displayName')) {
        const displayName = String(friend?.displayName || '');
        const condensedDisplayName = removeWhitespace(displayName).toLowerCase();
        const normalizedDisplayName = removeConfusables(displayName).toLowerCase();
        if (
            condensedDisplayName.includes(cleanedQuery) ||
            normalizedDisplayName.includes(cleanedQuery)
        ) {
            return true;
        }
    }

    if (
        filters.has('username') &&
        String(friend?.username || '').toLowerCase().includes(loweredQuery)
    ) {
        return true;
    }

    if (
        filters.has('rank') &&
        String(friend?.$trustLevel || '').toUpperCase().includes(uppercaseQuery)
    ) {
        return true;
    }

    if (
        filters.has('status') &&
        `${friend?.statusDescription || ''} ${friend?.status || ''} ${friend?.stateBucket || ''}`
            .toLowerCase()
            .includes(loweredQuery)
    ) {
        return true;
    }

    if (
        filters.has('bio') &&
        String(friend?.bio || '').toLowerCase().includes(loweredQuery)
    ) {
        return true;
    }

    if (
        filters.has('note') &&
        String(userNoteById.get(normalizeFriendListId(friend?.id)) || friend?.note || '')
            .toLowerCase()
            .includes(loweredQuery)
    ) {
        return true;
    }

    if (
        filters.has('memo') &&
        String(userMemoById.get(normalizeFriendListId(friend?.id)) || friend?.memo || friend?.$memo || '')
            .toLowerCase()
            .includes(loweredQuery)
    ) {
        return true;
    }

    return false;
}

export function filterFriendListRows({
    rosterRows,
    favoritesOnly,
    favoriteFriendIds,
    searchQuery,
    activeSearchFilterIds,
    userMemoById,
    userNoteById
}) {
    return rosterRows.filter((friend) => {
        if (
            favoritesOnly &&
            !favoriteFriendIds.has(normalizeFriendListId(friend?.id))
        ) {
            return false;
        }
        return matchesFriendListSearch(
            friend,
            searchQuery,
            activeSearchFilterIds,
            userMemoById,
            userNoteById
        );
    });
}
