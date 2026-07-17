import type { TFunction } from 'i18next';

import type { EntityRecord } from '@/domain/entities/profileEntities';
import { defaultWorldCacheInfo } from '@/lib/worldAssetBundle';

import { normalizeEntityId } from './worldInstances';

type InstanceGroupOption = EntityRecord & {
    groupId?: unknown;
    id?: unknown;
    name: string;
};

function isRecord(value: unknown): value is EntityRecord {
    return Boolean(value && typeof value === 'object');
}

export function isWorldNotFoundMessage(message: unknown, worldId: unknown) {
    const normalizedMessage = normalizeEntityId(message);
    const normalizedWorldId = normalizeEntityId(worldId);
    const match = /^World\s+(.+?)\s+not found\.?$/i.exec(normalizedMessage);

    return (
        Boolean(normalizedWorldId) &&
        normalizeEntityId(match?.[1]) === normalizedWorldId
    );
}

export function worldLoadErrorDescription(
    error: unknown,
    t: TFunction,
    worldId: unknown,
    fallbackKey: string
) {
    if (error instanceof Error) {
        if (isWorldNotFoundMessage(error.message, worldId)) {
            return t('dialog.world.error.world_not_found_description', {
                worldId
            });
        }
        return error.message;
    }

    return t(fallbackKey);
}

export function defaultWorldSideData() {
    return {
        fileAnalysis: {},
        cache: defaultWorldCacheInfo()
    };
}

export function normalizeInstanceRegion(value: unknown) {
    const region = normalizeEntityId(value);
    switch (region) {
        case 'us':
        case 'US West':
            return 'US West';
        case 'use':
        case 'US East':
            return 'US East';
        case 'eu':
        case 'Europe':
            return 'Europe';
        case 'jp':
        case 'Japan':
            return 'Japan';
        default:
            return region;
    }
}

export function normalizeNewInstanceSeed(seed: unknown) {
    if (!isRecord(seed)) {
        return {};
    }
    const groupId = normalizeEntityId(seed.groupId);
    return {
        ...(seed.accessType
            ? { accessType: normalizeEntityId(seed.accessType) }
            : {}),
        ...(seed.region
            ? { region: normalizeInstanceRegion(seed.region) }
            : {}),
        ...(groupId ? { accessType: 'group', groupId } : {}),
        ...(seed.groupAccessType
            ? { groupAccessType: normalizeEntityId(seed.groupAccessType) }
            : {}),
        ...(seed.groupName
            ? { groupName: normalizeEntityId(seed.groupName) }
            : {})
    };
}

export function groupOptionId(group: unknown) {
    if (!isRecord(group)) {
        return '';
    }
    return normalizeEntityId(group.groupId || group.id);
}

export function findGroupOption(
    groups: unknown,
    groupId: unknown
): InstanceGroupOption | null {
    const normalizedGroupId = normalizeEntityId(groupId);
    if (!normalizedGroupId) {
        return null;
    }
    const group = (Array.isArray(groups) ? groups : []).find(
        (candidate) => groupOptionId(candidate) === normalizedGroupId
    );
    if (!isRecord(group)) {
        return null;
    }
    return {
        ...group,
        name: normalizeEntityId(group.name)
    };
}
