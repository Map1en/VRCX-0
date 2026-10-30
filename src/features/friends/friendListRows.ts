import { presenceSection } from '@/domain/friends/presence';
import type {
    FriendProfileFields,
    FriendRecordInput
} from '@/domain/friends/types';
import removeConfusables, { removeWhitespace } from '@/services/confusables';

const FRIEND_LIST_DEFAULT_SEARCH_FILTER_IDS = [
    'displayName',
    'rank',
    'status',
    'note',
    'memo',
    'bio'
];

export type FriendListRow = FriendRecordInput &
    Partial<FriendProfileFields> & {
        $joinCount?: number;
        $lastSeen?: string;
        $mutualCount?: number | string;
        $mutualOptedOut?: boolean;
        $timeSpent?: number;
        bio?: string;
        bioLinks?: string[];
        friendNumber?: number;
        memo?: string;
        note?: string;
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
        `${friend?.statusDescription || ''} ${friend?.status || ''} ${friend?.$presence ? presenceSection(friend.$presence) : ''}`
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

    if (
        filters.has('bio') &&
        [friend?.bio ?? '', ...(friend?.bioLinks ?? [])].some((text) =>
            text.toLowerCase().includes(loweredQuery)
        )
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
