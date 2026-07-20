import {
    entityQueryPolicies,
    fetchCachedData,
    queryKeys
} from '@/lib/entityQueryCache';
import { commands } from '@/platform/tauri/bindings';
import { normalizeString } from '@/shared/utils/string';
import { DEFAULT_VRCHAT_API_ENDPOINT } from '@/shared/vrchatEndpoint';

import { type QueryParams, unwrapVrchatResponse } from './vrchatRequest';

type InstanceAccessType =
    | 'public'
    | 'friends'
    | 'friends+'
    | 'invite'
    | 'invite+'
    | 'group'
    | string;

interface InstanceRepositoryOptions {
    force?: boolean;
    [key: string]: unknown;
}

interface CreateInstanceOptions extends InstanceRepositoryOptions {
    worldId?: unknown;
    ownerId?: unknown;
    accessType?: InstanceAccessType;
    region?: string;
    groupId?: unknown;
    groupAccessType?: string;
    queueEnabled?: unknown;
    roleIds?: string[];
    ageGate?: unknown;
    displayName?: string;
}

interface InstanceIdentityOptions extends InstanceRepositoryOptions {
    worldId?: unknown;
    instanceId?: unknown;
    shortName?: string;
}

interface CloseInstanceOptions extends InstanceRepositoryOptions {
    location?: unknown;
    hardClose?: unknown;
}

type VrchatApiResult = {
    status: number;
    data: unknown;
};

type VrchatInstanceIdentity = {
    worldId: string;
    instanceId: string;
};

type VrchatInstanceShortNameResponse = {
    json: Record<string, unknown>;
    status?: number;
    raw?: unknown;
    instance?: VrchatInstanceIdentity;
    params?: { shortName?: string };
};

function toApiAccessType(accessType: InstanceAccessType): string {
    if (accessType === 'friends') {
        return 'friends';
    }
    if (accessType === 'friends+') {
        return 'hidden';
    }
    if (accessType === 'invite' || accessType === 'invite+') {
        return 'private';
    }
    if (accessType === 'group') {
        return 'group';
    }
    return 'public';
}

function toRegionCode(region: string): string {
    if (region === 'US East') {
        return 'use';
    }
    if (region === 'Europe') {
        return 'eu';
    }
    if (region === 'Japan') {
        return 'jp';
    }
    return 'us';
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object');
}

function unwrapVrchatInstanceResponse(
    response: VrchatApiResult,
    path: string,
    params: QueryParams = {}
) {
    return {
        ...unwrapVrchatResponse(response, path, {
            fallbackMessage: 'VRChat instance request failed'
        }),
        params
    };
}

async function createInstance({
    worldId,
    ownerId,
    accessType = 'public',
    region = 'US West',
    groupId = '',
    groupAccessType = 'plus',
    queueEnabled = true,
    roleIds = [],
    ageGate = false,
    displayName = ''
}: CreateInstanceOptions = {}) {
    const normalizedWorldId = normalizeString(worldId);
    const normalizedOwnerId = normalizeString(ownerId);
    if (!normalizedWorldId) {
        throw new Error(
            'InstanceRepository.createInstance requires a world id.'
        );
    }

    const type = toApiAccessType(accessType);
    const params: QueryParams = {
        type,
        canRequestInvite: accessType === 'invite+',
        worldId: normalizedWorldId,
        ownerId:
            type === 'group' ? normalizeString(groupId) : normalizedOwnerId,
        region: toRegionCode(region)
    };

    if (!params.ownerId && type !== 'public') {
        throw new Error(
            'InstanceRepository.createInstance requires an owner id for private instances.'
        );
    }

    if (type === 'group') {
        params.groupAccessType = groupAccessType || 'plus';
        params.queueEnabled = Boolean(queueEnabled);
        if (params.groupAccessType === 'members' && Array.isArray(roleIds)) {
            params.roleIds = roleIds;
        }
        if (ageGate) {
            params.ageGate = true;
        }
    }

    if (displayName) {
        params.displayName = displayName;
    }

    return unwrapVrchatInstanceResponse(
        await commands.appVrchatInstanceCreate({
            params
        }),
        'instances',
        params
    );
}

