import type { GroupInstanceRecord } from '@/domain/entities/group';
import { hasGroupIdPrefix } from '@/shared/constants/vrchatIds';
import { parseLocation } from '@/shared/utils/location';

function firstGroupId(...values: unknown[]): string {
    for (const value of values) {
        const text =
            typeof value === 'string'
                ? value.trim()
                : String(value ?? '').trim();
        if (hasGroupIdPrefix(text)) {
            return text;
        }
    }
    return '';
}

function firstKnownNumber(...values: unknown[]): number | null {
    for (const value of values) {
        if (typeof value === 'number' && Number.isFinite(value)) {
            return value;
        }
        if (typeof value === 'string' && value.trim()) {
            const numeric = Number(value);
            if (Number.isFinite(numeric)) {
                return numeric;
            }
        }
    }
    return null;
}

export function groupInstanceLocation(instance: GroupInstanceRecord): string {
    const nestedInstance = instance.instance;
    const directLocation = instance.location || nestedInstance?.location;
    if (directLocation) {
        return directLocation;
    }
    const worldId = instance.worldId || nestedInstance?.worldId || '';
    const instanceId = instance.instanceId || nestedInstance?.instanceId || '';
    return worldId && instanceId ? `${worldId}:${instanceId}` : instanceId;
}

export function groupInstanceGroupId(instance: GroupInstanceRecord): string {
    const nestedInstance = instance.instance;
    const parsedLocation = parseLocation(groupInstanceLocation(instance));
    return firstGroupId(
        instance.group?.groupId,
        instance.group?.id,
        nestedInstance?.group?.groupId,
        nestedInstance?.group?.id,
        instance.groupId,
        instance.group_id,
        nestedInstance?.groupId,
        nestedInstance?.group_id,
        instance.ownerId,
        instance.owner_id,
        nestedInstance?.ownerId,
        nestedInstance?.owner_id,
        parsedLocation.groupId
    );
}

export function isOpenGroupInstance(instance: GroupInstanceRecord): boolean {
    const nestedInstance = instance.instance;
    return (
        instance.active !== false &&
        nestedInstance?.active !== false &&
        !instance.closedAt &&
        !nestedInstance?.closedAt
    );
}

export function groupInstanceOccupancy(instance: GroupInstanceRecord): {
    userCount: number | null;
    capacity: number | null;
} {
    const nestedInstance = instance.instance;
    return {
        userCount: firstKnownNumber(
            instance.userCount,
            instance.n_users,
            nestedInstance?.userCount,
            nestedInstance?.n_users
        ),
        capacity: firstKnownNumber(instance.capacity, nestedInstance?.capacity)
    };
}
