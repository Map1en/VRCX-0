import {
    entityQueryPolicies,
    fetchCachedData,
    queryKeys
} from '@/lib/entityQueryCache.js';
import { backend } from '@/platform/index.js';

import {
    createRequestError,
    notifyVrchatAuthFailure,
    parseJsonResponse,
    unwrapErrorMessage,
    type QueryParams
} from './vrchatRequest.js';

type InstanceAccessType =
    | 'public'
    | 'friends'
    | 'friends+'
    | 'invite'
    | 'invite+'
    | 'group'
    | string;

interface InstanceRepositoryOptions {
    endpoint?: string;
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

type BackendApiResult = {
    status: number;
    data: unknown;
    raw: unknown;
};

function normalizeString(value: unknown): string {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

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

function unwrapBackendInstanceResponse(
    response: BackendApiResult,
    path: string,
    params: QueryParams = {}
) {
    const json = parseJsonResponse(response.data);
    if (response.status >= 400 || (isRecord(json) && 'error' in json)) {
        const message = unwrapErrorMessage(json, response.status, {
            fallbackMessage: 'VRChat instance request failed'
        });
        const requestError = createRequestError(
            message,
            response.status,
            path,
            json
        );
        notifyVrchatAuthFailure(requestError);
        throw new Error(message);
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

    return unwrapBackendInstanceResponse(
        await backend.app.BackendInstanceCreate({
            endpoint,
            params
        }),
        'instances',
        params
    );
}

async function getInstance({
    worldId,
    instanceId,
    endpoint = '',
    force = false
}: InstanceIdentityOptions = {}) {
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
            const response = unwrapBackendInstanceResponse(
                await backend.app.BackendInstanceGet({
                    endpoint,
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
    endpoint = '',
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
            const response = unwrapBackendInstanceResponse(
                await backend.app.BackendInstanceShortNameGet({
                    endpoint,
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
    return unwrapBackendInstanceResponse(
        await backend.app.BackendInstanceSelfInvite({
            endpoint,
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
    hardClose = false,
    endpoint = ''
}: CloseInstanceOptions = {}) {
    const normalizedLocation = normalizeString(location);
    if (!normalizedLocation) {
        throw new Error(
            'InstanceRepository.closeInstance requires a location.'
        );
    }
    const params = {
        hardClose: Boolean(hardClose)
    };
    return unwrapBackendInstanceResponse(
        await backend.app.BackendInstanceClose({
            endpoint,
            location: normalizedLocation,
            hardClose: Boolean(hardClose)
        }),
        `instances/${normalizedLocation}`,
        params
    );
}

const instanceRepository = Object.freeze({
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
export default instanceRepository;
