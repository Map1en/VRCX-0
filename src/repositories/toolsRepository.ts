import {
    entityQueryPolicies,
    fetchCachedData,
    invalidateEntityQueries,
    queryKeys
} from '@/lib/entityQueryCache.js';

import {
    executeVrchatBackendRequest,
    type QueryParams
} from './vrchatRequest.js';

const PAGE_SIZE = 100;

type PageParams = {
    offset: number;
    n: number;
};
type PageResponse = {
    results?: unknown[];
    json?: unknown[];
    hasNext?: boolean;
};
type CalendarListParams = QueryParams & {
    n?: number;
};
type RepositoryOptions = {
    endpoint?: string;
    force?: boolean;
};
type ExecuteOptions = RepositoryOptions & {
    method?: string;
    params?: QueryParams | null;
};
type GroupCalendarIdentity = {
    groupId: string;
};
type GroupCalendarEventIdentity = GroupCalendarIdentity & {
    eventId: string;
};

async function processAllPages(
    fetchPage: (params: PageParams) => Promise<PageResponse | unknown[]>,
    { pageSize = PAGE_SIZE }: { pageSize?: number } = {}
) {
    const results: unknown[] = [];
    for (let offset = 0; ; offset += pageSize) {
        const page = await fetchPage({ offset, n: pageSize });
        const rows = Array.isArray(page)
            ? page
            : Array.isArray(page?.results)
              ? page.results
              : Array.isArray(page?.json)
                ? page.json
                : [];
        const pageInfo = Array.isArray(page) ? null : page;
        results.push(...rows);
        if (
            rows.length === 0 ||
            pageInfo?.hasNext === false ||
            rows.length < pageSize
        ) {
            break;
        }
    }
    return results;
}

async function execute(
    path: string,
    { endpoint = '', method = 'GET', params = null }: ExecuteOptions = {}
) {
    return executeVrchatBackendRequest('VrchatToolsExecute', path, {
        endpoint,
        method,
        params,
        body: params,
        fallbackMessage: 'VRChat tool request failed',
        decorateError: false
    });
}

async function getGroupCalendars(
    params: CalendarListParams = {},
    { endpoint = '', force = false }: RepositoryOptions = {}
) {
    return fetchCachedData({
        queryKey: queryKeys.groupCalendarList('all', params, endpoint),
        policy: entityQueryPolicies.groupCollection,
        force,
        queryFn: async () => {
            const response = await execute('calendar', {
                endpoint,
                method: 'GET',
                params
            });
            return response.json;
        }
    });
}

async function getGroupCalendar(
    { groupId }: GroupCalendarIdentity,
    { endpoint = '', force = false }: RepositoryOptions = {}
) {
    return fetchCachedData({
        queryKey: queryKeys.groupCalendarList('group', { groupId }, endpoint),
        policy: entityQueryPolicies.groupCollection,
        force,
        queryFn: async () => {
            const response = await execute(
                `calendar/${encodeURIComponent(groupId)}`,
                {
                    endpoint,
                    method: 'GET'
                }
            );
            return response.json;
        }
    });
}

async function getFollowingGroupCalendars(
    params: CalendarListParams = {},
    { endpoint = '', force = false }: RepositoryOptions = {}
) {
    return fetchCachedData({
        queryKey: queryKeys.groupCalendarList('following', params, endpoint),
        policy: entityQueryPolicies.groupCollection,
        force,
        queryFn: async () => {
            const response = await execute('calendar/following', {
                endpoint,
                method: 'GET',
                params
            });
            return response.json;
        }
    });
}

async function getFeaturedGroupCalendars(
    params: CalendarListParams = {},
    { endpoint = '', force = false }: RepositoryOptions = {}
) {
    return fetchCachedData({
        queryKey: queryKeys.groupCalendarList('featured', params, endpoint),
        policy: entityQueryPolicies.groupCollection,
        force,
        queryFn: async () => {
            const response = await execute('calendar/featured', {
                endpoint,
                method: 'GET',
                params
            });
            return response.json;
        }
    });
}

async function getAllGroupCalendars(
    params: CalendarListParams = {},
    options: RepositoryOptions = {}
) {
    return processAllPages(
        (pageParams) =>
            getGroupCalendars({ ...params, ...pageParams }, options),
        { pageSize: params.n ?? PAGE_SIZE }
    );
}

