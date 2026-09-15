import { useEffect, useState } from 'react';

import type { EntityRecord } from '@/domain/entities/shared';
import { type CurrentInstanceRosterSnapshot } from '@/domain/instances/currentInstanceRoster';
import groupProfileRepository from '@/repositories/groupProfileRepository';
import userProfileRepository from '@/repositories/userProfileRepository';
import vrchatInstanceRepository from '@/repositories/vrchatInstanceRepository';
import { loadCurrentInstanceRoster } from '@/services/currentInstanceRosterService';
import {
    recordGameRuntimePresence,
    recordLocationHintsFromInstances
} from '@/services/domainIngestionService';
import { hasGroupIdPrefix } from '@/shared/constants/vrchatIds';
import { parseLocation } from '@/shared/utils/location';
import { isRecord } from '@/shared/utils/record';

import type { WorldDialogTabbedRuntimeState } from './useWorldDialogRuntimeState';
import {
    firstText,
    groupSeed,
    normalizeInstanceGroup,
    sameLocationTag
} from './WorldDialogViewParts';

export interface WorldDialogCurrentInstanceDetails {
    location: string;
    instance: EntityRecord | null;
    ownerUser: EntityRecord | null;
    ownerGroup: EntityRecord | null;
    playerSnapshot: CurrentInstanceRosterSnapshot | null;
}

function record(value: unknown): EntityRecord {
    return isRecord(value) ? value : {};
}

function firstRecord(...values: unknown[]): EntityRecord | null {
    return values.find(isRecord) ?? null;
}

const EMPTY_CURRENT_INSTANCE: WorldDialogCurrentInstanceDetails = {
    location: '',
    instance: null,
    ownerUser: null,
    ownerGroup: null,
    playerSnapshot: null
};

