import type {
    GroupDialogInstanceRow,
    GroupInstanceRecord
} from '@/domain/entities/group';
import type { EntityRecord } from '@/domain/entities/shared';
import type { FriendRosterById } from '@/domain/friends/types';
import { groupInstanceLocation } from '@/domain/instances/groupInstanceFacts';
import { parseLocation } from '@/shared/utils/location';
import type { CurrentUserSnapshotState } from '@/state/runtimeStore';

type InstanceUser = EntityRecord & {
    displayName?: string;
    id?: string;
    location?: string;
    travelingToLocation?: string;
    userId?: string;
};

interface MergeGroupInstancesOptions {
    groupId: string;
    friendsById:
        | FriendRosterById
        | Record<string, InstanceUser | null | undefined>;
    currentUserSnapshot: CurrentUserSnapshotState | null;
    currentLocation: string;
}

function isEntityRecord(value: unknown): value is EntityRecord {
    return Boolean(value && typeof value === 'object');
}

function entityRecord(value: unknown): EntityRecord | null {
    return isEntityRecord(value) ? value : null;
}

function entityRows(value: unknown): EntityRecord[] {
    return Array.isArray(value)
        ? value.filter((row): row is EntityRecord => Boolean(entityRecord(row)))
        : [];
}

export function normalizeEntityId(value: unknown) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

export function normalizeLocation(value: unknown) {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized && normalized !== 'offline' && normalized !== 'private'
        ? normalized
        : '';
}

export function userGroupLocation(user: InstanceUser | null | undefined) {
    const location = normalizeLocation(user?.location);
    if (location === 'traveling') {
        return normalizeLocation(user?.travelingToLocation);
    }
    return location;
}

export function instanceLocation(instance: GroupInstanceRecord) {
    const projectedLocation = entityRecord(instance.$location);
    const directLocation = normalizeLocation(
        groupInstanceLocation(instance) ||
            instance.tag ||
            projectedLocation?.tag
    );
    if (directLocation) {
        return directLocation;
    }
    const world = entityRecord(instance.world);
    const worldId = instance.worldId || world?.id || '';
    const instanceId =
        instance.instanceId || instance.id || instance.name || '';
    return worldId && instanceId ? `${worldId}:${instanceId}` : '';
}

export function mergeGroupInstances(
    baseInstances: GroupInstanceRecord[],
    {
        groupId,
        friendsById,
        currentUserSnapshot,
        currentLocation
    }: MergeGroupInstancesOptions
): GroupDialogInstanceRow[] {
    const normalizedGroupId = groupId.trim();
    const currentLocationKey = normalizeLocation(currentLocation);
    const byLocation = new Map<string, GroupDialogInstanceRow>();

    function ensureInstance(
        location: unknown,
        seed: GroupInstanceRecord = {}
    ): GroupDialogInstanceRow | null {
        const normalizedLocation = normalizeLocation(location);
        if (!normalizedLocation) {
            return null;
        }
        const parsed = parseLocation(normalizedLocation);
        const embeddedInstance = entityRecord(seed.instance);
        const world =
            entityRecord(seed.world) || entityRecord(embeddedInstance?.world);
        const existing = byLocation.get(normalizedLocation);
        if (existing) {
            const worldId = normalizeEntityId(
                seed.worldId || world?.id || parsed.worldId || existing.worldId
            );
            const instanceId = normalizeEntityId(
                seed.instanceId ||
                    seed.id ||
                    parsed.instanceId ||
                    existing.instanceId
            );
            const ref =
                entityRecord(seed.ref) || embeddedInstance || existing.ref;
            return Object.assign(existing, embeddedInstance, seed, {
                worldId,
                instanceId,
                ref,
                location: normalizedLocation,
                tag: normalizedLocation,
                users: existing.users,
                friendCount: existing.friendCount
            });
        }

        const instanceId = normalizeEntityId(
            seed.instanceId ||
                embeddedInstance?.instanceId ||
                seed.id ||
                parsed.instanceId
        );
        const row: GroupDialogInstanceRow = {
            ...embeddedInstance,
            ...seed,
            id: instanceId || normalizedLocation,
            location: normalizedLocation,
            tag: normalizedLocation,
            worldId: normalizeEntityId(
                seed.worldId || world?.id || parsed.worldId
            ),
            instanceId,
            users: entityRows(seed.users),
            friendCount: Number(seed.friendCount || seed.userCount || 0) || 0,
            ref: entityRecord(seed.ref) || embeddedInstance || seed
        };
        byLocation.set(normalizedLocation, row);
        return row;
    }

    for (const instance of baseInstances) {
        ensureInstance(instanceLocation(instance), instance);
    }

    function addUser(user: InstanceUser | null | undefined, isFriend = false) {
        const location = userGroupLocation(user);
        if (!location || !user) {
            return;
        }
        const parsed = parseLocation(location);
        if (normalizedGroupId && parsed.groupId !== normalizedGroupId) {
            return;
        }
        const row = byLocation.get(location);
        const userId = normalizeEntityId(user.id || user.userId);
        if (
            !row ||
            !userId ||
            row.users.some(
                (existing) =>
                    normalizeEntityId(existing.id || existing.userId) === userId
            )
        ) {
            return;
        }
        row.users.push(user);
        if (isFriend) {
            row.friendCount = Math.max(row.friendCount || 0, row.users.length);
        }
    }

    Object.values(friendsById).forEach((friend) => addUser(friend, true));
    if (currentUserSnapshot) {
        addUser(currentUserSnapshot, false);
    }

    return Array.from(byLocation.values())
        .map((row) => ({
            ...row,
            friendCount: row.friendCount || row.users.length,
            users: [...row.users].sort((left, right) =>
                String(left.displayName || left.id || '').localeCompare(
                    String(right.displayName || right.id || '')
                )
            )
        }))
        .sort((left, right) => {
            if (currentLocationKey && left.location === currentLocationKey) {
                return -1;
            }
            if (currentLocationKey && right.location === currentLocationKey) {
                return 1;
            }
            return (
                (right.users.length || Number(right.ref.userCount) || 0) -
                (left.users.length || Number(left.ref.userCount) || 0)
            );
        });
}
