import type { QueryKey } from '@tanstack/react-query';

import { queryClient } from '@/lib/queryClient';
import { MINUTE_MS, SECOND_MS } from '@/shared/constants/time';
import {
    hasAvatarIdPrefix,
    hasGroupIdPrefix,
    hasUserIdPrefix,
    hasWorldIdPrefix
} from '@/shared/constants/vrchatIds';
import { normalizeVrchatEndpointKey } from '@/shared/vrchatEndpoint';

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
        gcTime: 90 * SECOND_MS,
        retry: 1,
        refetchOnWindowFocus: false
    }),
    avatar: Object.freeze({
        staleTime: 60 * SECOND_MS,
        gcTime: 300 * SECOND_MS,
        retry: 1,
        refetchOnWindowFocus: false
    }),
    avatarDialog: Object.freeze({
        staleTime: 120 * SECOND_MS,
        gcTime: 300 * SECOND_MS,
        retry: 1,
        refetchOnWindowFocus: false
    }),
    world: Object.freeze({
        staleTime: 0,
        gcTime: 300 * SECOND_MS,
        retry: 1,
        refetchOnWindowFocus: false
    }),
    worldDialog: Object.freeze({
        staleTime: 0,
        gcTime: 300 * SECOND_MS,
        retry: 1,
        refetchOnWindowFocus: false
    }),
    worldLocation: Object.freeze({
        staleTime: 0,
        gcTime: 300 * SECOND_MS,
        retry: 1,
        refetchOnWindowFocus: false
    }),
    worldBasic: Object.freeze({
        staleTime: 0,
        gcTime: 10 * MINUTE_MS,
        retry: 1,
        refetchOnWindowFocus: false
    }),
    group: Object.freeze({
        staleTime: 5 * MINUTE_MS,
        gcTime: 30 * MINUTE_MS,
        retry: 1,
        refetchOnWindowFocus: false
    }),
    groupDialog: Object.freeze({
        staleTime: 120 * SECOND_MS,
        gcTime: 30 * MINUTE_MS,
        retry: 1,
        refetchOnWindowFocus: false
    }),
    groupCollection: Object.freeze({
        staleTime: 60 * SECOND_MS,
        gcTime: 300 * SECOND_MS,
        retry: 1,
        refetchOnWindowFocus: false
    }),
    groupCalendarEvent: Object.freeze({
        staleTime: 120 * SECOND_MS,
        gcTime: 600 * SECOND_MS,
        retry: 1,
        refetchOnWindowFocus: false
    }),
    worldCollection: Object.freeze({
        staleTime: 60 * SECOND_MS,
        gcTime: 300 * SECOND_MS,
        retry: 1,
        refetchOnWindowFocus: false
    }),
    avatarGallery: Object.freeze({
        staleTime: 30 * SECOND_MS,
        gcTime: 120 * SECOND_MS,
        retry: 1,
        refetchOnWindowFocus: false
    }),
    favoriteLimits: Object.freeze({
        staleTime: 600 * SECOND_MS,
        gcTime: 1800 * SECOND_MS,
        retry: 1,
        refetchOnWindowFocus: false
    }),
    inventoryCollection: Object.freeze({
        staleTime: 20 * SECOND_MS,
        gcTime: 120 * SECOND_MS,
        retry: 1,
        refetchOnWindowFocus: false
    }),
    fileAnalysis: Object.freeze({
        staleTime: 60 * MINUTE_MS,
        gcTime: 240 * MINUTE_MS,
        retry: 1,
        refetchOnWindowFocus: false
    }),
    fileObject: Object.freeze({
        staleTime: 60 * SECOND_MS,
        gcTime: 300 * SECOND_MS,
        retry: 1,
        refetchOnWindowFocus: false
    }),
    avatarStyles: Object.freeze({
        staleTime: 60 * MINUTE_MS,
        gcTime: 240 * MINUTE_MS,
        retry: 1,
        refetchOnWindowFocus: false
    }),
    representedGroup: Object.freeze({
        staleTime: 60 * SECOND_MS,
        gcTime: 300 * SECOND_MS,
        retry: 1,
        refetchOnWindowFocus: false
    }),
    mutualCounts: Object.freeze({
        staleTime: 15 * MINUTE_MS,
        gcTime: 60 * MINUTE_MS,
        retry: 1,
        refetchOnWindowFocus: false
    }),
    userDialogTabCounts: Object.freeze({
        staleTime: 10 * MINUTE_MS,
        gcTime: 10 * MINUTE_MS,
        retry: 1,
        refetchOnWindowFocus: false
    }),
    worldPersistData: Object.freeze({
        staleTime: 30 * MINUTE_MS,
        gcTime: 120 * MINUTE_MS,
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
    userGroupsOverview: (userId: unknown, endpoint: unknown = '') =>
        withEndpoint(['user', userId, 'groupsOverview'], endpoint),
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
        if (kind === 'user' && hasUserIdPrefix(id)) {
            users.add(id);
        } else if (kind === 'world' && hasWorldIdPrefix(id)) {
            worlds.add(id);
        } else if (kind === 'avatar' && hasAvatarIdPrefix(id)) {
            avatars.add(id);
        } else if (kind === 'group' && hasGroupIdPrefix(id)) {
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
