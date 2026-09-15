import type { FavoriteGroupMap } from '@/domain/favorites/types';
import type { SameInstanceLastLocation } from '@/domain/friends/sameInstanceFriends';
import type {
    FriendProfileFields,
    FriendRecord,
    FriendRecordInput
} from '@/domain/friends/types';
import type { InstanceRosterTimestamp } from '@/domain/instances/instanceRoster';
import type { parseLocation } from '@/shared/utils/location';

export type TranslationFn = (
    key: string,
    options?: Record<string, unknown>
) => string;

export type FriendLocationRecord = FriendRecordInput &
    Omit<Partial<FriendProfileFields>, '$location' | '$travelingToLocation'> & {
        $groupName?: string | null;
        $location?: FriendLocationRecord | null;
        $travelingToLocation?: FriendLocationRecord | string | null;
        $travelingToWorld?: string | null;
        group?: FriendLocationRecord | null;
        groupName?: string | null;
        instanceId?: string | null;
        instance_id?: string | null;
        isOffline?: boolean | null;
        isPrivate?: boolean | null;
        isTraveling?: boolean | null;
        locationName?: string | null;
        name?: string | null;
        ref?: FriendLocationRecord | null;
        shortCode?: string | null;
        stateBucket?: string;
        tag?: string | null;
        travelingToLocation?: string | null;
        travelingToTime?: InstanceRosterTimestamp | null;
        travelingToWorld?: string | null;
        world?: FriendLocationRecord | null;
        worldId?: string | null;
        worldName?: string | null;
        world_id?: string | null;
    };

export type FriendLocationFriend = FriendRecord | FriendLocationRecord;

type FavoriteGroupOption = {
    key?: string;
    displayName?: string;
    name?: string;
};

export type FavoriteGroupLabelsByFriendId = Map<string, string[]>;

export type FavoriteGroupLabelsInput = {
    favoriteFriendGroups?: FavoriteGroupOption[] | null;
    groupedFavoriteFriendIdsByGroupKey?: Record<string, string[]>;
    localFriendFavorites?: FavoriteGroupMap;
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
