import {
    entityQueryPolicies,
    fetchCachedData,
    queryKeys,
    setCachedQueryData
} from '@/lib/entityQueryCache';
import {
    commands,
    type HttpApiExecuteResponse,
    type InstanceCreateGroupAccessType,
    type InstanceCreateMinimumAvatarPerformance,
    type InstanceCreateRegion,
    type InstanceCreateRequest,
    type InstanceCreateType
} from '@/platform/tauri/bindings';
import { parseLocation } from '@/shared/utils/location';
import { isRecord } from '@/shared/utils/record';
import { DEFAULT_VRCHAT_API_ENDPOINT } from '@/shared/vrchatEndpoint';

import { type QueryParams, unwrapVrchatResponse } from './vrchatRequest';

type InstanceAccessType =
    | 'public'
    | 'friends'
    | 'friends+'
    | 'invite'
    | 'invite+'
    | 'group';

type InstanceRegion = 'US West' | 'US East' | 'Europe' | 'Japan';

interface InstanceRepositoryOptions {
    force?: boolean;
}

interface CreateInstanceOptions extends InstanceRepositoryOptions {
    worldId?: string;
    ownerId?: string;
    accessType?: InstanceAccessType;
    region?: InstanceRegion;
    groupId?: string;
    groupAccessType?: InstanceCreateGroupAccessType;
    minimumAvatarPerformance?: InstanceCreateMinimumAvatarPerformance | '';
    queueEnabled?: boolean;
    roleIds?: string[];
    ageGate?: boolean;
    displayName?: string;
}

interface InstanceIdentityOptions extends InstanceRepositoryOptions {
    worldId?: string;
    instanceId?: string;
    shortName?: string;
}

interface CloseInstanceOptions extends InstanceRepositoryOptions {
    location?: string;
    hardClose?: boolean;
}

type VrchatApiResult = HttpApiExecuteResponse;

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

function toApiAccessType(accessType: InstanceAccessType): InstanceCreateType {
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

function toRegionCode(region: InstanceRegion): InstanceCreateRegion {
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
    minimumAvatarPerformance = '',
    queueEnabled = true,
    roleIds = [],
    ageGate = false,
    displayName = ''
}: CreateInstanceOptions = {}) {
    const normalizedWorldId = worldId?.trim() ?? '';
    const normalizedOwnerId = ownerId?.trim() ?? '';
    if (!normalizedWorldId) {
        throw new Error(
            'InstanceRepository.createInstance requires a world id.'
        );
    }

    const type = toApiAccessType(accessType);
    let instanceOwnerId = normalizedOwnerId;
    if (type === 'public') {
        instanceOwnerId = '';
    } else if (type === 'group') {
        instanceOwnerId = groupId?.trim() ?? '';
    }
    const params: InstanceCreateRequest = {
        type,
        canRequestInvite: accessType === 'invite+',
        worldId: normalizedWorldId,
        region: toRegionCode(region)
    };

    if (!instanceOwnerId && type !== 'public') {
        throw new Error(
            'InstanceRepository.createInstance requires an owner id for private instances.'
        );
    }
    if (instanceOwnerId) {
        params.ownerId = instanceOwnerId;
    }

    if (type === 'group') {
        params.groupAccessType = groupAccessType;
        params.queueEnabled = queueEnabled;
        if (groupAccessType === 'members') {
            params.roleIds = roleIds;
        }
        if (minimumAvatarPerformance) {
            params.minimumAvatarPerformance = minimumAvatarPerformance;
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
        { ...params }
    );
}

async function getInstance({
    worldId,
    instanceId,
    force = false
}: InstanceIdentityOptions = {}) {
    const normalizedWorldId = worldId?.trim() ?? '';
    const normalizedInstanceId = instanceId?.trim() ?? '';
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
    const normalizedWorldId = worldId?.trim() ?? '';
    const normalizedInstanceId = instanceId?.trim() ?? '';
    if (!normalizedWorldId || !normalizedInstanceId) {
        throw new Error(
            'InstanceRepository.getInstanceShortName requires world and instance ids.'
        );
    }
    const params = shortName ? { shortName } : {};
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
                    shortName: params.shortName ?? ''
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
    const normalizedWorldId = worldId?.trim() ?? '';
    const normalizedInstanceId = instanceId?.trim() ?? '';
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
    const normalizedLocation = location?.trim() ?? '';
    if (!normalizedLocation) {
        throw new Error(
            'InstanceRepository.closeInstance requires a location.'
        );
    }
    const params: { hardClose: boolean } = {
        hardClose
    };
    const response = unwrapVrchatInstanceResponse(
        await commands.appVrchatInstanceClose({
            location: normalizedLocation,
            hardClose
        }),
        `instances/${normalizedLocation}`,
        params
    );
    const parsedLocation = parseLocation(normalizedLocation);
    if (
        parsedLocation.worldId &&
        parsedLocation.instanceId &&
        isRecord(response.json)
    ) {
        setCachedQueryData(
            queryKeys.instance(
                parsedLocation.worldId,
                parsedLocation.instanceId,
                DEFAULT_VRCHAT_API_ENDPOINT
            ),
            {
                ...response,
                params: {
                    worldId: parsedLocation.worldId,
                    instanceId: parsedLocation.instanceId
                }
            }
        );
    }
    return response;
}

const vrchatInstanceRepository = Object.freeze({
    createInstance,
    getInstance,
    getInstanceShortName,
    selfInvite,
    closeInstance
});

export default vrchatInstanceRepository;
