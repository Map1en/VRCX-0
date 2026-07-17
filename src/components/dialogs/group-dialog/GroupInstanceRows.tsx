import { UsersIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { InstanceActionBar } from '@/components/instances/InstanceActionBar';
import { LocationWorld } from '@/components/LocationWorld';
import type {
    EntityRecord,
    GroupDialogInstanceRow
} from '@/domain/entities/profileEntities';
import { hasUserIdPrefix } from '@/shared/constants/vrchatIds';
import { parseLocation } from '@/shared/utils/location';
import {
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle
} from '@/ui/shadcn/empty';

import { InstanceUserTiles } from '../world-dialog/WorldDialogViewParts';
import { firstArray, firstText } from './groupDialogUtils';

function isRecord(value: unknown): value is EntityRecord {
    return Boolean(value && typeof value === 'object');
}

function nestedRecord(value: unknown): EntityRecord {
    return isRecord(value) ? value : {};
}

function getInstanceLocation(instance: GroupDialogInstanceRow) {
    const projectedLocation = nestedRecord(instance.$location);
    const directLocation = firstText(
        instance.location,
        instance.tag,
        projectedLocation.tag
    );
    if (directLocation) {
        return directLocation;
    }
    const world = nestedRecord(instance.world);
    const worldId = firstText(instance.worldId, world.id);
    const instanceId = firstText(
        instance.instanceId,
        instance.id,
        instance.name
    );
    return worldId && instanceId ? `${worldId}:${instanceId}` : '';
}

function getInstanceTitle(instance: GroupDialogInstanceRow) {
    return firstText(
        nestedRecord(instance.world).name,
        instance.worldName,
        instance.name
    );
}

function getInstanceOwnerId(instance: GroupDialogInstanceRow) {
    const ownerUser = nestedRecord(instance.ownerUser);
    const owner = nestedRecord(instance.owner);
    const creatorUser = nestedRecord(instance.creatorUser);
    const user = nestedRecord(instance.user);
    const projectedLocation = nestedRecord(instance.$location);
    return firstText(
        instance.ownerUserId,
        instance.owner_user_id,
        instance.ownerId,
        instance.owner_id,
        instance.creatorUserId,
        instance.creator_user_id,
        instance.userId,
        instance.user_id,
        ownerUser.id,
        ownerUser.userId,
        owner.id,
        owner.userId,
        creatorUser.id,
        creatorUser.userId,
        user.id,
        user.userId,
        projectedLocation.userId,
        projectedLocation.user_id
    );
}

function getInstanceOwnerName(instance: GroupDialogInstanceRow) {
    const ownerUser = nestedRecord(instance.ownerUser);
    const owner = nestedRecord(instance.owner);
    const creatorUser = nestedRecord(instance.creatorUser);
    const user = nestedRecord(instance.user);
    return firstText(
        ownerUser.displayName,
        ownerUser.username,
        owner.displayName,
        owner.username,
        creatorUser.displayName,
        creatorUser.username,
        user.displayName,
        user.username,
        instance.ownerName,
        instance.owner_name,
        instance.ownerDisplayName,
        instance.owner_display_name
    );
}

function getInstanceUsers(instance: GroupDialogInstanceRow) {
    const ref = instance.ref;
    const users = firstArray(
        instance.users,
        Array.isArray(instance.players) ? instance.players : undefined,
        Array.isArray(instance.playerList) ? instance.playerList : undefined,
        Array.isArray(instance.userList) ? instance.userList : undefined,
        Array.isArray(ref.users) ? ref.users : undefined,
        Array.isArray(ref.players) ? ref.players : undefined
    );
    if (users.length) {
        return users;
    }
    const usersById = instance.usersById || ref.usersById;
    return usersById && typeof usersById === 'object'
        ? Object.values(usersById)
        : [];
}

function firstKnownValue(...values: unknown[]) {
    for (const value of values) {
        if (value !== null && typeof value !== 'undefined' && value !== '') {
            return value;
        }
    }
    return undefined;
}

function isUserId(value: unknown) {
    return hasUserIdPrefix(String(value || ''));
}

function normalizeGroupInstance(
    instance: GroupDialogInstanceRow,
    location: string,
    users: unknown[]
) {
    const ownerId = getInstanceOwnerId(instance);
    const ownerName = isUserId(ownerId) ? getInstanceOwnerName(instance) : '';
    const parsedLocation = parseLocation(location);
    const title = getInstanceTitle(instance);

    return {
        ...(instance.ref || {}),
        ...instance,
        location,
        tag: location,
        shortName: instance.shortName || parsedLocation.shortName || '',
        launchToken:
            instance.shortName ||
            instance.secureName ||
            parsedLocation.shortName ||
            '',
        users,
        creatorUserId: isUserId(ownerId) ? ownerId : '',
        creatorUser:
            isUserId(ownerId) && (ownerId || ownerName)
                ? {
                      id: ownerId,
                      userId: ownerId,
                      displayName: ownerName || ownerId
                  }
                : null,
        worldName: title || instance.worldName || instance.world?.name || ''
    };
}

export function GroupInstanceRows({
    instances,
    currentUserId
}: {
    instances: GroupDialogInstanceRow[];
    currentUserId: string | null;
}) {
    const { t } = useTranslation();
    const rows = Array.isArray(instances) ? instances : [];

    if (!rows.length) {
        return (
            <Empty className="min-h-32 border">
                <EmptyHeader>
                    <EmptyMedia variant="icon">
                        <UsersIcon />
                    </EmptyMedia>
                    <EmptyTitle>
                        {t('dialog.group.overview.no_active_instances')}
                    </EmptyTitle>
                    <EmptyDescription>
                        {t(
                            'dialog.group.overview.no_active_instances_description'
                        )}
                    </EmptyDescription>
                </EmptyHeader>
            </Empty>
        );
    }

    return (
        <div className="flex flex-col gap-2">
            {rows.map((instance, index) => {
                const location = getInstanceLocation(instance);
                const parsedLocation = parseLocation(location);
                const users = getInstanceUsers(instance);
                const normalizedInstance = normalizeGroupInstance(
                    instance,
                    location,
                    users
                );
                const playerCount = firstKnownValue(
                    instance.playerCount,
                    instance.userCount,
                    instance.occupants,
                    users.length
                );
                const capacity = firstKnownValue(
                    instance.capacity,
                    instance.ref.capacity,
                    nestedRecord(instance.ref.world).capacity,
                    nestedRecord(instance.world).capacity
                );
                const worldName = firstText(
                    normalizedInstance.worldName,
                    instance.worldName,
                    nestedRecord(instance.world).name
                );
                const launchToken =
                    normalizedInstance.launchToken ||
                    parsedLocation.shortName ||
                    '';

                return (
                    <div
                        key={`${location || getInstanceTitle(instance) || 'instance'}:${index}`}
                        className="bg-muted/10 hover:bg-muted/25 rounded-md border px-2.5 py-2 text-sm transition-colors"
                    >
                        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <div className="min-w-0 flex-1 overflow-hidden pr-1">
                                <LocationWorld
                                    className="max-w-full min-w-0 text-sm"
                                    locationObject={normalizedInstance}
                                    currentUserId={currentUserId}
                                    worldDialogShortName={launchToken}
                                    grouphint={firstText(
                                        instance.groupName,
                                        nestedRecord(instance.group).name
                                    )}
                                    instanceOwner={
                                        isUserId(getInstanceOwnerId(instance))
                                            ? getInstanceOwnerId(instance)
                                            : ''
                                    }
                                    instanceOwnerName={
                                        isUserId(getInstanceOwnerId(instance))
                                            ? getInstanceOwnerName(instance)
                                            : ''
                                    }
                                    playerCount={playerCount}
                                    capacity={capacity}
                                    instanceClickAction="world"
                                    showGroupName={false}
                                    showPlayerSummary={false}
                                    hint={worldName}
                                />
                            </div>
                            <InstanceActionBar
                                className="min-w-0 shrink-0 flex-wrap justify-start sm:justify-end"
                                target={{
                                    location,
                                    shortName: launchToken,
                                    worldName
                                }}
                                instance={normalizedInstance}
                                friendCount={
                                    Number(instance.friendCount) || undefined
                                }
                                playerCount={playerCount}
                                capacity={capacity}
                                instanceInfoPlacement="start"
                                instanceCountAlign="left"
                                instanceSummaryOrder="markers-first"
                            />
                        </div>
                        <InstanceUserTiles instance={normalizedInstance} />
                    </div>
                );
            })}
        </div>
    );
}
