import { useTranslation } from 'react-i18next';

import type {
    EntityRecord,
    PlatformFileAnalysis,
    WorldProfileRecord
} from '@/domain/entities/profileEntities';
import type { InstanceRosterRow } from '@/domain/instances/instanceRoster';
import { parseLocation } from '@/shared/utils/location';
import {
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyTitle
} from '@/ui/shadcn/empty';

import {
    firstText,
    isGroupId,
    normalizeInstanceUsers
} from './WorldDialogInstanceUsers';
import type { WorldInstanceRecord } from './worldInstances';

export {
    firstText,
    InstanceUserTiles,
    isGroupId,
    mergeInstanceUsers,
    normalizeInstanceUsers
} from './WorldDialogInstanceUsers';

export type InstanceGroupRecord = EntityRecord & {
    displayName: string;
    groupId: string;
    iconUrl: string;
    id: string;
    imageUrl: string;
    name: string;
    thumbnailImageUrl: string;
};

export type WorldDialogInstanceRow = WorldInstanceRecord & {
    creatorGroup: InstanceGroupRecord | null;
    creatorGroupId: string;
    creatorUser: unknown;
    creatorUserId: string;
    id: string;
    isCurrentInstance?: boolean;
    location: string;
    users: InstanceRosterRow[];
};

type WorldLocationSource = EntityRecord & { id: string };

function isRecord(value: unknown): value is EntityRecord {
    return Boolean(value && typeof value === 'object');
}

function record(value: unknown): EntityRecord {
    return isRecord(value) ? value : {};
}

export function WorldInstancesEmptyState() {
    const { t } = useTranslation();

    return (
        <Empty className="min-h-32 border">
            <EmptyHeader>
                <EmptyTitle>
                    {t('dialog.world.empty.no_active_instances')}
                </EmptyTitle>
                <EmptyDescription>
                    {t(
                        'dialog.world.empty.no_public_or_group_instances_are_currently_listed'
                    )}
                </EmptyDescription>
            </EmptyHeader>
        </Empty>
    );
}

export function platformDisplayName(platform: string) {
    return platform === 'Quest' ? 'Android' : platform;
}

export function fileAnalysisSizeForPlatform(
    fileAnalysis: PlatformFileAnalysis | null | undefined,
    platform: string
) {
    if (platform === 'PC') {
        return fileAnalysis?.standalonewindows?._fileSize || '';
    }
    if (platform === 'Quest' || platform === 'Android') {
        return fileAnalysis?.android?._fileSize || '';
    }
    if (platform === 'iOS') {
        return fileAnalysis?.ios?._fileSize || '';
    }
    return '';
}

export function groupSeed(value: unknown) {
    if (!isRecord(value)) {
        return null;
    }
    const groupId = firstText(value.groupId, value.group_id, value.id);
    return isGroupId(groupId) ? value : null;
}

export function normalizeInstanceGroup(
    value: unknown,
    fallbackId: unknown = ''
): InstanceGroupRecord | null {
    if (!value) {
        const groupId = firstText(fallbackId);
        return groupId
            ? {
                  id: groupId,
                  groupId,
                  name: groupId,
                  displayName: groupId,
                  iconUrl: '',
                  thumbnailImageUrl: '',
                  imageUrl: ''
              }
            : null;
    }
    if (typeof value === 'string') {
        const groupId = firstText(value);
        return groupId
            ? {
                  id: groupId,
                  groupId,
                  name: groupId,
                  displayName: groupId,
                  iconUrl: '',
                  thumbnailImageUrl: '',
                  imageUrl: ''
              }
            : null;
    }
    if (!isRecord(value)) {
        return null;
    }
    const nestedGroup = record(value.group);
    const groupId = firstText(
        value.groupId,
        value.group_id,
        nestedGroup.id,
        nestedGroup.groupId,
        nestedGroup.group_id,
        isGroupId(value.id) ? value.id : '',
        fallbackId
    );
    if (!groupId) {
        return null;
    }
    const name = firstText(
        value.name,
        value.displayName,
        value.display_name,
        value.groupName,
        value.group_name,
        value.shortCode,
        nestedGroup.name,
        nestedGroup.displayName,
        nestedGroup.display_name,
        groupId
    );
    return {
        ...nestedGroup,
        ...value,
        id: groupId,
        groupId,
        name,
        displayName: firstText(value.displayName, value.display_name, name),
        iconUrl: firstText(
            value.iconUrl ||
                value.icon_url ||
                nestedGroup.iconUrl ||
                nestedGroup.icon_url ||
                ''
        ),
        thumbnailImageUrl: firstText(
            value.thumbnailImageUrl ||
                value.thumbnail_image_url ||
                nestedGroup.thumbnailImageUrl ||
                nestedGroup.thumbnail_image_url ||
                ''
        ),
        imageUrl: firstText(
            value.imageUrl ||
                value.image_url ||
                nestedGroup.imageUrl ||
                nestedGroup.image_url ||
                ''
        )
    };
}

function instanceLocationForId(world: WorldProfileRecord, instanceId: unknown) {
    const normalizedId = firstText(instanceId);
    if (!normalizedId) {
        return '';
    }
    if (normalizedId.includes(':')) {
        return normalizedId;
    }
    return world?.id ? `${world.id}:${normalizedId}` : normalizedId;
}

function parsedGroupForInstanceLocation(location: unknown) {
    const parsedLocation = parseLocation(location);
    return parsedLocation.groupId || '';
}

