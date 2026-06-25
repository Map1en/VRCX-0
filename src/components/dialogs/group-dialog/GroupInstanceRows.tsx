import { UsersIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { InstanceActionBar } from '@/components/instances/InstanceActionBar';
import { LocationWorld } from '@/components/LocationWorld';
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

function getInstanceLocation(instance: any) {
    const directLocation =
        instance?.location || instance?.tag || instance?.$location?.tag;
    if (directLocation) {
        return directLocation;
    }
    const worldId = instance?.worldId || instance?.world?.id;
    const instanceId = instance?.instanceId || instance?.id || instance?.name;
    return worldId && instanceId ? `${worldId}:${instanceId}` : '';
}

function getInstanceTitle(instance: any) {
    return instance?.world?.name || instance?.worldName || instance?.name || '';
}

function getInstanceOwnerId(instance: any) {
    return firstText(
        instance?.ownerUserId,
        instance?.owner_user_id,
        instance?.ownerId,
        instance?.owner_id,
        instance?.creatorUserId,
        instance?.creator_user_id,
        instance?.userId,
        instance?.user_id,
        instance?.ownerUser?.id,
        instance?.ownerUser?.userId,
        instance?.owner?.id,
        instance?.owner?.userId,
        instance?.creatorUser?.id,
        instance?.creatorUser?.userId,
        instance?.user?.id,
        instance?.user?.userId,
        instance?.$location?.userId,
        instance?.$location?.user_id
    );
}

function getInstanceOwnerName(instance: any) {
    return firstText(
        instance?.ownerUser?.displayName,
        instance?.ownerUser?.username,
        instance?.owner?.displayName,
        instance?.owner?.username,
        instance?.creatorUser?.displayName,
        instance?.creatorUser?.username,
        instance?.user?.displayName,
        instance?.user?.username,
        instance?.ownerName,
        instance?.owner_name,
        instance?.ownerDisplayName,
        instance?.owner_display_name
    );
}

function getInstanceUsers(instance: any) {
    const users = firstArray(
        instance?.users,
        instance?.players,
        instance?.playerList,
        instance?.userList,
        instance?.ref?.users,
        instance?.ref?.players
    );
    if (users.length) {
        return users;
    }
    const usersById = instance?.usersById || instance?.ref?.usersById;
    return usersById && typeof usersById === 'object'
        ? Object.values(usersById)
        : [];
}

function firstKnownValue(...values: any[]) {
    for (const value of values) {
        if (value !== null && typeof value !== 'undefined' && value !== '') {
            return value;
        }
    }
    return undefined;
}

function isUserId(value: any) {
    return String(value || '').startsWith('usr_');
}

function normalizeGroupInstance(instance: any, location: any, users: any) {
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

export function GroupInstanceRows({ instances, currentUserId }: any) {
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
            {rows.map((instance: any, index: any) => {
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
                    instance.ref?.capacity,
                    instance.ref?.world?.capacity,
                    instance.world?.capacity
                );
                const worldName =
                    normalizedInstance.worldName ||
                    instance.worldName ||
                    instance.world?.name ||
                    '';
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
                                    grouphint={
                                        instance.groupName ||
                                        instance.group?.name ||
                                        ''
                                    }
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
