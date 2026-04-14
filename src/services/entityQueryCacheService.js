import { queryClient } from './queryClient.js';

const SECOND = 1000;
const MINUTE = 60 * SECOND;

export const entityQueryPolicies = Object.freeze({
    user: Object.freeze({
        staleTime: 20 * SECOND,
        gcTime: 90 * SECOND,
        retry: 1,
        refetchOnWindowFocus: false
    }),
    instance: Object.freeze({
        staleTime: 20 * SECOND,
        gcTime: 90 * SECOND,
        retry: 1,
        refetchOnWindowFocus: false
    }),
    avatar: Object.freeze({
        staleTime: 60 * SECOND,
        gcTime: 300 * SECOND,
        retry: 1,
        refetchOnWindowFocus: false
    }),
    world: Object.freeze({
        staleTime: 60 * SECOND,
        gcTime: 300 * SECOND,
        retry: 1,
        refetchOnWindowFocus: false
    }),
    group: Object.freeze({
        staleTime: 5 * MINUTE,
        gcTime: 30 * MINUTE,
        retry: 1,
        refetchOnWindowFocus: false
    }),
    groupCollection: Object.freeze({
        staleTime: 60 * SECOND,
        gcTime: 300 * SECOND,
        retry: 1,
        refetchOnWindowFocus: false
    }),
    groupCalendarEvent: Object.freeze({
        staleTime: 120 * SECOND,
        gcTime: 600 * SECOND,
        retry: 1,
        refetchOnWindowFocus: false
    }),
    worldCollection: Object.freeze({
        staleTime: 60 * SECOND,
        gcTime: 300 * SECOND,
        retry: 1,
        refetchOnWindowFocus: false
    }),
    avatarGallery: Object.freeze({
        staleTime: 30 * SECOND,
        gcTime: 120 * SECOND,
        retry: 1,
        refetchOnWindowFocus: false
    }),
    favoriteLimits: Object.freeze({
        staleTime: 600 * SECOND,
        gcTime: 1800 * SECOND,
        retry: 1,
        refetchOnWindowFocus: false
    }),
    inventoryCollection: Object.freeze({
        staleTime: 20 * SECOND,
        gcTime: 120 * SECOND,
        retry: 1,
        refetchOnWindowFocus: false
    }),
    fileAnalysis: Object.freeze({
        staleTime: 60 * MINUTE,
        gcTime: 240 * MINUTE,
        retry: 1,
        refetchOnWindowFocus: false
    }),
    fileObject: Object.freeze({
        staleTime: 60 * SECOND,
        gcTime: 300 * SECOND,
        retry: 1,
        refetchOnWindowFocus: false
    }),
    avatarStyles: Object.freeze({
        staleTime: 60 * MINUTE,
        gcTime: 240 * MINUTE,
        retry: 1,
        refetchOnWindowFocus: false
    }),
    representedGroup: Object.freeze({
        staleTime: 60 * SECOND,
        gcTime: 300 * SECOND,
        retry: 1,
        refetchOnWindowFocus: false
    }),
    worldPersistData: Object.freeze({
        staleTime: 30 * MINUTE,
        gcTime: 120 * MINUTE,
        retry: 1,
        refetchOnWindowFocus: false
    })
});

function normalizeEndpointKey(endpoint) {
    return (typeof endpoint === 'string' ? endpoint.trim() : String(endpoint ?? '').trim()).replace(/\/+$/, '');
}

function withEndpoint(queryKey, endpoint = '') {
    const normalizedEndpoint = normalizeEndpointKey(endpoint);
    return normalizedEndpoint ? [...queryKey, { endpoint: normalizedEndpoint }] : queryKey;
}

function stableParams(params = {}) {
    if (!params || typeof params !== 'object') {
        return {};
    }

    return Object.fromEntries(
        Object.entries(params)
            .filter(([, value]) => value !== undefined)
            .sort(([left], [right]) => left.localeCompare(right))
    );
}

