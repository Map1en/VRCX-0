import { buildLegacyInstanceTag, getLaunchURL } from '@/shared/utils/instance';
import { parseLocation } from '@/shared/utils/location';

type DynamicRecord = Record<string, unknown>;

export type WorldInstanceRecord = DynamicRecord & {
    accessType?: unknown;
    capacity?: unknown;
    creatorGroup?: unknown;
    creatorGroupId?: unknown;
    creatorUser?: unknown;
    creatorUserId?: unknown;
    group?: unknown;
    groupId?: unknown;
    group_id?: unknown;
    id?: unknown;
    instanceId?: unknown;
    location?: unknown;
    occupants?: unknown;
    owner?: unknown;
    ownerId?: unknown;
    playerCount?: unknown;
    players?: unknown;
    ref?: unknown;
    secureName?: unknown;
    shortName?: unknown;
    tag?: unknown;
    userCount?: unknown;
    userIds?: unknown;
    userList?: unknown;
    users?: unknown;
    usersById?: unknown;
};

export type CreatedInstanceFallback = DynamicRecord & {
    accessType?: unknown;
    group?: unknown;
    groupId?: unknown;
    ownerId?: unknown;
};

type LegacyInstanceForm = {
    accessType?: string;
    ageGate?: unknown;
    groupAccessType?: string;
    groupId?: string;
    groupName?: string;
    instanceName?: unknown;
    legacyUserId?: unknown;
    region?: string;
    strict?: unknown;
};

type BuildLegacyCreatedInstanceInput = {
    worldId: string;
    form: LegacyInstanceForm;
    currentUserId: unknown;
    legacySeed: string;
};

function isRecord(value: unknown): value is DynamicRecord {
    return Boolean(value && typeof value === 'object');
}

function record(value: unknown): DynamicRecord {
    return isRecord(value) ? value : {};
}

export function normalizeEntityId(value: unknown) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

export function parseRoleIds(value: unknown) {
    return String(value || '')
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
}

export function resolveInstanceLocation(worldId: unknown, instance: unknown) {
    const source = record(instance);
    if (typeof source.location === 'string' && source.location.trim()) {
        return source.location.trim();
    }
    const rawId = normalizeEntityId(source.id);
    if (rawId.includes(':')) {
        return rawId;
    }
    const instanceId = normalizeEntityId(source.instanceId || rawId);
    const normalizedWorldId = normalizeEntityId(worldId);
    return normalizedWorldId && instanceId
        ? `${normalizedWorldId}:${instanceId}`
        : '';
}

export function buildLegacyCreatedInstance({
    worldId,
    form,
    currentUserId,
    legacySeed
}: BuildLegacyCreatedInstanceInput) {
    const legacyUserId =
        normalizeEntityId(form.legacyUserId) ||
        normalizeEntityId(currentUserId);
    const instanceName =
        normalizeEntityId(form.instanceName).replace(/[^A-Za-z0-9]/g, '') ||
        legacySeed;
    const accessType = form.accessType || 'public';
    const instanceId = buildLegacyInstanceTag({
        instanceName,
        userId: legacyUserId,
        accessType,
        groupId: form.groupId || '',
        groupAccessType: form.groupAccessType || 'plus',
        region: form.region || 'US West',
        ageGate: Boolean(form.ageGate),
        strict: Boolean(
            form.strict && (accessType === 'invite' || accessType === 'friends')
        )
    });
    const location = `${worldId}:${instanceId}`;
    const parsedLocation = parseLocation(location);
    return {
        location: parsedLocation.tag || location,
        shortName: '',
        secureOrShortName: '',
        url: getLaunchURL(parsedLocation),
        accessType,
        ownerId: parsedLocation.groupId || legacyUserId,
        groupId: parsedLocation.groupId || '',
        group: parsedLocation.groupId
            ? {
                  id: parsedLocation.groupId,
                  groupId: parsedLocation.groupId,
                  name: form.groupName || parsedLocation.groupId
              }
            : null
    };
}

export function buildCreatedInstanceDetails(
    location: unknown,
    instance: unknown,
    fallback: CreatedInstanceFallback = {}
) {
    const source = record(instance);
    const owner = record(source.owner);
    const group = record(source.group);
    const parsedLocation = parseLocation(location);
    const shortName = normalizeEntityId(
        source.shortName || parsedLocation.shortName
    );
    const secureOrShortName = shortName || normalizeEntityId(source.secureName);
    const launchLocation = parsedLocation.tag || normalizeEntityId(location);
    const groupId =
        normalizeEntityId(source.groupId) ||
        normalizeEntityId(source.group_id) ||
        normalizeEntityId(group.id) ||
        normalizeEntityId(group.groupId) ||
        normalizeEntityId(fallback.groupId) ||
        normalizeEntityId(parsedLocation.groupId);
    return {
        location: launchLocation,
        shortName,
        secureOrShortName,
        accessType:
            normalizeEntityId(source.accessType) ||
            normalizeEntityId(fallback.accessType) ||
            parsedLocation.accessType,
        ownerId:
            normalizeEntityId(source.ownerId) ||
            normalizeEntityId(owner.id) ||
            normalizeEntityId(source.creatorId) ||
            normalizeEntityId(fallback.ownerId) ||
            normalizeEntityId(parsedLocation.userId),
        groupId,
        group:
            source.group ||
            fallback.group ||
            (groupId ? { id: groupId, groupId, name: groupId } : null),
        url: getLaunchURL({
            ...parsedLocation,
            shortName
        })
    };
}
