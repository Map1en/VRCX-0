import { MonitorIcon, SmartphoneIcon, UserIcon } from 'lucide-react';

import { timeToText } from '@/lib/dateTime.js';
import { userImage } from '@/lib/entityMedia.js';
import { userStatusDotClassName } from '@/lib/userStatus.js';
import { cn } from '@/lib/utils.js';
import { openUserDialog } from '@/services/dialogService.js';
import {
    parseLocation,
    resolveFriendPresenceLocation
} from '@/shared/utils/location.js';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import {
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyTitle
} from '@/ui/shadcn/empty';
import { Spinner } from '@/ui/shadcn/spinner';

import { appI18n } from '@/services/i18nService.js';

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
    return (
        <Empty className="min-h-32 border">
            <EmptyHeader>
                <EmptyTitle>{appI18n.t('dialog.world.generated.no_active_instances')}</EmptyTitle>
                <EmptyDescription>
                    {appI18n.t('dialog.world.generated.no_public_or_group_instances_are_currently_listed')}
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

export function firstText(...values) {
    for (const value of values) {
        const text =
            typeof value === 'string'
                ? value.trim()
                : String(value ?? '').trim();
        if (text) {
            return text;
        }
    }
    return '';
}

export function isGroupId(value) {
    return firstText(value).startsWith('grp_');
}

export function groupSeed(value) {
    if (!value || typeof value !== 'object') {
        return null;
    }
    const groupId = firstText(value.groupId, value.group_id, value.id);
    return isGroupId(groupId) ? value : null;
}

function normalizeInstanceUser(value) {
    if (!value) {
        return null;
    }
    if (typeof value === 'string') {
        const userId = value.trim();
        return userId ? { id: userId, userId, displayName: userId } : null;
    }
    if (typeof value !== 'object') {
        return null;
    }
    const userId = firstText(
        value.id,
        value.userId,
        value.user_id,
        value.targetUserId,
        value.target_user_id
    );
    const displayName = firstText(
        value.displayName,
        value.display_name,
        value.username,
        value.name,
        userId
    );
    return {
        ...value,
        id: userId || value.id,
        userId: value.userId || userId,
        displayName
    };
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

export function normalizeInstanceUsers(...sources) {
    const rows = [];
    const push = (value) => {
        if (!value) {
            return;
        }
        if (value instanceof Map) {
            for (const entry of value.values()) {
                push(entry);
            }
            return;
        }
        if (Array.isArray(value)) {
            for (const entry of value) {
                push(entry);
            }
            return;
        }
        if (
            typeof value === 'object' &&
            !value.id &&
            !value.userId &&
            !value.user_id &&
            !value.targetUserId &&
            !value.target_user_id &&
            !value.displayName &&
            !value.display_name &&
            !value.username &&
            !value.name
        ) {
            for (const entry of Object.values(value)) {
                push(entry);
            }
            return;
        }
        const row = normalizeInstanceUser(value);
        if (row) {
            rows.push(row);
        }
    };

    for (const source of sources) {
        push(source);
    }
    return rows;
}

function instanceUserKey(user) {
    return firstText(
        user?.id,
        user?.userId,
        user?.user_id,
        user?.targetUserId,
        user?.target_user_id,
        user?.displayName,
        user?.display_name,
        user?.username,
        user?.name
    );
}

export function mergeInstanceUsers(...sources) {
    const usersByKey = new Map();
    const anonymousUsers = [];

    for (const user of normalizeInstanceUsers(...sources)) {
        const key = instanceUserKey(user);
        if (!key) {
            anonymousUsers.push(user);
            continue;
        }

        usersByKey.set(key, {
            ...(usersByKey.get(key) || {}),
            ...user
        });
    }

    return [...usersByKey.values(), ...anonymousUsers];
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

function timestampFromValue(value) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        return value;
    }
    const text = firstText(value);
    if (!text) {
        return 0;
    }
    const numeric = Number(text);
    if (Number.isFinite(numeric) && numeric > 0) {
        return numeric;
    }
    const parsed = Date.parse(text);
    return Number.isNaN(parsed) ? 0 : parsed;
}

function instanceUserTravelingTimestamp(user) {
    if (firstText(user?.location).toLowerCase() !== 'traveling') {
        return 0;
    }
    return (
        timestampFromValue(user?.$travelingToTime) ||
        timestampFromValue(user?.travelingToTime) ||
        timestampFromValue(user?.traveling_to_time)
    );
}

function instanceUserSubtitle(user) {
    if (user?.$subtitle) {
        return user.$subtitle;
    }
    if (instanceUserTravelingTimestamp(user)) {
        return '';
    }
    const timestamp =
        timestampFromValue(user?.$location_at) ||
        timestampFromValue(user?.locationAt) ||
        timestampFromValue(user?.location_at) ||
        timestampFromValue(user?.joinedAt) ||
        timestampFromValue(user?.joined_at) ||
        timestampFromValue(user?.created_at) ||
        timestampFromValue(user?.createdAt);
    if (timestamp) {
        return timeToText(Date.now() - timestamp);
    }
    return firstText(
        user?.subtitle,
        user?.statusDescription,
        user?.status,
        user?.stateBucket,
        user?.state
    );
}

export function InstanceUserTiles({ instance }) {
    const userMap = new Map();
    const pushUser = (user) => {
        const row = normalizeInstanceUser(user);
        if (!row) {
            return;
        }
        const key = firstText(row.id, row.userId, row.displayName);
        if (!key || userMap.has(key)) {
            return;
        }
        userMap.set(key, row);
    };

    if (instance?.creatorUserId && !isGroupId(instance.creatorUserId)) {
        pushUser({
            ...(instance.creatorUser || {}),
            id: instance.creatorUserId,
            userId: instance.creatorUser?.userId || instance.creatorUserId,
            displayName: firstText(
                instance.creatorUser?.displayName,
                instance.creatorUser?.username,
                instance.creatorUser?.name,
                instance.creatorUserId
            ),
            $subtitle: 'Instance creator'
        });
    }
    for (const user of normalizeInstanceUsers(
        instance?.users,
        instance?.players,
        instance?.playerList,
        instance?.userList,
        instance?.userIds,
        instance?.usersById
    )) {
        pushUser(user);
    }
    const users = Array.from(userMap.values());
    if (!users.length) {
        return null;
    }
    return (
        <div className="mt-2 flex flex-wrap items-start">
            {users.map((user, index) => {
                const userId = firstText(
                    user?.id,
                    user?.userId,
                    user?.user_id,
                    user?.targetUserId,
                    user?.target_user_id
                );
                const image = userImage(user, true);
                const dotClassName = userStatusDotClassName(user);
                const displayName = firstText(
                    user?.displayName,
                    user?.display_name,
                    user?.username,
                    user?.name,
                    userId,
                    'User'
                );
                const subtitle = instanceUserSubtitle(user);
                const travelingTimestamp = instanceUserTravelingTimestamp(user);
                return (
                    <Button
                        key={`${userId || displayName || 'user'}:${index}`}
                        type="button"
                        variant="ghost"
                        className="h-auto w-44 justify-start gap-2 px-1.5 py-1.5 text-left font-normal"
                        onClick={() =>
                            userId &&
                            openUserDialog({
                                userId,
                                title: displayName || undefined,
                                seedData: user
                            })
                        }
                    >
                        <span className="relative size-9 shrink-0">
                            {image ? (
                                <img
                                    src={image}
                                    alt=""
                                    className="size-9 rounded-full object-cover"
                                />
                            ) : (
                                <span className="bg-muted flex size-9 items-center justify-center rounded-full [&>svg]:size-4">
                                    <UserIcon className="text-muted-foreground" />
                                </span>
                            )}
                            {dotClassName ? (
                                <span
                                    className={cn(
                                        'border-background absolute right-0 bottom-0 z-10 size-2.5 rounded-full border',
                                        dotClassName
                                    )}
                                />
                            ) : null}
                        </span>
                        <span className="min-w-0 flex-1 overflow-hidden">
                            <span
                                className="block truncate leading-snug font-medium"
                                style={
                                    user?.$userColour
                                        ? { color: user.$userColour }
                                        : undefined
                                }
                            >
                                {displayName}
                            </span>
                            {travelingTimestamp ? (
                                <span className="text-muted-foreground block truncate text-xs">
                                    <Spinner
                                        aria-hidden="true"
                                        aria-label={undefined}
                                        role="presentation"
                                        className="mr-1 inline-block size-3"
                                    />
                                    {timeToText(
                                        Date.now() - travelingTimestamp
                                    )}
                                </span>
                            ) : subtitle ? (
                                <span className="text-muted-foreground block truncate text-xs">
                                    {subtitle}
                                </span>
                            ) : null}
                        </span>
                    </Button>
                );
            })}
        </div>
    );
}
