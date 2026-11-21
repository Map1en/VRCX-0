import { presenceDotClassName, presenceOf } from '@/domain/friends/presence';
import {
    buildSameInstanceFriendGroups,
    type SameInstanceLastLocation
} from '@/domain/friends/sameInstanceFriends';
import type {
    FriendProfileFields,
    FriendRecordInput
} from '@/domain/friends/types';
import {
    compareByActiveStatus,
    getFriendsSortFunction,
    type FriendSortMethod,
    type FriendSortContext
} from '@/shared/utils/friend';
import { getTrustColor, type TrustColorMap } from '@/shared/utils/trustColors';
import { computeTrustLevel } from '@/shared/utils/userTransforms';
import type { FriendLocationTimeEntry } from '@/state/friendLocationTimeStore';

export type SidebarFriendRecord = FriendRecordInput &
    Partial<FriendProfileFields> & {
        $friendNumber?: number;
        $userColour?: string;
        created_at?: string;
        developerType?: string;
        displayName?: string;
        id?: string;
        last_activity?: string | number;
        last_login?: string | number;
        memberCount?: number;
        name?: string;
        tags?: string[];
        updated_at?: string;
        username?: string;
        isFriend?: boolean;
    };

export type SidebarPreferences = {
    isHideFriendsInSameInstance?: boolean;
    isSameInstanceAboveFavorites?: boolean;
    isSidebarDivideByFriendGroup?: boolean;
    sidebarFavoriteGroupOrder?: string[];
    sidebarFavoriteGroups?: string[];
    sidebarGroupByInstance?: boolean;
    sidebarCompactRows?: boolean;
    sidebarSortMethod1?: FriendSortMethod | '';
    sidebarSortMethod2?: FriendSortMethod | '';
    sidebarSortMethod3?: FriendSortMethod | '';
};

type SidebarStatusOptions = {
    hideNonFriend?: boolean;
};

export type SameInstanceGroup = {
    location: string;
    rows: SidebarFriendRecord[];
    isCurrentInstance: boolean;
};

function isFriendSortMethod(
    value: FriendSortMethod | '' | undefined
): value is FriendSortMethod {
    return Boolean(value);
}

export function normalizeSidebarFilterQuery(query: string | null | undefined) {
    return String(query || '')
        .trim()
        .toLowerCase();
}

export function friendMatchesSidebarFilterQuery(
    friend: SidebarFriendRecord | null | undefined,
    query: string
) {
    if (!query) {
        return true;
    }
    return [friend?.displayName, friend?.name, friend?.username].some(
        (value) =>
            typeof value === 'string' && value.toLowerCase().includes(query)
    );
}

export function resolveTrustNameColour(
    friend: SidebarFriendRecord | null | undefined,
    trustColor: TrustColorMap
) {
    if (!friend?.$trustClass && Array.isArray(friend?.tags)) {
        const trust = computeTrustLevel(
            friend.tags,
            typeof friend.developerType === 'string' ? friend.developerType : ''
        );
        return getTrustColor(
            {
                ...friend,
                $trustClass: trust.trustClass,
                $isModerator: trust.isModerator,
                $isTroll: trust.isTroll,
                $isProbableTroll: trust.isProbableTroll
            },
            trustColor
        );
    }
    return getTrustColor(friend, trustColor);
}

export function resolveSidebarStatusDotClassName(
    friend: SidebarFriendRecord | null | undefined,
    { hideNonFriend = true }: SidebarStatusOptions = {}
) {
    if (!friend || (hideNonFriend && friend.isFriend === false)) {
        return '';
    }
    return presenceDotClassName(presenceOf(friend), friend.status);
}

export function sortRows<TRow extends SidebarFriendRecord>(
    rows: readonly TRow[],
    prefs: SidebarPreferences,
    sortContext?: FriendSortContext
): readonly TRow[] {
    const methods = [
        prefs.sidebarSortMethod1,
        prefs.sidebarSortMethod2,
        prefs.sidebarSortMethod3
    ].filter(isFriendSortMethod);
    if (!methods.length) {
        return rows;
    }
    const sort = getFriendsSortFunction(methods, sortContext);
    return [...rows].sort(sort);
}

export function sortActiveRows<TRow extends SidebarFriendRecord>(
    rows: readonly TRow[],
    prefs: SidebarPreferences,
    sortContext?: FriendSortContext
): TRow[] {
    const sortedRows = sortRows(rows, prefs, sortContext);
    return [...sortedRows].sort(compareByActiveStatus);
}

export function buildSameInstanceGroups(
    rows: readonly SidebarFriendRecord[],
    prefs: SidebarPreferences,
    lastLocation: SameInstanceLastLocation | null | undefined,
    locationTimes?: Readonly<Record<string, FriendLocationTimeEntry>>,
    sortContext?: FriendSortContext
) {
    return buildSameInstanceFriendGroups(
        sortRows(rows, prefs, sortContext),
        lastLocation,
        {
            includeCurrentUser: true,
            locationTimes
        }
    ).map(({ location, friends, isCurrentInstance }): SameInstanceGroup => ({
        location,
        rows: friends,
        isCurrentInstance
    }));
}
