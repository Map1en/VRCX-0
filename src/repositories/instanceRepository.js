import {
    entityQueryPolicies,
    fetchCachedData,
    queryKeys
} from '@/services/entityQueryCacheService.js';
import { getVrchatEndpointBase } from '@/shared/vrchatEndpoint.js';

import { safeJsonParse } from './baseRepository.js';
import webRepository from './webRepository.js';

function normalizeString(value) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function appendParams(url, params = {}) {
    for (const [key, value] of Object.entries(params || {})) {
        if (value === null || value === undefined || value === '') {
            continue;
        }
        if (Array.isArray(value)) {
            for (const item of value) {
                if (item !== null && item !== undefined && item !== '') {
                    url.searchParams.append(key, String(item));
                }
            }
            continue;
        }
        url.searchParams.set(key, String(value));
    }
    return url;
}

function buildUrl(path, params = {}, endpoint = '') {
    const url = new URL(path, getVrchatEndpointBase(endpoint));
    return appendParams(url, params).toString();
}

function parseResponse(data) {
    if (data === null || data === undefined || data === '') {
        return data ?? null;
    }
    return typeof data === 'string' ? safeJsonParse(data, data) : data;
}

function unwrapErrorMessage(json, status) {
    const message = json?.error?.message ?? json?.message;
    if (typeof message === 'string' && message.trim()) {
        return message.replace(/^"+|"+$/g, '');
    }
    return `VRChat instance request failed (${status})`;
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
    const response = await webRepository.execute({
        url: buildUrl(path, method === 'GET' ? params : {}, endpoint),
        method,
        ...(method === 'GET'
            ? {}
            : {
                  headers: {
                      'Content-Type': 'application/json;charset=utf-8'
                  },
                  body: JSON.stringify(params ?? {})
              })
    });
    const json = parseResponse(response.data);
    if (
        response.status >= 400 ||
        (json && typeof json === 'object' && 'error' in json)
    ) {
        throw new Error(unwrapErrorMessage(json, response.status));
    }
    return {
        json,
        params,
        status: response.status,
        raw: response.raw
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
