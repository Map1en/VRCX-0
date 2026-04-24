import {
    entityQueryPolicies,
    fetchCachedData,
    queryKeys
} from '@/lib/entityQueryCache.js';

import { executeVrchatRequest } from './vrchatRequest.js';

function normalizeString(value) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function toApiAccessType(accessType) {
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

function toRegionCode(region) {
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

async function execute(
    path,
    { method = 'GET', params = {}, endpoint = '' } = {}
) {
    return executeVrchatRequest(path, {
        endpoint,
        method,
        params,
        body: params,
        skipEmptyQueryString: true,
        fallbackMessage: 'VRChat instance request failed',
        decorateError: false,
        includeParams: true
    });
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
    displayName = '',
    endpoint = ''
} = {}) {
    const normalizedWorldId = normalizeString(worldId);
    const normalizedOwnerId = normalizeString(ownerId);
    if (!normalizedWorldId) {
        throw new Error(
            'InstanceRepository.createInstance requires a world id.'
        );
    }

    const type = toApiAccessType(accessType);
    const params = {
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

    return execute('instances', {
        endpoint,
        method: 'POST',
        params
    });
}

async function getInstance({
    worldId,
    instanceId,
    endpoint = '',
    force = false
} = {}) {
    const normalizedWorldId = normalizeString(worldId);
    const normalizedInstanceId = normalizeString(instanceId);
    if (!normalizedWorldId || !normalizedInstanceId) {
        throw new Error(
            'InstanceRepository.getInstance requires world and instance ids.'
        );
    }
    const params = {
        worldId: normalizedWorldId,
        instanceId: normalizedInstanceId
    };
    const response = await fetchCachedData({
        queryKey: queryKeys.instance(
            normalizedWorldId,
            normalizedInstanceId,
            endpoint
        ),
        policy: entityQueryPolicies.instance,
        force,
        queryFn: async () => {
            const response = await execute(
                `instances/${encodeURIComponent(normalizedWorldId)}:${encodeURIComponent(normalizedInstanceId)}`,
                { endpoint }
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
    endpoint = '',
    force = false
} = {}) {
    const normalizedWorldId = normalizeString(worldId);
    const normalizedInstanceId = normalizeString(instanceId);
    if (!normalizedWorldId || !normalizedInstanceId) {
        throw new Error(
            'InstanceRepository.getInstanceShortName requires world and instance ids.'
        );
    }
    const params = shortName ? { shortName: normalizeString(shortName) } : {};
    const instance = {
        worldId: normalizedWorldId,
        instanceId: normalizedInstanceId
    };
    return fetchCachedData({
        queryKey: queryKeys.instanceShortName(
            normalizedWorldId,
            normalizedInstanceId,
            endpoint
        ),
        policy: entityQueryPolicies.instance,
        force,
        queryFn: async () => {
            const response = await execute(
                `instances/${encodeURIComponent(normalizedWorldId)}:${encodeURIComponent(normalizedInstanceId)}/shortName`,
                {
                    endpoint,
                    params
                }
            );
            return {
                ...response,
                instance,
                params
            };
        }
    });
}

async function selfInvite({
    worldId,
    instanceId,
    shortName = '',
    endpoint = ''
} = {}) {
    const normalizedWorldId = normalizeString(worldId);
    const normalizedInstanceId = normalizeString(instanceId);
    if (!normalizedWorldId || !normalizedInstanceId) {
        throw new Error(
            'InstanceRepository.selfInvite requires world and instance ids.'
        );
    }
    const locationPath = `${encodeURIComponent(normalizedWorldId)}:${encodeURIComponent(normalizedInstanceId)}`;
    return execute(`invite/myself/to/${locationPath}`, {
        endpoint,
        method: 'POST',
        params: shortName ? { shortName } : {}
    });
}

async function closeInstance({
    location,
    hardClose = false,
    endpoint = ''
} = {}) {
    const normalizedLocation = normalizeString(location);
    if (!normalizedLocation) {
        throw new Error(
            'InstanceRepository.closeInstance requires a location.'
        );
    }
    return execute(`instances/${normalizedLocation}`, {
        endpoint,
        method: 'DELETE',
        params: {
            hardClose: Boolean(hardClose)
        }
    });
}

const instanceRepository = Object.freeze({
    execute,
    createInstance,
    getInstance,
    getInstanceShortName,
    selfInvite,
    closeInstance
});

export {
    execute,
    createInstance,
    getInstance,
    getInstanceShortName,
    selfInvite,
    closeInstance
};
export default instanceRepository;
