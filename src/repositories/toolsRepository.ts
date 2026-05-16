import {
    entityQueryPolicies,
    fetchCachedData,
    invalidateEntityQueries,
    queryKeys
} from '@/lib/entityQueryCache.js';
import { backend } from '@/platform/index.js';

import {
    createRequestError,
    notifyVrchatAuthFailure,
    parseJsonResponse,
    type QueryParams,
    unwrapErrorMessage
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
type GroupCalendarIdentity = {
    groupId: string;
};
type GroupCalendarEventIdentity = GroupCalendarIdentity & {
    eventId: string;
};
type BackendApiResult = {
    status: number;
    data: unknown;
    raw: unknown;
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

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object');
}

function unwrapBackendToolsResponse(
    response: BackendApiResult,
    path: string
) {
    const json = parseJsonResponse(response.data);
    if (response.status >= 400 || (isRecord(json) && 'error' in json)) {
        const requestError = createRequestError(
            unwrapErrorMessage(json, response.status, {
                fallbackMessage: 'VRChat tool request failed'
            }),
            response.status,
            path,
            json
        );
        notifyVrchatAuthFailure(requestError);
        throw new Error(requestError.message);
    }

    return {
        json,
        status: response.status,
        raw: response.raw
    };
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
            const response = await backend.app.BackendToolsCalendarsGet({
                endpoint,
                params
            });
            return unwrapBackendToolsResponse(response, 'calendar').json;
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
            const response = await backend.app.BackendToolsGroupCalendarGet({
                endpoint,
                groupId
            });
            return unwrapBackendToolsResponse(
                response,
                `calendar/${encodeURIComponent(groupId)}`
            ).json;
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
            const response =
                await backend.app.BackendToolsFollowingCalendarsGet({
                    endpoint,
                    params
                });
            return unwrapBackendToolsResponse(
                response,
                'calendar/following'
            ).json;
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
            const response = await backend.app.BackendToolsFeaturedCalendarsGet({
                endpoint,
                params
            });
            return unwrapBackendToolsResponse(
                response,
                'calendar/featured'
            ).json;
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
    const response = await backend.app.BackendToolsGroupEventFollow({
        endpoint,
        groupId,
        eventId,
        isFollowing: Boolean(isFollowing)
    });
    void invalidateEntityQueries(['calendar']);
    return unwrapBackendToolsResponse(
        response,
        `calendar/${encodeURIComponent(groupId)}/${encodeURIComponent(eventId)}/follow`
    ).json;
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
            const response =
                await backend.app.BackendToolsGroupCalendarIcsGet({
                    endpoint,
                    groupId,
                    eventId
                });
            return unwrapBackendToolsResponse(
                response,
                `calendar/${encodeURIComponent(groupId)}/${encodeURIComponent(eventId)}.ics`
            ).json;
        }
    });
}

async function saveUserNote(
    { targetUserId, note }: { targetUserId: string; note: string },
    { endpoint = '' }: RepositoryOptions = {}
) {
    const response = await backend.app.BackendToolsUserNoteSave({
        endpoint,
        targetUserId,
        note
    });
    return unwrapBackendToolsResponse(response, 'userNotes').json;
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
    const response = await backend.app.BackendToolsUserReport({
        endpoint,
        userId,
        contentType,
        reason,
        type
    });
    return unwrapBackendToolsResponse(
        response,
        `feedback/${encodeURIComponent(userId)}/user`
    ).json;
}

async function getInviteMessages(
    {
        currentUserId,
        messageType
    }: { currentUserId: string; messageType: string },
    { endpoint = '' }: RepositoryOptions = {}
) {
    const response = await backend.app.BackendToolsInviteMessagesGet({
        endpoint,
        currentUserId,
        messageType
    });
    return unwrapBackendToolsResponse(
        response,
        `message/${encodeURIComponent(currentUserId)}/${encodeURIComponent(messageType)}`
    ).json;
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
    const response = await backend.app.BackendToolsInviteMessageEdit({
        endpoint,
        currentUserId,
        messageType,
        slot: String(slot),
        message
    });
    return unwrapBackendToolsResponse(
        response,
        `message/${encodeURIComponent(currentUserId)}/${encodeURIComponent(messageType)}/${encodeURIComponent(slot)}`
    ).json;
}

const toolsRepository = Object.freeze({
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
