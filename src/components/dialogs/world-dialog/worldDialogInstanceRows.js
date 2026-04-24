import { parseLocation } from '@/shared/utils/location.js';

import {
    firstText,
    friendIsInInstance,
    groupSeed,
    isGroupId,
    mergeInstanceUsers,
    normalizeInstanceGroup,
    resolveLaunchLocation,
    sameInstanceLocation,
    sameLocationTag
} from './WorldDialogViewParts.jsx';

export function buildWorldDialogDisplayInstanceRows({
    creatorGroupsById,
    currentInstanceDetails,
    friendsById,
    instanceRows,
    isInstanceLocation,
    normalizedWorldId,
    world,
    worldDialogShortName
}) {
    const parsedCurrentInstanceLocation = isInstanceLocation
        ? parseLocation(normalizedWorldId)
        : null;
    const currentInstanceDetailsForLocation = sameLocationTag(
        currentInstanceDetails.location,
        normalizedWorldId
    )
        ? currentInstanceDetails
        : {
              instance: null,
              ownerUser: null,
              ownerGroup: null,
              playerSnapshot: null
          };
    const currentInstanceOwnerId =
        parsedCurrentInstanceLocation?.worldId &&
        parsedCurrentInstanceLocation?.instanceId
            ? firstText(
                  parsedCurrentInstanceLocation.userId,
                  currentInstanceDetailsForLocation.instance?.ownerId,
                  currentInstanceDetailsForLocation.instance?.owner_id,
                  currentInstanceDetailsForLocation.instance?.ownerUserId,
                  currentInstanceDetailsForLocation.instance?.owner_user_id,
                  currentInstanceDetailsForLocation.instance?.userId,
                  currentInstanceDetailsForLocation.instance?.user_id,
                  currentInstanceDetailsForLocation.instance?.creatorUserId,
                  currentInstanceDetailsForLocation.instance?.creator_user_id,
                  currentInstanceDetailsForLocation.instance?.ownerUser?.id,
                  currentInstanceDetailsForLocation.instance?.ownerUser?.userId,
                  currentInstanceDetailsForLocation.instance?.owner?.id,
                  currentInstanceDetailsForLocation.instance?.owner?.userId,
                  currentInstanceDetailsForLocation.instance?.creatorUser?.id,
                  currentInstanceDetailsForLocation.instance?.creatorUser
                      ?.userId,
                  currentInstanceDetailsForLocation.instance?.user?.id,
                  currentInstanceDetailsForLocation.instance?.user?.userId,
                  currentInstanceDetailsForLocation.instance?.groupId,
                  currentInstanceDetailsForLocation.instance?.group_id,
                  currentInstanceDetailsForLocation.instance?.group?.id,
                  parsedCurrentInstanceLocation.groupId
              )
            : '';
    const currentInstanceOwnerIsGroup = isGroupId(currentInstanceOwnerId);
    const currentInstanceRow =
        parsedCurrentInstanceLocation?.worldId &&
        parsedCurrentInstanceLocation?.instanceId
            ? {
                  id: parsedCurrentInstanceLocation.instanceId,
                  location: normalizedWorldId,
                  shortName:
                      parsedCurrentInstanceLocation.shortName ||
                      worldDialogShortName,
                  occupants:
                      currentInstanceDetailsForLocation.instance?.userCount ??
                      currentInstanceDetailsForLocation.instance?.occupants ??
                      currentInstanceDetailsForLocation.playerSnapshot?.context
                          ?.playerCount,
                  playerCount:
                      currentInstanceDetailsForLocation.instance?.userCount ??
                      currentInstanceDetailsForLocation.instance?.occupants ??
                      currentInstanceDetailsForLocation.playerSnapshot?.context
                          ?.playerCount,
                  capacity:
                      currentInstanceDetailsForLocation.instance?.capacity ??
                      currentInstanceDetailsForLocation.instance?.world
                          ?.capacity ??
                      world.capacity,
                  users: mergeInstanceUsers(
                      currentInstanceDetailsForLocation.instance?.users,
                      currentInstanceDetailsForLocation.instance?.players,
                      currentInstanceDetailsForLocation.instance?.playerList,
                      currentInstanceDetailsForLocation.instance?.userList,
                      currentInstanceDetailsForLocation.instance?.userIds,
                      currentInstanceDetailsForLocation.instance?.usersById,
                      currentInstanceDetailsForLocation.playerSnapshot?.players
                  ),
                  ref: currentInstanceDetailsForLocation.instance || null,
                  creatorUserId: currentInstanceOwnerIsGroup
                      ? ''
                      : currentInstanceOwnerId,
                  creatorUser: currentInstanceOwnerIsGroup
                      ? null
                      : currentInstanceDetailsForLocation.ownerUser ||
                        currentInstanceDetailsForLocation.instance?.ownerUser ||
                        currentInstanceDetailsForLocation.instance?.owner ||
                        currentInstanceDetailsForLocation.instance
                            ?.creatorUser ||
                        currentInstanceDetailsForLocation.instance?.user ||
                        null,
                  creatorGroupId: currentInstanceOwnerIsGroup
                      ? currentInstanceOwnerId
                      : '',
                  creatorGroup: currentInstanceOwnerIsGroup
                      ? normalizeInstanceGroup(
                            currentInstanceDetailsForLocation.ownerGroup ||
                                currentInstanceDetailsForLocation.instance
                                    ?.group ||
                                currentInstanceDetailsForLocation.instance
                                    ?.ownerGroup ||
                                groupSeed(
                                    currentInstanceDetailsForLocation.instance
                                        ?.owner
                                ),
                            currentInstanceOwnerId
                        )
                      : null
              }
            : null;
    const hasLiveCurrentInstanceDetails = Boolean(
        currentInstanceDetailsForLocation.instance ||
        currentInstanceDetailsForLocation.playerSnapshot ||
        currentInstanceDetailsForLocation.ownerUser ||
        currentInstanceDetailsForLocation.ownerGroup
    );
    const baseDisplayInstanceRows =
        currentInstanceRow && hasLiveCurrentInstanceDetails
            ? instanceRows.some((instance) =>
                  sameInstanceLocation(world, instance, normalizedWorldId)
              )
                ? instanceRows.map((instance) =>
                      sameInstanceLocation(world, instance, normalizedWorldId)
                          ? {
                                ...instance,
                                ...currentInstanceRow,
                                shortName: firstText(
                                    currentInstanceRow.shortName,
                                    instance.shortName
                                ),
                                occupants:
                                    currentInstanceRow.occupants ??
                                    instance.occupants,
                                playerCount:
                                    currentInstanceRow.playerCount ??
                                    instance.playerCount ??
                                    instance.occupants,
                                capacity:
                                    currentInstanceRow.capacity ??
                                    instance.capacity,
                                users: currentInstanceRow.users.length
                                    ? currentInstanceRow.users
                                    : instance.users,
                                ref: currentInstanceRow.ref ?? instance.ref,
                                creatorUserId: firstText(
                                    currentInstanceRow.creatorUserId,
                                    instance.creatorUserId
                                ),
                                creatorUser:
                                    currentInstanceRow.creatorUser ||
                                    instance.creatorUser,
                                creatorGroupId: firstText(
                                    currentInstanceRow.creatorGroupId,
                                    instance.creatorGroupId
                                ),
                                creatorGroup:
                                    currentInstanceRow.creatorGroup ||
                                    instance.creatorGroup
                            }
                          : instance
                  )
                : [currentInstanceRow, ...instanceRows]
            : instanceRows;
    const creatorGroupKey = Array.from(
        new Set(
            baseDisplayInstanceRows
                .map((instance) =>
                    firstText(
                        instance.creatorGroupId,
                        isGroupId(instance.creatorUserId)
                            ? instance.creatorUserId
                            : ''
                    )
                )
                .filter(Boolean)
        )
    )
        .sort()
        .join('|');
    const friendRows = Object.values(friendsById || {});
    const displayInstanceRows = baseDisplayInstanceRows.map((instance) => {
        const location = resolveLaunchLocation(world, instance);
        const friendsInInstance = location
            ? friendRows.filter((friend) =>
                  friendIsInInstance(friend, location)
              )
            : [];
        const creatorGroupId = firstText(
            instance.creatorGroupId,
            isGroupId(instance.creatorUserId) ? instance.creatorUserId : ''
        );
        const creatorGroupProfile = creatorGroupId
            ? creatorGroupsById[creatorGroupId]
            : null;
        const instanceWithFriends = {
            ...instance,
            users: mergeInstanceUsers(instance.users, friendsInInstance)
        };
        return creatorGroupProfile
            ? {
                  ...instanceWithFriends,
                  creatorGroupId,
                  creatorGroup: normalizeInstanceGroup(
                      creatorGroupProfile,
                      creatorGroupId
                  )
              }
            : instanceWithFriends;
    });

    return { creatorGroupKey, displayInstanceRows };
}
