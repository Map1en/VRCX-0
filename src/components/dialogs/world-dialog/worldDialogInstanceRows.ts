import { finiteLocationNumber } from '@/components/location/locationModel';
import type { EntityRecord } from '@/domain/entities/shared';
import type { WorldProfileRecord } from '@/domain/entities/world';
import { resolveFriendPresenceLocation } from '@/domain/friends/presence';
import {
    isOfflineOrLeavingFriend,
    resolveObservedPlayerUserId
} from '@/domain/friends/sameInstanceFriends';
import type {
    CurrentInstanceRosterContext,
    CurrentInstanceRosterPlayer
} from '@/domain/instances/currentInstanceRoster';
import { hasGroupIdPrefix } from '@/shared/constants/vrchatIds';
import { parseLocation } from '@/shared/utils/location';
import { isRecord } from '@/shared/utils/record';
import { languageShortCode } from '@/shared/utils/userLanguage';

import {
    firstText,
    groupSeed,
    mergeInstanceUsers,
    normalizeInstanceGroup,
    resolveLaunchLocation,
    sameInstanceLocation,
    sameLocationTag,
    type WorldDialogInstanceRow
} from './WorldDialogViewParts';

type CurrentInstanceDetails = {
    location?: string;
    instance?: EntityRecord | null;
    ownerUser?: EntityRecord | null;
    ownerGroup?: EntityRecord | null;
    playerSnapshot?: {
        context?: Partial<CurrentInstanceRosterContext>;
        players?: Array<Partial<CurrentInstanceRosterPlayer>>;
    } | null;
};

type BuildWorldDialogDisplayInstanceRowsInput = {
    creatorGroupsById: Record<string, EntityRecord>;
    currentInstanceDetails: CurrentInstanceDetails;
    currentLocation?: string;
    friendsById: Record<string, unknown>;
    instanceRows: EntityRecord[];
    isInstanceLocation: boolean;
    normalizedWorldId: string;
    viewer: WorldDialogInstanceViewer;
    world: Pick<WorldProfileRecord, 'id' | 'capacity'>;
    worldDialogShortName?: string;
};

export type WorldDialogInstanceViewer = {
    ageVerified: boolean;
    languages: string[];
};

function record(value: unknown): EntityRecord {
    return isRecord(value) ? value : {};
}

function baseLanguageCode(code: string) {
    return (code.split('-')[0] ?? code).toLowerCase();
}

export function worldDialogInstanceViewer(
    currentUser: EntityRecord | null | undefined
): WorldDialogInstanceViewer {
    const tags = Array.isArray(currentUser?.tags) ? currentUser.tags : [];
    return {
        ageVerified: currentUser?.ageVerified === true,
        languages: tags
            .filter(
                (tag): tag is string =>
                    typeof tag === 'string' && tag.startsWith('language_')
            )
            .map((tag) => baseLanguageCode(languageShortCode(tag)))
    };
}

function recordOrNull(value: unknown): EntityRecord | null {
    return isRecord(value) ? value : null;
}