export function resolveInstanceRows(
    world: WorldProfileRecord
): WorldDialogInstanceRow[] {
    if (!Array.isArray(world.instances)) {
        return [];
    }

    return world.instances
        .map((entry): WorldDialogInstanceRow => {
            if (Array.isArray(entry)) {
                const id = String(entry[0] || '').trim();
                const location = instanceLocationForId(world, id);
                const groupId = parsedGroupForInstanceLocation(location);
                return {
                    id,
                    occupants: entry[1],
                    location,
                    users: [],
                    creatorUserId: '',
                    creatorUser: null,
                    creatorGroupId: groupId,
                    creatorGroup: groupId
                        ? normalizeInstanceGroup(groupId)
                        : null
                };
            }
            if (isRecord(entry)) {
                const locationData = record(entry.$location);
                const locationGroup = record(locationData.group);
                const ownerUser = record(entry.ownerUser);
                const owner = record(entry.owner);
                const creatorUser = record(entry.creatorUser);
                const user = record(entry.user);
                const group = record(entry.group);
                const ref = record(entry.ref);
                const entryLocation = firstText(
                    entry.location ||
                        entry.tag ||
                        instanceLocationForId(
                            world,
                            entry.id || entry.instanceId || ''
                        )
                );
                const parsedEntryLocation = parseLocation(entryLocation);
                const creatorId = firstText(
                    locationData.userId,
                    locationData.user_id,
                    locationData.ownerUserId,
                    locationData.owner_user_id,
                    locationData.ownerId,
                    locationData.owner_id,
                    locationData.creatorUserId,
                    locationData.creator_user_id,
                    entry.ownerUserId,
                    entry.owner_user_id,
                    entry.userId,
                    entry.user_id,
                    entry.ownerId,
                    entry.owner_id,
                    entry.creatorUserId,
                    entry.creator_user_id,
                    entry.creatorId,
                    entry.creator_id,
                    entry.instanceOwnerId,
                    entry.instance_owner_id,
                    ownerUser.id,
                    ownerUser.userId,
                    owner.id,
                    owner.userId,
                    creatorUser.id,
                    creatorUser.userId,
                    user.id,
                    user.userId,
                    locationData.groupId,
                    locationData.group_id,
                    locationGroup.id,
                    entry.groupId,
                    entry.group_id,
                    group.id,
                    group.groupId,
                    parsedEntryLocation.groupId
                );
                const creatorIsGroup = isGroupId(creatorId);
                const creatorEntity =
                    locationData.ownerUser ||
                    locationData.owner ||
                    locationData.creatorUser ||
                    locationData.user ||
                    entry.creatorUser ||
                    entry.creator_user ||
                    entry.ownerUser ||
                    entry.owner ||
                    entry.user ||
                    null;
                const creatorGroupEntity =
                    locationData.group ||
                    locationData.ownerGroup ||
                    locationData.owner_group ||
                    entry.group ||
                    entry.ownerGroup ||
                    entry.owner_group ||
                    (creatorIsGroup ? groupSeed(creatorEntity) : null);
                return {
                    ...entry,
                    id: String(entry.id || entry.instanceId || '').trim(),
                    occupants: entry.occupants,
                    location: entryLocation,
                    users: normalizeInstanceUsers(
                        entry.users,
                        entry.players,
                        entry.playerList,
                        entry.userList,
                        entry.userIds,
                        entry.usersById,
                        ref.users,
                        ref.players
                    ),
                    creatorUserId: creatorIsGroup ? '' : creatorId,
                    creatorUser: creatorIsGroup ? null : creatorEntity,
                    creatorGroupId: creatorIsGroup ? creatorId : '',
                    creatorGroup: creatorIsGroup
                        ? normalizeInstanceGroup(creatorGroupEntity, creatorId)
                        : null
                };
            }
            const id = String(entry || '').trim();
            const location = instanceLocationForId(world, id);
            const groupId = parsedGroupForInstanceLocation(location);
            return {
                id,
                occupants: '',
                location,
                users: [],
                creatorUserId: '',
                creatorUser: null,
                creatorGroupId: groupId,
                creatorGroup: groupId ? normalizeInstanceGroup(groupId) : null
            };
        })
        .filter((entry) => entry.id);
}

export function resolveLaunchLocation(
    world: WorldLocationSource,
    instance: WorldInstanceRecord
) {
    if (typeof instance.location === 'string' && instance.location.trim()) {
        return instance.location.trim();
    }
    const instanceId = String(
        instance?.id || instance?.instanceId || ''
    ).trim();
    if (instanceId.includes(':')) {
        return instanceId;
    }
    return world?.id && instanceId ? `${world.id}:${instanceId}` : '';
}

export function sameInstanceLocation(
    world: WorldLocationSource,
    instance: WorldInstanceRecord,
    location: unknown
) {
    const normalizedLocation = firstText(location);
    if (!normalizedLocation) {
        return false;
    }
    return (
        sameLocationTag(
            resolveLaunchLocation(world, instance),
            normalizedLocation
        ) ||
        sameLocationTag(
            firstText(instance?.location, instance?.tag),
            normalizedLocation
        )
    );
}

export function sameLocationTag(left: unknown, right: unknown) {
    const leftLocation = firstText(left);
    const rightLocation = firstText(right);
    if (!leftLocation || !rightLocation) {
        return false;
    }
    if (leftLocation === rightLocation) {
        return true;
    }
    const leftParsed = parseLocation(leftLocation);
    const rightParsed = parseLocation(rightLocation);
    return Boolean(
        leftParsed.worldId &&
        rightParsed.worldId &&
        leftParsed.worldId === rightParsed.worldId &&
        leftParsed.instanceId &&
        rightParsed.instanceId &&
        leftParsed.instanceId === rightParsed.instanceId
    );
}