async function getInstance({
    worldId,
    instanceId,
    force = false
}: InstanceIdentityOptions = {}) {
    const normalizedWorldId = normalizeString(worldId);
    const normalizedInstanceId = normalizeString(instanceId);
    if (!normalizedWorldId || !normalizedInstanceId) {
        throw new Error(
            'InstanceRepository.getInstance requires world and instance ids.'
        );
    }
    const params: VrchatInstanceIdentity = {
        worldId: normalizedWorldId,
        instanceId: normalizedInstanceId
    };
    const response = await fetchCachedData({
        queryKey: queryKeys.instance(
            normalizedWorldId,
            normalizedInstanceId,
            DEFAULT_VRCHAT_API_ENDPOINT
        ),
        policy: entityQueryPolicies.instance,
        force,
        queryFn: async () => {
            const response = unwrapVrchatInstanceResponse(
                await commands.appVrchatInstanceGet({
                    worldId: normalizedWorldId,
                    instanceId: normalizedInstanceId
                }),
                `instances/${encodeURIComponent(normalizedWorldId)}:${encodeURIComponent(normalizedInstanceId)}`,
                {}
            );
            return {
                ...response,
                params
            };
        }
    });
    return response;
}

async function getInstanceShortName({
    worldId,
    instanceId,
    shortName = '',
    force = false
}: InstanceIdentityOptions = {}) {
    const normalizedWorldId = normalizeString(worldId);
    const normalizedInstanceId = normalizeString(instanceId);
    if (!normalizedWorldId || !normalizedInstanceId) {
        throw new Error(
            'InstanceRepository.getInstanceShortName requires world and instance ids.'
        );
    }
    const params = shortName ? { shortName: normalizeString(shortName) } : {};
    const instance: VrchatInstanceIdentity = {
        worldId: normalizedWorldId,
        instanceId: normalizedInstanceId
    };
    return fetchCachedData<VrchatInstanceShortNameResponse>({
        queryKey: queryKeys.instanceShortName(
            normalizedWorldId,
            normalizedInstanceId,
            DEFAULT_VRCHAT_API_ENDPOINT
        ),
        policy: entityQueryPolicies.instance,
        force,
        queryFn: async () => {
            const response = unwrapVrchatInstanceResponse(
                await commands.appVrchatInstanceShortNameGet({
                    worldId: normalizedWorldId,
                    instanceId: normalizedInstanceId,
                    shortName:
                        typeof params.shortName === 'string'
                            ? params.shortName
                            : ''
                }),
                `instances/${encodeURIComponent(normalizedWorldId)}:${encodeURIComponent(normalizedInstanceId)}/shortName`,
                params
            );
            return {
                ...response,
                json: isRecord(response.json) ? response.json : {},
                instance,
                params
            };
        }
    });
}

async function selfInvite({
    worldId,
    instanceId,
    shortName = ''
}: InstanceIdentityOptions = {}) {
    const normalizedWorldId = normalizeString(worldId);
    const normalizedInstanceId = normalizeString(instanceId);
    if (!normalizedWorldId || !normalizedInstanceId) {
        throw new Error(
            'InstanceRepository.selfInvite requires world and instance ids.'
        );
    }
    const locationPath = `${encodeURIComponent(normalizedWorldId)}:${encodeURIComponent(normalizedInstanceId)}`;
    const params = shortName ? { shortName } : {};
    return unwrapVrchatInstanceResponse(
        await commands.appVrchatInstanceSelfInvite({
            worldId: normalizedWorldId,
            instanceId: normalizedInstanceId,
            shortName
        }),
        `invite/myself/to/${locationPath}`,
        params
    );
}

async function closeInstance({
    location,
    hardClose = false
}: CloseInstanceOptions = {}) {
    const normalizedLocation = normalizeString(location);
    if (!normalizedLocation) {
        throw new Error(
            'InstanceRepository.closeInstance requires a location.'
        );
    }
    const params: { hardClose: boolean } = {
        hardClose: Boolean(hardClose)
    };
    return unwrapVrchatInstanceResponse(
        await commands.appVrchatInstanceClose({
            location: normalizedLocation,
            hardClose: Boolean(hardClose)
        }),
        `instances/${normalizedLocation}`,
        params
    );
}

const vrchatInstanceRepository = Object.freeze({
    createInstance,
    getInstance,
    getInstanceShortName,
    selfInvite,
    closeInstance
});

export {
    createInstance,
    getInstance,
    getInstanceShortName,
    selfInvite,
    closeInstance
};
export default vrchatInstanceRepository;