export function buildWorldDialogDisplayInstanceRows({
    creatorGroupsById,
    currentInstanceDetails,
    currentLocation,
    friendsById,
    instanceRows,
    isInstanceLocation,
    normalizedWorldId,
    viewer,
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
            creatorUser: recordOrNull(instance.creatorUser),
            creatorGroupId: firstText(instance.creatorGroupId),
            creatorGroup: normalizeInstanceGroup(
                instance.creatorGroup,
                firstText(instance.creatorGroupId)
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
    const currentInstanceOwnerIsGroup = hasGroupIdPrefix(
        currentInstanceOwnerId
    );
    const snapshotPlayers = (
        Array.isArray(playerSnapshot.players) ? playerSnapshot.players : []
    )
        .map((player) => {
            const source = record(player);
            const userId = resolveObservedPlayerUserId(source, friendsById);
            return {
                id: userId,
                userId,
                displayName: firstText(source.displayName, source.display_name),
                joinedAt: firstText(source.joinedAt, source.joined_at),
                joinedAtMs: source.joinedAtMs
            };
        })
        .filter(
            (player) => !isOfflineOrLeavingFriend(friendsById[player.userId])
        );
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
                      finiteLocationNumber(
                          currentInstance.n_users ??
                              currentInstance.userCount ??
                              currentInstance.occupants ??
                              playerSnapshotContext.playerCount
                      ) ?? undefined,
                  playerCount:
                      finiteLocationNumber(
                          currentInstance.n_users ??
                              currentInstance.userCount ??
                              currentInstance.occupants ??
                              playerSnapshotContext.playerCount
                      ) ?? undefined,
                  capacity:
                      finiteLocationNumber(
                          currentInstance.capacity ??
                              record(currentInstance.world).capacity ??
                              world.capacity
                      ) ?? undefined,
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
                      : recordOrNull(
                            currentInstanceDetailsForLocation.ownerUser ||
                                currentInstance.ownerUser ||
                                currentInstance.owner ||
                                currentInstance.creatorUser ||
                                currentInstance.user
                        ),
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
    const friendLocations = Object.values(friendsById || {})
        .filter((friend) => !isOfflineOrLeavingFriend(friend))
        .map((friend) => ({
            friend,
            location: resolveFriendPresenceLocation(friend, {
                preferTraveling: true,
                requireInstance: true
            })
        }));
    const candidateInstanceRows = [...baseDisplayInstanceRows];
    for (const { location } of friendLocations) {
        const parsedLocation = parseLocation(location);
        if (
            !parsedLocation.instanceId ||
            parsedLocation.worldId !== world.id ||
            candidateInstanceRows.some((instance) =>
                sameInstanceLocation(world, instance, location)
            )
        ) {
            continue;
        }
        const creatorGroupId = firstText(parsedLocation.groupId);
        const creatorUserId = creatorGroupId
            ? ''
            : firstText(parsedLocation.userId);
        candidateInstanceRows.push({
            id: parsedLocation.instanceId,
            location: firstText(parsedLocation.tag, location),
            users: [],
            creatorUserId,
            creatorUser: null,
            creatorGroupId,
            creatorGroup: creatorGroupId
                ? normalizeInstanceGroup(creatorGroupId)
                : null
        });
    }
    const creatorGroupKey = Array.from(
        new Set(
            candidateInstanceRows
                .map((instance) =>
                    firstText(
                        instance.creatorGroupId,
                        hasGroupIdPrefix(instance.creatorUserId)
                            ? instance.creatorUserId
                            : ''
                    )
                )
                .filter(Boolean)
        )
    )
        .sort()
        .join('|');
    const unsortedInstanceRows = candidateInstanceRows.map((instance) => {
        const location = resolveLaunchLocation(world, instance);
        const friendsInInstance = location
            ? friendLocations
                  .filter(({ location: friendLocation }) =>
                      sameLocationTag(friendLocation, location)
                  )
                  .map(({ friend }) => friend)
            : [];
        const creatorGroupId = firstText(
            instance.creatorGroupId,
            hasGroupIdPrefix(instance.creatorUserId)
                ? instance.creatorUserId
                : ''
        );
        const creatorGroupProfile = creatorGroupId
            ? creatorGroupsById[creatorGroupId]
            : null;
        const mergedUsers = mergeInstanceUsers(
            instance.users,
            friendsInInstance
        ).filter((user) => {
            const userId = firstText(user.id, user.userId);
            const friend = friendsById[userId];
            const friendLocation = resolveFriendPresenceLocation(friend, {
                preferTraveling: true,
                requireInstance: true
            });
            return Boolean(
                !isOfflineOrLeavingFriend(friend) &&
                (!friendLocation || sameLocationTag(friendLocation, location))
            );
        });
        const isCurrentInstance = sameInstanceLocation(
            world,
            instance,
            currentLocation
        );
        const instanceWithFriends: WorldDialogInstanceRow = {
            ...instance,
            isCurrentInstance,
            users: mergedUsers
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

    const friendCount = (instance: WorldDialogInstanceRow) =>
        instance.users.filter((user) =>
            Boolean(friendsById[firstText(user.id, user.userId)])
        ).length;
    const viewerLanguageCodes = new Set(viewer.languages);
    const listedOccupants = (instance: WorldDialogInstanceRow) =>
        finiteLocationNumber(instance.n_users) ?? 0;
    const isBlocked = (instance: WorldDialogInstanceRow) => {
        const location = resolveLaunchLocation(world, instance);
        if (!viewer.ageVerified && parseLocation(location).ageGate) {
            return true;
        }
        const capacity = finiteLocationNumber(world.capacity);
        return Boolean(capacity && listedOccupants(instance) >= capacity);
    };
    const languageMatch = (instance: WorldDialogInstanceRow) => {
        const ratio = record(instance.languageRatio);
        const ranked = Object.entries(ratio)
            .map(([code, share]) => ({
                code: baseLanguageCode(code),
                share: Number(share) || 0
            }))
            .filter((entry) => entry.share > 0)
            .sort((left, right) => right.share - left.share);
        if (ranked[0] && viewerLanguageCodes.has(ranked[0].code)) {
            return 2;
        }
        return ranked.some((entry) => viewerLanguageCodes.has(entry.code))
            ? 1
            : 0;
    };
    const displayInstanceRows = unsortedInstanceRows
        .map((instance, index) => ({
            instance,
            index,
            friends: friendCount(instance),
            blocked: isBlocked(instance),
            language: languageMatch(instance),
            occupants: listedOccupants(instance)
        }))
        .sort(
            (left, right) =>
                Number(Boolean(right.instance.isCurrentInstance)) -
                    Number(Boolean(left.instance.isCurrentInstance)) ||
                right.friends - left.friends ||
                Number(left.blocked) - Number(right.blocked) ||
                right.language - left.language ||
                right.occupants - left.occupants ||
                left.index - right.index
        )
        .map(({ instance }) => instance);

    return { creatorGroupKey, displayInstanceRows };
}
