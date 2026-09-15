import type { FavoriteGroupMap } from '@/domain/favorites/types';
import type {
    FriendPatchEntry,
    FriendProfileFields,
    FriendRecordInput,
    FriendRosterBucket
} from '@/domain/friends/types';
import type { GameLogAllUserStatsRow } from '@/repositories/gameLogPersistenceRepository';
import removeConfusables, { removeWhitespace } from '@/services/confusables';

const FRIEND_LIST_DEFAULT_SEARCH_FILTER_IDS = [
    'displayName',
    'rank',
    'status',
    'bio',
    'note',
    'memo'
];

export type FriendListRow = FriendRecordInput &
    Partial<FriendProfileFields> & {
        $joinCount?: number;
        $lastSeen?: string;
        $mutualCount?: number | string;
        $mutualOptedOut?: boolean;
        $timeSpent?: number;
        friendNumber?: number;
        memo?: string;
        note?: string;
        state?: FriendRosterBucket;
        stateBucket?: FriendRosterBucket;
    };

export type FriendListUserStatsRow = GameLogAllUserStatsRow;

export type FriendListUserStats = {
    displayName: string;
    joinCount: number;
    lastSeen: string;
    timeSpent: number;
};

export type FriendListStatsPatch = FriendPatchEntry & {
    userId: string;
    patch: {
        $joinCount?: number;
        $lastSeen?: string;
        $mutualCount: number;
        $mutualOptedOut: boolean;
        $timeSpent?: number;
    };
    stateBucketAuthority: 'preserve';
};

type FriendNumberSource = {
    $friendNumber?: number | string;
    friendNumber?: number | string;
};

type FriendListFilterInput = {
    rosterRows: readonly FriendListRow[];
    favoritesOnly: boolean;
    favoriteFriendIds: ReadonlySet<string>;
    searchQuery: string;
    activeSearchFilterIds: ReadonlySet<string>;
    userMemoById: ReadonlyMap<string, string>;
    userNoteById: ReadonlyMap<string, string>;
};

export function normalizeFriendListId(value: string | null | undefined) {
    return (value ?? '').trim();
}

export function buildFriendListFavoriteIdSet(
    remoteFavoriteIds: readonly string[] = [],
    localFriendFavorites: FavoriteGroupMap = {}
): Set<string> {
    const set = new Set<string>();
    for (const id of remoteFavoriteIds ?? []) {
        const normalized = normalizeFriendListId(id);
        if (normalized) {
            set.add(normalized);
        }
    }
    for (const values of Object.values(localFriendFavorites ?? {})) {
        for (const id of values) {
            const normalized = normalizeFriendListId(id);
            if (normalized) {
                set.add(normalized);
            }
        }
    }
    return set;
}

export function buildFriendListUserStatsById(
    statsRows: readonly FriendListUserStatsRow[],
    rosterRows: readonly FriendListRow[]
): Map<string, FriendListUserStats> {
    const dataByDisplayName = new Map<string, string>();
    const friendsByDisplayName = new Map<string, string>();
    const statsById = new Map<string, FriendListUserStats>();

    for (const row of statsRows) {
        const displayName = row.displayName.trim();
        const userId = normalizeFriendListId(row.userId);
        if (displayName && userId) {
            dataByDisplayName.set(displayName, userId);
        }
    }

    for (const friend of rosterRows) {
        const displayName = String(friend?.displayName || '').trim();
        const userId = normalizeFriendListId(friend?.id);
        if (displayName && userId) {
            friendsByDisplayName.set(displayName, userId);
        }
    }

    for (const row of statsRows) {
        const displayName = row.displayName.trim();
        const userId =
            normalizeFriendListId(row.userId) ||
            normalizeFriendListId(dataByDisplayName.get(displayName)) ||
            normalizeFriendListId(friendsByDisplayName.get(displayName));
        if (!userId) {
            continue;
        }

        const current = statsById.get(userId);
        const next: FriendListUserStats = {
            lastSeen: row.lastSeen,
            timeSpent: row.timeSpent,
            joinCount: row.joinCount,
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

export function friendNumberForSort(friend: FriendNumberSource) {
    return (
        Number.parseInt(
            String(friend?.$friendNumber ?? friend?.friendNumber ?? 0),
            10
        ) || 0
    );
}

export function matchesFriendListSearch(
    friend: FriendListRow,
    searchQuery: string,
    activeSearchFilters: ReadonlySet<string>,
    userMemoById: ReadonlyMap<string, string>,
    userNoteById: ReadonlyMap<string, string>
): boolean {
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
        const condensedDisplayName =
            removeWhitespace(displayName).toLowerCase();
        const normalizedDisplayName =
            removeConfusables(displayName).toLowerCase();
        if (
            condensedDisplayName.includes(cleanedQuery) ||
            normalizedDisplayName.includes(cleanedQuery)
        ) {
            return true;
        }
    }

    if (
        filters.has('username') &&
        String(friend?.username || '')
            .toLowerCase()
            .includes(loweredQuery)
    ) {
        return true;
    }

    if (
        filters.has('rank') &&
        String(friend?.$trustLevel || '')
            .toUpperCase()
            .includes(uppercaseQuery)
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
        String(friend?.bio || '')
            .toLowerCase()
            .includes(loweredQuery)
    ) {
        return true;
    }

    if (
        filters.has('note') &&
        String(
            userNoteById.get(normalizeFriendListId(friend?.id)) ||
                friend?.note ||
                ''
        )
            .toLowerCase()
            .includes(loweredQuery)
    ) {
        return true;
    }

    if (
        filters.has('memo') &&
        String(
            userMemoById.get(normalizeFriendListId(friend?.id)) ||
                friend?.memo ||
                friend?.$memo ||
                ''
        )
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
}: FriendListFilterInput): FriendListRow[] {
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
