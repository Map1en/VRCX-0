import type { QueryKey } from '@tanstack/react-query';

import { queryClient } from '@/lib/queryClient';
import type {
    CalendarListParams,
    ReleaseStatusFilter,
    VrchatGroupGalleryInput,
    VrchatGroupMembersInput,
    VrchatWorldListByUserInput
} from '@/platform/tauri/bindings';
import { MINUTE_MS, SECOND_MS } from '@/shared/constants/time';
import {
    hasAvatarIdPrefix,
    hasGroupIdPrefix,
    hasUserIdPrefix
} from '@/shared/constants/vrchatIds';
import { normalizeVrchatEndpointKey } from '@/shared/vrchatEndpoint';

type EntityQueryPolicy = Readonly<{
    staleTime: number;
    gcTime: number;
    retry: number;
    refetchOnWindowFocus: boolean;
}>;

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
    inventoryCollection: Object.freeze({
        staleTime: 20 * SECOND_MS,
        gcTime: 120 * SECOND_MS,
        retry: 1,
        refetchOnWindowFocus: false
    }),
    inventoryTemplate: Object.freeze({
        staleTime: 60 * MINUTE_MS,
        gcTime: 240 * MINUTE_MS,
        retry: 1,
        refetchOnWindowFocus: false
    }),
    fileAnalysis: Object.freeze({
        staleTime: 120 * MINUTE_MS,
        gcTime: 240 * MINUTE_MS,
        retry: 1,
        refetchOnWindowFocus: false
    }),
    fileObject: Object.freeze({
        staleTime: 10 * MINUTE_MS,
        gcTime: 40 * MINUTE_MS,
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
    userDialogTabCounts: Object.freeze({
        staleTime: 0,
        gcTime: 10 * MINUTE_MS,
        retry: 1,
        refetchOnWindowFocus: false
    }),
    worldPersistData: Object.freeze({
        staleTime: 30 * MINUTE_MS,
        gcTime: 120 * MINUTE_MS,
        retry: 1,
        refetchOnWindowFocus: false
    }),
    userAppearanceProfile: Object.freeze({
        staleTime: 60 * SECOND_MS,
        gcTime: 300 * SECOND_MS,
        retry: 1,
        refetchOnWindowFocus: false
    }),
    userAvatarLookup: Object.freeze({
        staleTime: 30 * MINUTE_MS,
        gcTime: 5 * MINUTE_MS,
        retry: 0,
        refetchOnWindowFocus: false
    })
});

type UserDialogTabCountQueryParams = {
    userId: string;
    currentUserId: string;
    avatarReleaseStatus: ReleaseStatusFilter;
    includeMutualFriends: boolean;
};

type AggregateCalendarQueryParams = {
    date: string;
    includeFeatured: boolean;
    userId: string | null;
};

function withEndpoint(queryKey: QueryKey, endpoint: string = ''): QueryKey {
    const normalizedEndpoint = normalizeVrchatEndpointKey(endpoint);
    return normalizedEndpoint
        ? [...queryKey, { endpoint: normalizedEndpoint }]
        : queryKey;
}

function stableParams(params: object = {}): Record<string, unknown> {
    return Object.fromEntries(
        Object.entries(params)
            .filter(([, value]) => value !== undefined)
            .sort(([left], [right]) => left.localeCompare(right))
    );
}

