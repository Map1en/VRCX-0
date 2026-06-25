import type { QueryKey } from '@tanstack/react-query';

import { queryClient } from '@/lib/queryClient';
import { normalizeVrchatEndpointKey } from '@/shared/vrchatEndpoint';

const SECOND = 1000;
const MINUTE = 60 * SECOND;

type EntityQueryPolicy = Readonly<{
    staleTime: number;
    gcTime: number;
    retry: number;
    refetchOnWindowFocus: boolean;
}>;

type EntityQueryParams = Record<string, unknown>;

type FetchWithEntityPolicyOptions<TData = unknown> = {
    queryKey: QueryKey;
    policy: EntityQueryPolicy;
    queryFn: () => Promise<TData> | TData;
    force?: boolean;
};

export const entityQueryPolicies = Object.freeze({
    instance: Object.freeze({
        staleTime: 0,
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
    avatarDialog: Object.freeze({
        staleTime: 120 * SECOND,
        gcTime: 300 * SECOND,
        retry: 1,
        refetchOnWindowFocus: false
    }),
    world: Object.freeze({
        staleTime: 0,
        gcTime: 300 * SECOND,
        retry: 1,
        refetchOnWindowFocus: false
    }),
    worldDialog: Object.freeze({
        staleTime: 0,
        gcTime: 300 * SECOND,
        retry: 1,
        refetchOnWindowFocus: false
    }),
    worldLocation: Object.freeze({
        staleTime: 0,
        gcTime: 300 * SECOND,
        retry: 1,
        refetchOnWindowFocus: false
    }),
    worldBasic: Object.freeze({
        staleTime: 0,
        gcTime: 10 * MINUTE,
        retry: 1,
        refetchOnWindowFocus: false
    }),
    group: Object.freeze({
        staleTime: 5 * MINUTE,
        gcTime: 30 * MINUTE,
        retry: 1,
        refetchOnWindowFocus: false
    }),
    groupDialog: Object.freeze({
        staleTime: 120 * SECOND,
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
    mutualCounts: Object.freeze({
        staleTime: 15 * MINUTE,
        gcTime: 60 * MINUTE,
        retry: 1,
        refetchOnWindowFocus: false
    }),
    userDialogTabCounts: Object.freeze({
        staleTime: 10 * MINUTE,
        gcTime: 10 * MINUTE,
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

function withEndpoint(queryKey: unknown[], endpoint: unknown = ''): QueryKey {
    const normalizedEndpoint = normalizeVrchatEndpointKey(endpoint);
    return normalizedEndpoint
        ? [...queryKey, { endpoint: normalizedEndpoint }]
        : queryKey;
}

function stableParams(params: unknown = {}): Record<string, unknown> {
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
    user: (userId: unknown, endpoint: unknown = '') =>
        withEndpoint(['user', userId], endpoint),
    mutualCounts: (userId: unknown, endpoint: unknown = '') =>
        withEndpoint(['user', userId, 'mutualCounts'], endpoint),
    userGroups: (userId: unknown, endpoint: unknown = '') =>
        withEndpoint(['user', userId, 'groups'], endpoint),
    instance: (worldId: unknown, instanceId: unknown, endpoint: unknown = '') =>
        withEndpoint(['instance', worldId, instanceId], endpoint),
    instanceShortName: (
        worldId: unknown,
        instanceId: unknown,
        endpoint: unknown = ''
    ) => withEndpoint(['instance', worldId, instanceId, 'shortName'], endpoint),
    avatar: (avatarId: unknown, endpoint: unknown = '') =>
        withEndpoint(['avatar', avatarId], endpoint),
    world: (worldId: unknown, endpoint: unknown = '') =>
        withEndpoint(['world', worldId], endpoint),
    group: (
        groupId: unknown,
        includeRoles: unknown = false,
        endpoint: unknown = ''
    ) => withEndpoint(['group', groupId, Boolean(includeRoles)], endpoint),
    worldsByUser: (params: EntityQueryParams = {}, endpoint: unknown = '') =>
        withEndpoint(
            ['worlds', 'user', params.userId, stableParams(params)],
            endpoint
        ),
    groupMembers: (params: EntityQueryParams = {}, endpoint: unknown = '') =>
        withEndpoint(
            ['group', params.groupId, 'members', stableParams(params)],
            endpoint
        ),
    groupGallery: (params: EntityQueryParams = {}, endpoint: unknown = '') =>
        withEndpoint(
            [
                'group',
                params.groupId,
                'gallery',
                params.galleryId,
                stableParams(params)
            ],
            endpoint
        ),
    groupCalendarList: (
        kind: unknown = 'all',
        params: EntityQueryParams = {},
        endpoint: unknown = ''
    ) => withEndpoint(['calendar', kind, stableParams(params)], endpoint),
    groupCalendarEvent: (
        {
            groupId = '',
            eventId = ''
        }: { eventId?: unknown; groupId?: unknown } = {},
        endpoint: unknown = ''
    ) => withEndpoint(['calendar', groupId, eventId], endpoint),
    avatarGallery: (avatarId: unknown, endpoint: unknown = '') =>
        withEndpoint(['avatar', avatarId, 'gallery'], endpoint),
    favoriteLimits: (endpoint: unknown = '') =>
        withEndpoint(['favorite', 'limits'], endpoint),
    userInventoryItem: (
        {
            inventoryId = '',
            userId = ''
        }: { inventoryId?: unknown; userId?: unknown } = {},
        endpoint: unknown = ''
    ) => withEndpoint(['inventory', 'item', userId, inventoryId], endpoint),
    fileAnalysis: (
        {
            fileId = '',
            version = 0,
            variant = ''
        }: { fileId?: unknown; variant?: unknown; version?: unknown } = {},
        endpoint: unknown = ''
    ) =>
        withEndpoint(
            ['analysis', fileId, Number(version), String(variant || '')],
            endpoint
        ),
    file: (fileId: unknown, endpoint: unknown = '') =>
        withEndpoint(['file', fileId], endpoint),
    avatarStyles: (endpoint: unknown = '') =>
        withEndpoint(['avatar', 'styles'], endpoint),
    representedGroup: (userId: unknown, endpoint: unknown = '') =>
        withEndpoint(['user', userId, 'representedGroup'], endpoint),
    userDialogTabCounts: (
        params: EntityQueryParams = {},
        endpoint: unknown = ''
    ) =>
        withEndpoint(
            ['user', params.userId, 'dialogTabCounts', stableParams(params)],
            endpoint
        ),
    worldPersistData: (
        {
            userId = '',
            worldId = ''
        }: { userId?: unknown; worldId?: unknown } = {},
        endpoint: unknown = ''
    ) => withEndpoint(['world', worldId, 'persistData', userId], endpoint)
});

export function toQueryOptions(
    policy: EntityQueryPolicy,
    overrides: Record<string, unknown> = {}
) {
    return {
        staleTime: policy.staleTime,
        gcTime: policy.gcTime,
        retry: policy.retry,
        refetchOnWindowFocus: policy.refetchOnWindowFocus,
        ...overrides
    };
}

export async function fetchWithEntityPolicy<TData = any>({
    queryKey,
    policy,
    queryFn,
    force = false
}: FetchWithEntityPolicyOptions<TData>): Promise<{
    data: TData;
    cache: boolean;
}> {
    const staleTime = force ? 0 : policy.staleTime;
    const queryState = queryClient.getQueryState(queryKey);
    const cache =
        !force &&
        Boolean(queryState?.dataUpdatedAt) &&
        staleTime > 0 &&
        Date.now() - (queryState?.dataUpdatedAt ?? 0) < staleTime;

    const data = await queryClient.fetchQuery<TData>({
        queryKey,
        queryFn,
        ...toQueryOptions(policy, { staleTime })
    });

    return {
        data,
        cache
    };
}

export async function fetchCachedData<TData = unknown>(
    options: FetchWithEntityPolicyOptions<TData>
): Promise<TData> {
    const { data } = await fetchWithEntityPolicy(options);
    return data;
}

export function setCachedQueryData<TData = unknown>(
    queryKey: QueryKey,
    data: TData
) {
    queryClient.setQueryData(queryKey, data);
}

export function getCachedQueryData<TData = unknown>(queryKey: QueryKey) {
    return queryClient.getQueryData<TData>(queryKey);
}

export function invalidateEntityQueries(queryKey: QueryKey) {
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
    const users = new Set<string>();
    const worlds = new Set<string>();
    const avatars = new Set<string>();
    const groups = new Set<string>();

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
