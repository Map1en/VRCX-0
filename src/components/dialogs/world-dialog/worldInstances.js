import {
    buildLegacyInstanceTag,
    getLaunchURL
} from '@/shared/utils/instance.js';
import { parseLocation } from '@/shared/utils/locationParser.js';

export function normalizeEntityId(value) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

export function parseRoleIds(value) {
    return String(value || '')
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
}

export function resolveInstanceLocation(worldId, instance) {
    if (typeof instance?.location === 'string' && instance.location.trim()) {
        return instance.location.trim();
    }
    const rawId = normalizeEntityId(instance?.id);
    if (rawId.includes(':')) {
        return rawId;
    }
    const instanceId = normalizeEntityId(instance?.instanceId || rawId);
    return worldId && instanceId ? `${worldId}:${instanceId}` : '';
}

export function buildLegacyCreatedInstance({
    worldId,
    form,
    currentUserId,
    legacySeed
}) {
    const legacyUserId = normalizeEntityId(form.legacyUserId) || currentUserId;
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
        ownerId: legacyUserId
    };
}

export function buildCreatedInstanceDetails(location, instance, fallback = {}) {
    const parsedLocation = parseLocation(location);
    const shortName = normalizeEntityId(
        instance?.shortName || parsedLocation.shortName
    );
    const secureOrShortName =
        shortName || normalizeEntityId(instance?.secureName);
    const launchLocation = parsedLocation.tag || location;
    return {
        location: launchLocation,
        shortName,
        secureOrShortName,
        accessType:
            normalizeEntityId(instance?.accessType) ||
            normalizeEntityId(fallback.accessType) ||
            parsedLocation.accessType,
        ownerId:
            normalizeEntityId(instance?.ownerId) ||
            normalizeEntityId(instance?.owner?.id) ||
            normalizeEntityId(instance?.creatorId) ||
            normalizeEntityId(fallback.ownerId) ||
            normalizeEntityId(parsedLocation.userId),
        url: getLaunchURL({
            ...parsedLocation,
            shortName
        })
    };
}
