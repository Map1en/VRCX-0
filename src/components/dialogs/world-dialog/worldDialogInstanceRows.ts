import type { EntityRecord } from '@/domain/entities/profileEntities';
import { parseLocation } from '@/shared/utils/location';

import {
    firstText,
    friendIsInInstance,
    groupSeed,
    isGroupId,
    mergeInstanceUsers,
    normalizeInstanceGroup,
    resolveLaunchLocation,
    sameInstanceLocation,
    sameLocationTag,
    type WorldDialogInstanceRow
} from './WorldDialogViewParts';

type CurrentInstanceDetails = {
    location?: unknown;
    instance?: unknown;
    ownerUser?: unknown;
    ownerGroup?: unknown;
    playerSnapshot?: unknown;
};

type BuildWorldDialogDisplayInstanceRowsInput = {
    creatorGroupsById: Record<string, EntityRecord>;
    currentInstanceDetails: CurrentInstanceDetails;
    friendsById: Record<string, unknown>;
    instanceRows: EntityRecord[];
    isInstanceLocation: boolean;
    normalizedWorldId: string;
    world: EntityRecord & { id: string; capacity: number };
    worldDialogShortName?: string;
};

function isRecord(value: unknown): value is EntityRecord {
    return Boolean(value && typeof value === 'object');
}

function record(value: unknown): EntityRecord {
    return isRecord(value) ? value : {};
}

export function buildWorldDialogDisplayInstanceRows({
    creatorGroupsById,
    currentInstanceDetails,
    friendsById,
    instanceRows,
    isInstanceLocation,
    normalizedWorldId,
    world,
    worldDialogShortName
}: BuildWorldDialogDisplayInstanceRowsInput) {
    const normalizedInstanceRows: WorldDialogInstanceRow[] = instanceRows.map(
        (instance) => ({
            ...instance,
            id: firstText(instance.id, instance.instanceId),
            location: firstText(instance.location, instance.tag),
            users: mergeInstanceUsers(instance.users),
            creatorUserId: firstText(instance.creatorUserId),
            creatorUser: instance.creatorUser ?? null,
            creatorGroupId: firstText(instance.creatorGroupId),
            creatorGroup: normalizeInstanceGroup(
                instance.creatorGroup,
                instance.creatorGroupId
            )
        })
    );
    const parsedCurrentInstanceLocation = isInstanceLocation
        ? parseLocation(normalizedWorldId)
        : null;
    const emptyInstanceDetails: CurrentInstanceDetails = {
        location: '',
        instance: null,
        ownerUser: null,
        ownerGroup: null,
        playerSnapshot: null
    };
    const currentInstanceDetailsForLocation = sameLocationTag(
        currentInstanceDetails.location,
        normalizedWorldId
    )
        ? currentInstanceDetails
        : emptyInstanceDetails;
    const currentInstance = record(currentInstanceDetailsForLocation.instance);
    const currentOwnerUser = record(currentInstance.ownerUser);
    const currentOwner = record(currentInstance.owner);
    const currentCreatorUser = record(currentInstance.creatorUser);
    const currentUser = record(currentInstance.user);
    const currentGroup = record(currentInstance.group);
    const playerSnapshot = record(
        currentInstanceDetailsForLocation.playerSnapshot
    );
    const playerSnapshotContext = record(playerSnapshot.context);
    const currentInstanceOwnerId =
        parsedCurrentInstanceLocation?.worldId &&
        parsedCurrentInstanceLocation?.instanceId
            ? firstText(
                  parsedCurrentInstanceLocation.userId,
                  currentInstance.ownerId,
                  currentInstance.owner_id,
                  currentInstance.ownerUserId,
                  currentInstance.owner_user_id,
                  currentInstance.userId,
                  currentInstance.user_id,
                  currentInstance.creatorUserId,
                  currentInstance.creator_user_id,
                  currentOwnerUser.id,
                  currentOwnerUser.userId,
                  currentOwner.id,
                  currentOwner.userId,
                  currentCreatorUser.id,
                  currentCreatorUser.userId,
                  currentUser.id,
                  currentUser.userId,
                  currentInstance.groupId,
                  currentInstance.group_id,
                  currentGroup.id,
                  parsedCurrentInstanceLocation.groupId
              )
            : '';
    const currentInstanceOwnerIsGroup = isGroupId(currentInstanceOwnerId);
    const snapshotPlayers = (
        Array.isArray(playerSnapshot.players) ? playerSnapshot.players : []
    ).map((player) => {
        const source = record(player);
        const userId = firstText(source.userId, source.user_id);
        return {
            id: userId,
            userId,
            displayName: firstText(source.displayName, source.display_name),
            joinedAt: firstText(source.joinedAt, source.joined_at)
        };
    });
    const currentInstanceRow: WorldDialogInstanceRow | null =
        parsedCurrentInstanceLocation?.worldId &&
        parsedCurrentInstanceLocation?.instanceId
            ? {
                  id: parsedCurrentInstanceLocation.instanceId,
                  location: normalizedWorldId,
                  shortName:
                      parsedCurrentInstanceLocation.shortName ||
                      worldDialogShortName ||
                      '',
                  occupants:
                      currentInstance.userCount ??
                      currentInstance.occupants ??
                      playerSnapshotContext.playerCount,
                  playerCount:
                      currentInstance.userCount ??
                      currentInstance.occupants ??
                      playerSnapshotContext.playerCount,
                  capacity:
                      currentInstance.capacity ??
                      record(currentInstance.world).capacity ??
                      world.capacity,
                  users: mergeInstanceUsers(
                      currentInstance.users,
                      currentInstance.players,
                      currentInstance.playerList,
                      currentInstance.userList,
                      currentInstance.userIds,
                      currentInstance.usersById,
                      snapshotPlayers
                  ),
                  ref: currentInstanceDetailsForLocation.instance || null,
                  creatorUserId: currentInstanceOwnerIsGroup
                      ? ''
                      : currentInstanceOwnerId,
                  creatorUser: currentInstanceOwnerIsGroup
                      ? null
                      : currentInstanceDetailsForLocation.ownerUser ||
                        currentInstance.ownerUser ||
                        currentInstance.owner ||
                        currentInstance.creatorUser ||
                        currentInstance.user ||
                        null,
                  creatorGroupId: currentInstanceOwnerIsGroup
                      ? currentInstanceOwnerId
                      : '',
                  creatorGroup: currentInstanceOwnerIsGroup
                      ? normalizeInstanceGroup(
                            currentInstanceDetailsForLocation.ownerGroup ||
                                currentInstance.group ||
                                currentInstance.ownerGroup ||
                                groupSeed(currentInstance.owner),
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
            ? normalizedInstanceRows.some((instance) =>
                  sameInstanceLocation(world, instance, normalizedWorldId)
              )
                ? normalizedInstanceRows.map((instance) =>
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
                : [currentInstanceRow, ...normalizedInstanceRows]
            : normalizedInstanceRows;
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
        const instanceWithFriends: WorldDialogInstanceRow = {
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