export const queryKeys = Object.freeze({
    user: (userId: string, endpoint: string = '') =>
        withEndpoint(['user', userId], endpoint),
    userAppearanceProfile: (userId: string, endpoint: string = '') =>
        withEndpoint(['user', userId, 'appearanceProfile'], endpoint),
    userGroups: (userId: string, endpoint: string = '') =>
        withEndpoint(['user', userId, 'groups'], endpoint),
    userGroupsOverview: (userId: string, endpoint: string = '') =>
        withEndpoint(['user', userId, 'groupsOverview'], endpoint),
    instance: (worldId: string, instanceId: string, endpoint: string = '') =>
        withEndpoint(['instance', worldId, instanceId], endpoint),
    instanceShortName: (
        worldId: string,
        instanceId: string,
        endpoint: string = ''
    ) => withEndpoint(['instance', worldId, instanceId, 'shortName'], endpoint),
    group: (
        groupId: string,
        includeRoles: boolean = false,
        endpoint: string = ''
    ) => withEndpoint(['group', groupId, includeRoles], endpoint),
    worldsByUser: (params: VrchatWorldListByUserInput, endpoint: string = '') =>
        withEndpoint(
            ['worlds', 'user', params.userId, stableParams(params)],
            endpoint
        ),
    groupMembers: (params: VrchatGroupMembersInput, endpoint: string = '') =>
        withEndpoint(
            ['group', params.groupId, 'members', stableParams(params)],
            endpoint
        ),
    groupGallery: (params: VrchatGroupGalleryInput, endpoint: string = '') =>
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
        kind: 'aggregate' | 'group' | 'following',
        params:
            | AggregateCalendarQueryParams
            | CalendarListParams
            | { groupId: string },
        endpoint: string = ''
    ) => withEndpoint(['calendar', kind, stableParams(params)], endpoint),
    groupCalendarEvent: (
        {
            groupId = '',
            eventId = ''
        }: { eventId?: string; groupId?: string } = {},
        endpoint: string = ''
    ) => withEndpoint(['calendar', groupId, eventId], endpoint),
    avatarGallery: (avatarId: string, endpoint: string = '') =>
        withEndpoint(['avatar', avatarId, 'gallery'], endpoint),
    userInventoryItem: (
        {
            inventoryId = '',
            userId = ''
        }: { inventoryId?: string; userId?: string } = {},
        endpoint: string = ''
    ) => withEndpoint(['inventory', 'item', userId, inventoryId], endpoint),
    inventoryTemplate: (inventoryTemplateId: string, endpoint: string = '') =>
        withEndpoint(['inventory', 'template', inventoryTemplateId], endpoint),
    fileAnalysis: (
        {
            fileId = '',
            version = 0,
            variant = ''
        }: { fileId?: string; variant?: string; version?: number } = {},
        endpoint: string = ''
    ) => withEndpoint(['analysis', fileId, version, variant], endpoint),
    file: (fileId: string, endpoint: string = '') =>
        withEndpoint(['file', fileId], endpoint),
    avatarStyles: (endpoint: string = '') =>
        withEndpoint(['avatar', 'styles'], endpoint),
    representedGroup: (userId: string, endpoint: string = '') =>
        withEndpoint(['user', userId, 'representedGroup'], endpoint),
    userDialogTabCounts: (
        params: UserDialogTabCountQueryParams,
        endpoint: string = ''
    ) =>
        withEndpoint(
            ['user', params.userId, 'dialogTabCounts', stableParams(params)],
            endpoint
        ),
    worldPersistData: (
        {
            userId = '',
            worldId = ''
        }: { userId?: string; worldId?: string } = {},
        endpoint: string = ''
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

export async function fetchWithEntityPolicy<TData = unknown>({
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

export function getEntityQueryCacheStats() {
    const users = new Set<string>();
    const avatars = new Set<string>();
    const groups = new Set<string>();

    for (const query of queryClient.getQueryCache().getAll()) {
        const [kind, id] = Array.isArray(query.queryKey) ? query.queryKey : [];
        if (typeof id !== 'string') {
            continue;
        }
        if (kind === 'user' && hasUserIdPrefix(id)) {
            users.add(id);
        } else if (kind === 'avatar' && hasAvatarIdPrefix(id)) {
            avatars.add(id);
        } else if (kind === 'group' && hasGroupIdPrefix(id)) {
            groups.add(id);
        }
    }

    return {
        users: users.size,
        avatars: avatars.size,
        groups: groups.size
    };
}