async function getAllFollowingGroupCalendars(
    params: CalendarListParams = {},
    options: RepositoryOptions = {}
) {
    return processAllPages(
        (pageParams) =>
            getFollowingGroupCalendars({ ...params, ...pageParams }, options),
        { pageSize: params.n ?? PAGE_SIZE }
    );
}

async function getAllFeaturedGroupCalendars(
    params: CalendarListParams = {},
    options: RepositoryOptions = {}
) {
    return processAllPages(
        (pageParams) =>
            getFeaturedGroupCalendars({ ...params, ...pageParams }, options),
        { pageSize: params.n ?? PAGE_SIZE }
    );
}

async function followGroupEvent(
    {
        groupId,
        eventId,
        isFollowing
    }: GroupCalendarEventIdentity & { isFollowing: boolean },
    { endpoint = '' }: RepositoryOptions = {}
) {
    const response = await execute(
        `calendar/${encodeURIComponent(groupId)}/${encodeURIComponent(eventId)}/follow`,
        {
            endpoint,
            method: 'POST',
            params: { isFollowing: Boolean(isFollowing) }
        }
    );
    void invalidateEntityQueries(['calendar']);
    return response.json;
}

async function getGroupCalendarIcs(
    { groupId, eventId }: GroupCalendarEventIdentity,
    { endpoint = '', force = false }: RepositoryOptions = {}
) {
    return fetchCachedData({
        queryKey: queryKeys.groupCalendarEvent({ groupId, eventId }, endpoint),
        policy: entityQueryPolicies.groupCalendarEvent,
        force,
        queryFn: async () => {
            const response = await execute(
                `calendar/${encodeURIComponent(groupId)}/${encodeURIComponent(eventId)}.ics`,
                {
                    endpoint,
                    method: 'GET'
                }
            );
            return response.json;
        }
    });
}

async function saveUserNote(
    { targetUserId, note }: { targetUserId: string; note: string },
    { endpoint = '' }: RepositoryOptions = {}
) {
    const response = await execute('userNotes', {
        endpoint,
        method: 'POST',
        params: { targetUserId, note }
    });
    return response.json;
}

async function reportUser(
    {
        userId,
        contentType = 'user',
        reason,
        type = 'report'
    }: {
        userId: string;
        contentType?: string;
        reason: string;
        type?: string;
    },
    { endpoint = '' }: RepositoryOptions = {}
) {
    const response = await execute(
        `feedback/${encodeURIComponent(userId)}/user`,
        {
            endpoint,
            method: 'POST',
            params: { contentType, reason, type }
        }
    );
    return response.json;
}

async function getInviteMessages(
    {
        currentUserId,
        messageType
    }: { currentUserId: string; messageType: string },
    { endpoint = '' }: RepositoryOptions = {}
) {
    const response = await execute(
        `message/${encodeURIComponent(currentUserId)}/${encodeURIComponent(messageType)}`,
        {
            endpoint,
            method: 'GET'
        }
    );
    return response.json;
}

async function editInviteMessage(
    {
        currentUserId,
        messageType,
        slot,
        message
    }: {
        currentUserId: string;
        messageType: string;
        slot: number | string;
        message: string;
    },
    { endpoint = '' }: RepositoryOptions = {}
) {
    const response = await execute(
        `message/${encodeURIComponent(currentUserId)}/${encodeURIComponent(messageType)}/${encodeURIComponent(slot)}`,
        {
            endpoint,
            method: 'PUT',
            params: { message }
        }
    );
    return response.json;
}

const toolsRepository = Object.freeze({
    execute,
    getGroupCalendar,
    getGroupCalendars,
    getFollowingGroupCalendars,
    getFeaturedGroupCalendars,
    getAllGroupCalendars,
    getAllFollowingGroupCalendars,
    getAllFeaturedGroupCalendars,
    followGroupEvent,
    getGroupCalendarIcs,
    saveUserNote,
    reportUser,
    getInviteMessages,
    editInviteMessage
});

export {
    execute,
    getGroupCalendar,
    getGroupCalendars,
    getFollowingGroupCalendars,
    getFeaturedGroupCalendars,
    getAllGroupCalendars,
    getAllFollowingGroupCalendars,
    getAllFeaturedGroupCalendars,
    followGroupEvent,
    getGroupCalendarIcs,
    saveUserNote,
    reportUser,
    getInviteMessages,
    editInviteMessage
};
export default toolsRepository;