export function useWorldDialogCurrentInstance({
    currentResolvedLocation,
    isInstanceLocation,
    normalizedWorldId,
    runtime,
    worldName
}: {
    currentResolvedLocation: string;
    isInstanceLocation: boolean;
    normalizedWorldId: string;
    runtime: Pick<
        WorldDialogTabbedRuntimeState,
        | 'currentEndpoint'
        | 'currentLocationPlayers'
        | 'currentLocationStartedAt'
        | 'currentUserId'
        | 'currentUserSnapshot'
    >;
    worldName?: string;
}) {
    const {
        currentEndpoint,
        currentLocationPlayers: currentInstanceRosterRevision,
        currentLocationStartedAt,
        currentUserId,
        currentUserSnapshot
    } = runtime;
    const [details, setDetails] = useState<WorldDialogCurrentInstanceDetails>(
        EMPTY_CURRENT_INSTANCE
    );

    useEffect(() => {
        if (!isInstanceLocation) {
            setDetails(EMPTY_CURRENT_INSTANCE);
            return;
        }

        const parsedLocation = parseLocation(normalizedWorldId);
        if (!parsedLocation.worldId || !parsedLocation.instanceId) {
            setDetails({
                ...EMPTY_CURRENT_INSTANCE,
                location: normalizedWorldId
            });
            return;
        }

        let active = true;
        const isCurrentLiveInstance = sameLocationTag(
            currentResolvedLocation,
            normalizedWorldId
        );
        const playerSnapshotPromise = isCurrentLiveInstance
            ? loadCurrentInstanceRoster({
                  currentLocation: normalizedWorldId
              }).catch((): null => null)
            : Promise.resolve(null);
        void playerSnapshotPromise.then((playerSnapshot) => {
            if (active && playerSnapshot) {
                setDetails((current) => ({
                    ...current,
                    location: normalizedWorldId,
                    playerSnapshot
                }));
            }
        });
        Promise.all([
            vrchatInstanceRepository
                .getInstance({
                    worldId: parsedLocation.worldId,
                    instanceId: parsedLocation.instanceId
                })
                .then((response) =>
                    isRecord(response.json) ? response.json : null
                )
                .catch((): null => null),
            playerSnapshotPromise
        ])
            .then(async ([instance, playerSnapshot]) => {
                const playerContext = playerSnapshot?.context;
                const snapshotPlayers = (playerSnapshot?.players || []).map(
                    (player) => ({
                        id: player.userId,
                        userId: player.userId,
                        displayName: player.displayName,
                        joinedAt: player.joinedAt
                    })
                );
                const instanceRecord = instance || {};
                const ownerUserRecord = record(instanceRecord.ownerUser);
                const ownerRecord = record(instanceRecord.owner);
                const creatorUserRecord = record(instanceRecord.creatorUser);
                const userRecord = record(instanceRecord.user);
                const groupRecord = record(instanceRecord.group);
                const ownerId = firstText(
                    parsedLocation.userId,
                    instanceRecord.ownerUserId,
                    instanceRecord.owner_user_id,
                    instanceRecord.ownerId,
                    instanceRecord.owner_id,
                    instanceRecord.userId,
                    instanceRecord.user_id,
                    instanceRecord.creatorUserId,
                    instanceRecord.creator_user_id,
                    ownerUserRecord.id,
                    ownerUserRecord.userId,
                    ownerRecord.id,
                    ownerRecord.userId,
                    creatorUserRecord.id,
                    creatorUserRecord.userId,
                    userRecord.id,
                    userRecord.userId,
                    instanceRecord.groupId,
                    instanceRecord.group_id,
                    groupRecord.id,
                    parsedLocation.groupId
                );
                const ownerIsGroup = hasGroupIdPrefix(ownerId);
                const ownerSeed = ownerIsGroup
                    ? firstRecord(
                          instanceRecord.group,
                          instanceRecord.ownerGroup,
                          instanceRecord.owner_group,
                          groupSeed(instanceRecord.owner),
                          instanceRecord.creatorGroup,
                          instanceRecord.creator_group
                      )
                    : firstRecord(
                          instanceRecord.ownerUser,
                          instanceRecord.owner,
                          instanceRecord.creatorUser,
                          instanceRecord.user
                      );
                let ownerUser: EntityRecord | null = null;
                let ownerGroup: EntityRecord | null = null;
                if (ownerIsGroup) {
                    ownerGroup = ownerSeed
                        ? normalizeInstanceGroup(ownerSeed, ownerId)
                        : ownerId
                          ? await groupProfileRepository
                                .getGroupProfile({
                                    groupId: ownerId,
                                    includeRoles: false
                                })
                                .catch(() => ({
                                    id: ownerId,
                                    groupId: ownerId,
                                    name: ownerId
                                }))
                          : null;
                } else {
                    ownerUser = ownerSeed
                        ? ownerSeed
                        : ownerId
                          ? await userProfileRepository
                                .getUserProfile({ userId: ownerId })
                                .catch(() => ({
                                    id: ownerId,
                                    userId: ownerId,
                                    displayName: ownerId
                                }))
                          : null;
                }

                if (!active) {
                    return;
                }
                recordLocationHintsFromInstances({
                    endpoint: currentEndpoint,
                    instances: [
                        {
                            ...instanceRecord,
                            location: normalizedWorldId,
                            worldId: parsedLocation.worldId,
                            instanceId: parsedLocation.instanceId,
                            worldName,
                            users: instanceRecord.users,
                            players: instanceRecord.players || snapshotPlayers,
                            usersById: instanceRecord.usersById,
                            userIds: instanceRecord.userIds
                        }
                    ]
                });
                if (isCurrentLiveInstance) {
                    recordGameRuntimePresence({
                        endpoint: currentEndpoint,
                        currentUserId,
                        currentUserSnapshot,
                        currentLocation: normalizedWorldId,
                        currentLocationStartedAt:
                            currentLocationStartedAt ||
                            playerContext?.createdAt ||
                            '',
                        currentLocationPlayers: snapshotPlayers,
                        currentWorldName:
                            playerContext?.worldName || worldName || ''
                    });
                }
                setDetails({
                    location: normalizedWorldId,
                    instance,
                    ownerUser,
                    ownerGroup,
                    playerSnapshot
                });
            })
            .catch(() => {
                if (active) {
                    setDetails({
                        ...EMPTY_CURRENT_INSTANCE,
                        location: normalizedWorldId
                    });
                }
            });

        return () => {
            active = false;
        };
    }, [
        currentEndpoint,
        currentInstanceRosterRevision,
        currentResolvedLocation,
        currentLocationStartedAt,
        currentUserId,
        currentUserSnapshot,
        isInstanceLocation,
        normalizedWorldId,
        worldName
    ]);

    return details;
}
