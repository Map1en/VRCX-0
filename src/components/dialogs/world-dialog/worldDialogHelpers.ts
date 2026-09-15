import type { TFunction } from 'i18next';

import { defaultWorldCacheInfo } from '@/lib/worldAssetBundle';
import type {
    InstanceCreateGroupAccessType,
    InstanceCreateMinimumAvatarPerformance
} from '@/platform/tauri/bindings';
import { isRecord } from '@/shared/utils/record';
import { normalizeString } from '@/shared/utils/string';
import type { WorldNewInstanceDefaults } from '@/state/dialogStore';

import type {
    InstanceGroupOption,
    WorldInstanceAccessType,
    WorldInstanceRegion,
    WorldNewInstanceForm
} from './worldNewInstanceTypes';

function isWorldNotFoundMessage(message: unknown, worldId: string) {
    const normalizedMessage = normalizeString(message);
    const normalizedWorldId = normalizeString(worldId);
    const match = /^World\s+(.+?)\s+not found\.?$/i.exec(normalizedMessage);

    return (
        Boolean(normalizedWorldId) &&
        normalizeString(match?.[1]) === normalizedWorldId
    );
}

export function worldLoadErrorDescription(
    error: unknown,
    t: TFunction,
    worldId: string,
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

export function normalizeInstanceRegion(
    value: string | null | undefined
): WorldInstanceRegion | '' {
    const region = value?.trim() ?? '';
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
            return '';
    }
}

export function normalizeInstanceAccessType(
    value: string | null | undefined
): WorldInstanceAccessType | '' {
    const accessType = value?.trim() ?? '';
    if (
        accessType === 'public' ||
        accessType === 'friends' ||
        accessType === 'friends+' ||
        accessType === 'invite' ||
        accessType === 'invite+' ||
        accessType === 'group'
    ) {
        return accessType;
    }
    return '';
}

export function normalizeGroupAccessType(
    value: string | null | undefined
): InstanceCreateGroupAccessType | '' {
    const accessType = value?.trim() ?? '';
    if (
        accessType === 'members' ||
        accessType === 'plus' ||
        accessType === 'public'
    ) {
        return accessType;
    }
    return '';
}

export function normalizeMinimumAvatarPerformance(
    value: string | null | undefined
): InstanceCreateMinimumAvatarPerformance | '' {
    const performance = value?.trim() ?? '';
    if (
        performance === 'Poor' ||
        performance === 'Medium' ||
        performance === 'Good'
    ) {
        return performance;
    }
    return '';
}

type NewInstanceSeed = Partial<
    Pick<
        WorldNewInstanceForm,
        'accessType' | 'region' | 'groupId' | 'groupName' | 'groupAccessType'
    >
>;

export function normalizeNewInstanceSeed(
    seed: WorldNewInstanceDefaults | null
): NewInstanceSeed {
    const groupId = seed?.groupId?.trim() ?? '';
    const accessType = normalizeInstanceAccessType(seed?.accessType);
    const region = normalizeInstanceRegion(seed?.region);
    const groupAccessType = normalizeGroupAccessType(seed?.groupAccessType);
    return {
        ...(accessType ? { accessType } : {}),
        ...(region ? { region } : {}),
        ...(groupId ? { accessType: 'group', groupId } : {}),
        ...(groupAccessType ? { groupAccessType } : {}),
        ...(seed?.groupName ? { groupName: seed.groupName.trim() } : {})
    };
}

export function groupOptionId(group: unknown) {
    if (!isRecord(group)) {
        return '';
    }
    return normalizeString(group.groupId || group.id);
}

export function findGroupOption(
    groups: unknown,
    groupId: string
): InstanceGroupOption | null {
    const normalizedGroupId = normalizeString(groupId);
    if (!normalizedGroupId) {
        return null;
    }
    const group = (Array.isArray(groups) ? groups : []).find(
        (candidate) => groupOptionId(candidate) === normalizedGroupId
    );
    if (!isRecord(group)) {
        return null;
    }
    const { id, groupId: optionGroupId, displayName, ...rest } = group;
    return {
        ...rest,
        ...(id === undefined ? {} : { id: normalizeString(id) }),
        ...(optionGroupId === undefined
            ? {}
            : { groupId: normalizeString(optionGroupId) }),
        name: normalizeString(group.name),
        ...(displayName === undefined
            ? {}
            : { displayName: normalizeString(displayName) })
    };
}