export const queryKeys = Object.freeze({
    user: (userId, endpoint = '') => withEndpoint(['user', userId], endpoint),
    instance: (worldId, instanceId, endpoint = '') =>
        withEndpoint(['instance', worldId, instanceId], endpoint),
    instanceShortName: (worldId, instanceId, endpoint = '') =>
        withEndpoint(['instance', worldId, instanceId, 'shortName'], endpoint),
    avatar: (avatarId, endpoint = '') => withEndpoint(['avatar', avatarId], endpoint),
    world: (worldId, endpoint = '') => withEndpoint(['world', worldId], endpoint),
    group: (groupId, includeRoles = false, endpoint = '') =>
        withEndpoint(['group', groupId, Boolean(includeRoles)], endpoint),
    worldsByUser: (params = {}, endpoint = '') =>
        withEndpoint(['worlds', 'user', params.userId, stableParams(params)], endpoint),
    groupMembers: (params = {}, endpoint = '') =>
        withEndpoint(['group', params.groupId, 'members', stableParams(params)], endpoint),
    groupGallery: (params = {}, endpoint = '') =>
        withEndpoint(['group', params.groupId, 'gallery', params.galleryId, stableParams(params)], endpoint),
    groupCalendarList: (kind = 'all', params = {}, endpoint = '') =>
        withEndpoint(['calendar', kind, stableParams(params)], endpoint),
    groupCalendarEvent: ({ groupId = '', eventId = '' } = {}, endpoint = '') =>
        withEndpoint(['calendar', groupId, eventId], endpoint),
    avatarGallery: (avatarId, endpoint = '') =>
        withEndpoint(['avatar', avatarId, 'gallery'], endpoint),
    favoriteLimits: (endpoint = '') => withEndpoint(['favorite', 'limits'], endpoint),
    userInventoryItem: ({ inventoryId = '', userId = '' } = {}, endpoint = '') =>
        withEndpoint(['inventory', 'item', userId, inventoryId], endpoint),
    fileAnalysis: ({ fileId = '', version = 0, variant = '' } = {}, endpoint = '') =>
        withEndpoint(
            ['analysis', fileId, Number(version), String(variant || '')],
            endpoint
        ),
    file: (fileId, endpoint = '') => withEndpoint(['file', fileId], endpoint),
    avatarStyles: (endpoint = '') => withEndpoint(['avatar', 'styles'], endpoint),
    representedGroup: (userId, endpoint = '') =>
        withEndpoint(['user', userId, 'representedGroup'], endpoint),
    worldPersistData: ({ userId = '', worldId = '' } = {}, endpoint = '') =>
        withEndpoint(['world', worldId, 'persistData', userId], endpoint)
});

export function toQueryOptions(policy, overrides = {}) {
    return {
        staleTime: policy.staleTime,
        gcTime: policy.gcTime,
        retry: policy.retry,
        refetchOnWindowFocus: policy.refetchOnWindowFocus,
        ...overrides
    };
}

export async function fetchWithEntityPolicy({
    queryKey,
    policy,
    queryFn,
    force = false
}) {
    const staleTime = force ? 0 : policy.staleTime;
    const queryState = queryClient.getQueryState(queryKey);
    const cache =
        !force &&
        Boolean(queryState?.dataUpdatedAt) &&
        staleTime > 0 &&
        Date.now() - queryState.dataUpdatedAt < staleTime;

    const data = await queryClient.fetchQuery({
        queryKey,
        queryFn,
        ...toQueryOptions(policy, { staleTime })
    });

    return {
        data,
        cache
    };
}

export async function fetchCachedData(options) {
    const { data } = await fetchWithEntityPolicy(options);
    return data;
}

export function setCachedQueryData(queryKey, data) {
    queryClient.setQueryData(queryKey, data);
}

export function invalidateEntityQueries(queryKey) {
    return queryClient.invalidateQueries({
        queryKey,
        refetchType: 'active'
    });
}

export async function clearEntityQueryCache() {
    await queryClient.cancelQueries();
    queryClient.clear();
}

export function getEntityQueryCacheSize() {
    return queryClient.getQueryCache().getAll().length;
}

export function getEntityQueryCacheStats() {
    const users = new Set();
    const worlds = new Set();
    const avatars = new Set();
    const groups = new Set();

    for (const query of queryClient.getQueryCache().getAll()) {
        const [kind, id] = Array.isArray(query.queryKey) ? query.queryKey : [];
        if (typeof id !== 'string') {
            continue;
        }
        if (kind === 'user' && id.startsWith('usr_')) {
            users.add(id);
        } else if (kind === 'world' && id.startsWith('wrld_')) {
            worlds.add(id);
        } else if (kind === 'avatar' && id.startsWith('avtr_')) {
            avatars.add(id);
        } else if (kind === 'group' && id.startsWith('grp_')) {
            groups.add(id);
        }
    }

    return {
        users: users.size,
        worlds: worlds.size,
        avatars: avatars.size,
        groups: groups.size
    };
}
