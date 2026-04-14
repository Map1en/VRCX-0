import { safeJsonParse } from './baseRepository.js';
import { DEFAULT_ENDPOINT_DOMAIN } from './vrchatAuthRepository.js';
import webRepository from './webRepository.js';
import {
    entityQueryPolicies,
    fetchCachedData,
    queryKeys
} from '@/services/entityQueryCacheService.js';

function normalizeEndpoint(endpoint = '') {
    return (typeof endpoint === 'string' && endpoint.trim() ? endpoint.trim() : DEFAULT_ENDPOINT_DOMAIN).replace(/\/?$/, '/');
}

function normalizeString(value) {
    return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
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
    const url = new URL(path, normalizeEndpoint(endpoint));
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

class InstanceRepository {
    async execute(path, { method = 'GET', params = {}, endpoint = '' } = {}) {
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
        if (response.status >= 400 || (json && typeof json === 'object' && 'error' in json)) {
            throw new Error(unwrapErrorMessage(json, response.status));
        }
        return {
            json,
            params,
            status: response.status,
            raw: response.raw
        };
    }

    async createInstance({
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
            throw new Error('InstanceRepository.createInstance requires a world id.');
        }

        const type = toApiAccessType(accessType);
        const params = {
            type,
            canRequestInvite: accessType === 'invite+',
            worldId: normalizedWorldId,
            ownerId: type === 'group' ? normalizeString(groupId) : normalizedOwnerId,
            region: toRegionCode(region)
        };

        if (!params.ownerId && type !== 'public') {
            throw new Error('InstanceRepository.createInstance requires an owner id for private instances.');
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

        return this.execute('instances', {
            endpoint,
            method: 'POST',
            params
        });
    }

    async getInstance({ worldId, instanceId, endpoint = '', force = false } = {}) {
        const normalizedWorldId = normalizeString(worldId);
        const normalizedInstanceId = normalizeString(instanceId);
        if (!normalizedWorldId || !normalizedInstanceId) {
            throw new Error('InstanceRepository.getInstance requires world and instance ids.');
        }
        const params = { worldId: normalizedWorldId, instanceId: normalizedInstanceId };
        const response = await fetchCachedData({
            queryKey: queryKeys.instance(normalizedWorldId, normalizedInstanceId, normalizeEndpoint(endpoint)),
            policy: entityQueryPolicies.instance,
            force,
            queryFn: async () => {
                const response = await this.execute(
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

    async getInstanceShortName({ worldId, instanceId, shortName = '', endpoint = '', force = false } = {}) {
        const normalizedWorldId = normalizeString(worldId);
        const normalizedInstanceId = normalizeString(instanceId);
        if (!normalizedWorldId || !normalizedInstanceId) {
            throw new Error('InstanceRepository.getInstanceShortName requires world and instance ids.');
        }
        const params = shortName ? { shortName: normalizeString(shortName) } : {};
        const instance = {
            worldId: normalizedWorldId,
            instanceId: normalizedInstanceId
        };
        return fetchCachedData({
            queryKey: queryKeys.instanceShortName(normalizedWorldId, normalizedInstanceId, normalizeEndpoint(endpoint)),
            policy: entityQueryPolicies.instance,
            force,
            queryFn: async () => {
                const response = await this.execute(
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

    async selfInvite({ worldId, instanceId, shortName = '', endpoint = '' } = {}) {
        const normalizedWorldId = normalizeString(worldId);
        const normalizedInstanceId = normalizeString(instanceId);
        if (!normalizedWorldId || !normalizedInstanceId) {
            throw new Error('InstanceRepository.selfInvite requires world and instance ids.');
        }
        const locationPath = `${encodeURIComponent(normalizedWorldId)}:${encodeURIComponent(normalizedInstanceId)}`;
        return this.execute(`invite/myself/to/${locationPath}`, {
            endpoint,
            method: 'POST',
            params: shortName ? { shortName } : {}
        });
    }

    async closeInstance({ location, hardClose = false, endpoint = '' } = {}) {
        const normalizedLocation = normalizeString(location);
        if (!normalizedLocation) {
            throw new Error('InstanceRepository.closeInstance requires a location.');
        }
        return this.execute(`instances/${normalizedLocation}`, {
            endpoint,
            method: 'DELETE',
            params: {
                hardClose: Boolean(hardClose)
            }
        });
    }
}

const instanceRepository = new InstanceRepository();

export { InstanceRepository };
export default instanceRepository;
