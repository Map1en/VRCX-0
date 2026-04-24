import {
    entityQueryPolicies,
    fetchCachedData,
    invalidateEntityQueries,
    queryKeys
} from '@/lib/entityQueryCache.js';

import { executeVrchatRequest } from './vrchatRequest.js';

const PAGE_SIZE = 100;

async function processAllPages(fetchPage, { pageSize = PAGE_SIZE } = {}) {
    const results = [];
    for (let offset = 0; ; offset += pageSize) {
        const page = await fetchPage({ offset, n: pageSize });
        const rows = Array.isArray(page)
            ? page
            : Array.isArray(page?.results)
              ? page.results
              : Array.isArray(page?.json)
                ? page.json
                : [];
        results.push(...rows);
        if (
            rows.length === 0 ||
            page?.hasNext === false ||
            rows.length < pageSize
        ) {
            break;
        }
    }
    return results;
}

async function execute(
    path,
    { endpoint = '', method = 'GET', params = null } = {}
) {
    return executeVrchatRequest(path, {
        endpoint,
        method,
        params,
        body: params,
        fallbackMessage: 'VRChat tool request failed',
        decorateError: false
    });
}

async function getGroupCalendars(
    params = {},
    { endpoint = '', force = false } = {}
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

async function getFollowingGroupCalendars(
    params = {},
    { endpoint = '', force = false } = {}
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
    params = {},
    { endpoint = '', force = false } = {}
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

async function getAllGroupCalendars(params = {}, options = {}) {
    return processAllPages(
        (pageParams) =>
            getGroupCalendars({ ...params, ...pageParams }, options),
        { pageSize: params.n ?? PAGE_SIZE }
    );
}

async function getAllFollowingGroupCalendars(params = {}, options = {}) {
    return processAllPages(
        (pageParams) =>
            getFollowingGroupCalendars({ ...params, ...pageParams }, options),
        { pageSize: params.n ?? PAGE_SIZE }
    );
}

async function getAllFeaturedGroupCalendars(params = {}, options = {}) {
    return processAllPages(
        (pageParams) =>
            getFeaturedGroupCalendars({ ...params, ...pageParams }, options),
        { pageSize: params.n ?? PAGE_SIZE }
    );
}

async function followGroupEvent(
    { groupId, eventId, isFollowing },
    { endpoint = '' } = {}
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
    { groupId, eventId },
    { endpoint = '', force = false } = {}
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

async function saveUserNote({ targetUserId, note }, { endpoint = '' } = {}) {
    const response = await execute('userNotes', {
        endpoint,
        method: 'POST',
        params: { targetUserId, note }
    });
    return response.json;
}

async function reportUser(
    { userId, contentType = 'user', reason, type = 'report' },
    { endpoint = '' } = {}
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
    { currentUserId, messageType },
    { endpoint = '' } = {}
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
    { currentUserId, messageType, slot, message },
    { endpoint = '' } = {}
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
