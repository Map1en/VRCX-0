import { MonitorIcon, SmartphoneIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
    parseLocation,
    resolveFriendPresenceLocation
} from '@/shared/utils/location.js';
import { Badge } from '@/ui/shadcn/badge';
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
} from './WorldDialogInstanceUsers.jsx';

export {
    firstText,
    InstanceUserTiles,
    isGroupId,
    mergeInstanceUsers,
    normalizeInstanceUsers
} from './WorldDialogInstanceUsers.jsx';

export function PlatformBadge({ name, fileSize = '' }) {
    const normalized = String(name || '').toLowerCase();
    const Icon =
        normalized === 'pc'
            ? MonitorIcon
            : normalized === 'quest'
              ? SmartphoneIcon
              : null;
    return (
        <Badge variant="outline">
            {Icon ? <Icon data-icon="inline-start" /> : null}
            {name}
            {fileSize ? (
                <span className="ml-1 border-l pl-1">{fileSize}</span>
            ) : null}
        </Badge>
    );
}

export function WorldInstancesEmptyState() {
    const { t } = useTranslation();

    return (
        <Empty className="min-h-32 border">
            <EmptyHeader>
                <EmptyTitle>
                    {t('dialog.world.generated.no_active_instances')}
                </EmptyTitle>
                <EmptyDescription>
                    {t(
                        'dialog.world.generated.no_public_or_group_instances_are_currently_listed'
                    )}
                </EmptyDescription>
            </EmptyHeader>
        </Empty>
    );
}

export function fileAnalysisSizeForPlatform(fileAnalysis, platform) {
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

export function groupSeed(value) {
    if (!value || typeof value !== 'object') {
        return null;
    }
    const groupId = firstText(value.groupId, value.group_id, value.id);
    return isGroupId(groupId) ? value : null;
}

export function normalizeInstanceGroup(value, fallbackId = '') {
    if (!value) {
        const groupId = firstText(fallbackId);
        return groupId ? { id: groupId, groupId, name: groupId } : null;
    }
    if (typeof value === 'string') {
        const groupId = firstText(value);
        return groupId ? { id: groupId, groupId, name: groupId } : null;
    }
    if (typeof value !== 'object') {
        return null;
    }
    const nestedGroup =
        value.group && typeof value.group === 'object' ? value.group : {};
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
        displayName: value.displayName || value.display_name || name,
        iconUrl:
            value.iconUrl ||
            value.icon_url ||
            nestedGroup.iconUrl ||
            nestedGroup.icon_url ||
            '',
        thumbnailImageUrl:
            value.thumbnailImageUrl ||
            value.thumbnail_image_url ||
            nestedGroup.thumbnailImageUrl ||
            nestedGroup.thumbnail_image_url ||
            '',
        imageUrl:
            value.imageUrl ||
            value.image_url ||
            nestedGroup.imageUrl ||
            nestedGroup.image_url ||
            ''
    };
}

export function resolveInstanceRows(world) {
    if (!Array.isArray(world?.instances)) {
        return [];
    }

    return world.instances
        .map((entry) => {
            if (Array.isArray(entry)) {
                return {
                    id: String(entry[0] || '').trim(),
                    occupants: entry[1]
                };
            }
            if (entry && typeof entry === 'object') {
                const creatorId = firstText(
                    entry.$location?.userId,
                    entry.$location?.user_id,
                    entry.$location?.ownerUserId,
                    entry.$location?.owner_user_id,
                    entry.$location?.ownerId,
                    entry.$location?.owner_id,
                    entry.$location?.creatorUserId,
                    entry.$location?.creator_user_id,
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
                    entry.ownerUser?.id,
                    entry.ownerUser?.userId,
                    entry.owner?.id,
                    entry.owner?.userId,
                    entry.creatorUser?.id,
                    entry.creatorUser?.userId,
                    entry.user?.id,
                    entry.user?.userId,
                    entry.$location?.groupId,
                    entry.$location?.group_id,
                    entry.$location?.group?.id,
                    entry.groupId,
                    entry.group_id,
                    entry.group?.id,
                    entry.group?.groupId
                );
                const creatorIsGroup = isGroupId(creatorId);
                const creatorEntity =
                    entry.$location?.ownerUser ||
                    entry.$location?.owner ||
                    entry.$location?.creatorUser ||
                    entry.$location?.user ||
                    entry.creatorUser ||
                    entry.creator_user ||
                    entry.ownerUser ||
                    entry.owner ||
                    entry.user ||
                    null;
                const creatorGroupEntity =
                    entry.$location?.group ||
                    entry.$location?.ownerGroup ||
                    entry.$location?.owner_group ||
                    entry.group ||
                    entry.ownerGroup ||
                    entry.owner_group ||
                    (creatorIsGroup ? groupSeed(creatorEntity) : null);
                return {
                    ...entry,
                    id: String(entry.id || entry.instanceId || '').trim(),
                    occupants: entry.occupants,
                    location:
                        entry.location ||
                        entry.tag ||
                        (entry.id ? `${world.id}:${entry.id}` : ''),
                    users: normalizeInstanceUsers(
                        entry.users,
                        entry.players,
                        entry.playerList,
                        entry.userList,
                        entry.userIds,
                        entry.usersById,
                        entry.ref?.users,
                        entry.ref?.players
                    ),
                    creatorUserId: creatorIsGroup ? '' : creatorId,
                    creatorUser: creatorIsGroup ? null : creatorEntity,
                    creatorGroupId: creatorIsGroup ? creatorId : '',
                    creatorGroup: creatorIsGroup
                        ? normalizeInstanceGroup(creatorGroupEntity, creatorId)
                        : null
                };
            }
            return {
                id: String(entry || '').trim(),
                occupants: '',
                location: world?.id
                    ? `${world.id}:${String(entry || '').trim()}`
                    : String(entry || '').trim(),
                users: []
            };
        })
        .filter((entry) => entry.id);
}

export function resolveLaunchLocation(world, instance) {
    if (typeof instance?.location === 'string' && instance.location.trim()) {
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

export function sameInstanceLocation(world, instance, location) {
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

export function sameLocationTag(left, right) {
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

export function friendIsInInstance(friend, location) {
    return sameLocationTag(
        resolveFriendPresenceLocation(friend, { requireInstance: true }),
        location
    );
}
