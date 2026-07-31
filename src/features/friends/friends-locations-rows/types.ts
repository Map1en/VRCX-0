import type { FriendRecord } from '@/domain/friends/friendRosterTypes';
import type { SameInstanceLastLocation } from '@/domain/friends/sameInstanceFriends';
import type { parseLocation } from '@/shared/utils/location';

export type TranslationFn = (
    key: string,
    options?: Record<string, unknown>
) => unknown;

export type FriendLocationRecord = Record<string, unknown> & {
    $groupName?: unknown;
    $location?: FriendLocationRecord | null;
    $location_at?: unknown;
    $travelingToLocation?: unknown;
    $travelingToWorld?: unknown;
    displayName?: unknown;
    group?: FriendLocationRecord | null;
    groupName?: unknown;
    id?: unknown;
    instanceId?: unknown;
    instance_id?: unknown;
    isOffline?: unknown;
    isPrivate?: unknown;
    isTraveling?: unknown;
    location?: unknown;
    locationName?: unknown;
    name?: unknown;
    ref?: FriendLocationRecord | null;
    shortCode?: unknown;
    state?: unknown;
    stateBucket?: unknown;
    tag?: unknown;
    travelingToLocation?: unknown;
    travelingToTime?: unknown;
    travelingToWorld?: unknown;
    userId?: unknown;
    world?: FriendLocationRecord | null;
    worldId?: unknown;
    worldName?: unknown;
    world_id?: unknown;
};

export type FriendLocationFriend = FriendRecord | FriendLocationRecord;

export type FavoriteGroupOption = {
    key?: unknown;
    displayName?: unknown;
    name?: unknown;
};

export type FavoriteGroupLabelsByFriendId = Map<string, string[]>;

export type FavoriteGroupLabelsInput = {
    favoriteFriendGroups?: FavoriteGroupOption[] | null;
    groupedFavoriteFriendIdsByGroupKey?: Record<string, unknown>;
    localFriendFavorites?: Record<string, unknown>;
    t?: TranslationFn | null;
};

export type FavoriteGroupSortValue = {
    key: string;
    label?: string;
};

export type FriendsLocationsLastLocation = SameInstanceLastLocation;

export type SameInstanceGroup<
    TFriend extends FriendLocationFriend = FriendLocationFriend
> = {
    location: string;
    friends: TFriend[];
};

export type FriendLocationTarget = {
    rawLocation: string;
    parsed: ReturnType<typeof parseLocation>;
    worldId: string;
    groupId: string;
    instanceId: string;
    accessTypeName: string;
    isOffline: boolean;
    isPrivate: boolean;
    isTraveling: boolean;
};

export type FriendLocationSectionDescriptor = {
    key: string;
    title: string;
    description: string;
    worldId: string;
    groupId: string;
    rawLocation: string;
};

export type FriendLocationSection<
    TFriend extends FriendLocationFriend = FriendLocationFriend
> = FriendLocationSectionDescriptor & {
    displayInstanceInfo?: boolean;
    friends: TFriend[];
};

export type SameInstanceSectionsInput<
    TFriend extends FriendLocationFriend = FriendLocationFriend
> = {
    sameInstanceGroups: SameInstanceGroup<TFriend>[];
    displayInstanceInfo?: boolean;
    t?: TranslationFn | null;
};

export type FriendSectionsInput<
    TFriend extends FriendLocationFriend = FriendLocationFriend
> = {
    friends: TFriend[];
    groupingMode: string;
    favoriteIds: Set<string>;
    favoriteGroupLabelsByFriendId: FavoriteGroupLabelsByFriendId;
    t?: TranslationFn | null;
};
