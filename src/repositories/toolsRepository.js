import webRepository from './webRepository.js';
import { safeJsonParse } from './baseRepository.js';
import { DEFAULT_ENDPOINT_DOMAIN } from './vrchatAuthRepository.js';
import {
    entityQueryPolicies,
    fetchCachedData,
    invalidateEntityQueries,
    queryKeys
} from '@/services/entityQueryCacheService.js';

const PAGE_SIZE = 100;

function normalizeEndpointDomain(endpointDomain) {
    if (typeof endpointDomain === 'string' && endpointDomain.trim()) {
        return endpointDomain.trim();
    }
    return DEFAULT_ENDPOINT_DOMAIN;
}

function buildUrl(path, params = {}, endpoint = '') {
    const baseUrl = normalizeEndpointDomain(endpoint).replace(/\/?$/, '/');
    const url = new URL(path, baseUrl);
    if (params && typeof params === 'object') {
        for (const [key, value] of Object.entries(params)) {
            if (value === null || value === undefined) {
                continue;
            }
            url.searchParams.set(key, String(value));
        }
    }
    return url.toString();
}

function parseJsonResponse(data) {
    if (data === null || data === undefined || data === '') {
        return data ?? null;
    }
    if (typeof data !== 'string') {
        return data;
    }
    return safeJsonParse(data, data);
}

function unwrapErrorMessage(json, status, fallback) {
    if (typeof json === 'string' && json.trim()) {
        return json.replace(/^"+|"+$/g, '');
    }
    const message = json?.error?.message ?? json?.message;
    if (typeof message === 'string' && message.trim()) {
        return message.replace(/^"+|"+$/g, '');
    }
    return `${fallback} (${status})`;
}

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
        if (rows.length === 0 || page?.hasNext === false || rows.length < pageSize) {
            break;
        }
    }
    return results;
}

async function execute(path, { endpoint = '', method = 'GET', params = null } = {}) {
    const requestOptions = {
        url: buildUrl(path, method === 'GET' ? params : {}, endpoint),
        method
    };

    if (method !== 'GET') {
        requestOptions.headers = {
            'Content-Type': 'application/json;charset=utf-8'
        };
        requestOptions.body = JSON.stringify(params ?? {});
    }

    const response = await webRepository.execute(requestOptions);
    const json = parseJsonResponse(response.data);

    if (response.status >= 400) {
        throw new Error(unwrapErrorMessage(json, response.status, 'VRChat tool request failed'));
    }
    if (json && typeof json === 'object' && 'error' in json) {
        throw new Error(unwrapErrorMessage(json, response.status, 'VRChat tool request failed'));
    }

    return {
        json,
        status: response.status,
        raw: response.raw
    };
}

async function getGroupCalendars(params = {}, { endpoint = '', force = false } = {}) {
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

async function getFollowingGroupCalendars(params = {}, { endpoint = '', force = false } = {}) {
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

async function getFeaturedGroupCalendars(params = {}, { endpoint = '', force = false } = {}) {
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
        (pageParams) => getGroupCalendars({ ...params, ...pageParams }, options),
        { pageSize: params.n ?? PAGE_SIZE }
    );
}

async function getAllFollowingGroupCalendars(params = {}, options = {}) {
    return processAllPages(
        (pageParams) => getFollowingGroupCalendars({ ...params, ...pageParams }, options),
        { pageSize: params.n ?? PAGE_SIZE }
    );
}

async function getAllFeaturedGroupCalendars(params = {}, options = {}) {
    return processAllPages(
        (pageParams) => getFeaturedGroupCalendars({ ...params, ...pageParams }, options),
        { pageSize: params.n ?? PAGE_SIZE }
    );
}

async function followGroupEvent({ groupId, eventId, isFollowing }, { endpoint = '' } = {}) {
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

async function getGroupCalendarIcs({ groupId, eventId }, { endpoint = '', force = false } = {}) {
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

async function reportUser({ userId, contentType = 'user', reason, type = 'report' }, { endpoint = '' } = {}) {
    const response = await execute(`feedback/${encodeURIComponent(userId)}/user`, {
        endpoint,
        method: 'POST',
        params: { contentType, reason, type }
    });
    return response.json;
}

async function getInviteMessages({ currentUserId, messageType }, { endpoint = '' } = {}) {
    const response = await execute(
        `message/${encodeURIComponent(currentUserId)}/${encodeURIComponent(messageType)}`,
        {
            endpoint,
            method: 'GET'
        }
    );
    return response.json;
}

async function editInviteMessage({ currentUserId, messageType, slot, message }, { endpoint = '' } = {}) {
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
