export {
    buildFavoriteGroupLabelsByFriendId,
    compareFavoriteGroups,
    resolveFavoriteGroupLabels
} from './friends-locations-rows/favorites';
export {
    isRawWorldReference,
    isSentinelLocationValue,
    normalizeDisplayText,
    normalizeFriendsLocationId,
    resolveDisplayWorldName,
    resolveWorldIdCandidate
} from './friends-locations-rows/normalization';
export {
    buildSameInstanceGroups,
    isOnlineFriend,
    isShareableInstanceLocation,
    resolveFriendGroupName,
    resolveFriendTravelingWorldId,
    resolveFriendTravelingWorldName,
    resolveFriendWorldName,
    resolvePresenceLocation,
    uniqueFriendsById
} from './friends-locations-rows/presence';
export {
    buildFriendSections,
    buildSameInstanceSections,
    resolveInstanceSectionDescriptor
} from './friends-locations-rows/sections';
export {
    isFriendInPrivateLocation,
    partitionFriendsByPrivateLocation,
    resolveLocationSummary,
    resolveLocationTarget,
    resolveWorldDialogTarget
} from './friends-locations-rows/targets';
export type {
    FriendLocationFriend,
    FriendLocationSection,
    FriendLocationSectionDescriptor,
    SameInstanceGroup
} from './friends-locations-rows/types';
export { resolveCurrentInviteLocation as resolveFriendsLocationsCurrentInviteLocation } from '@/shared/utils/invite';
