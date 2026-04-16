import webRepository from './webRepository.js';
import { safeJsonParse } from './baseRepository.js';

const DEFAULT_ENDPOINT_DOMAIN = 'https://api.vrchat.cloud/api/1';

function getEndpointDomain(endpoint = '') {
    const endpointDomain = endpoint || globalThis?.$debug?.endpointDomain;
    if (typeof endpointDomain === 'string' && endpointDomain.trim()) {
        return endpointDomain;
    }
    return DEFAULT_ENDPOINT_DOMAIN;
}

function normalizeParams(params = {}) {
    if (!params || typeof params !== 'object') {
        return {};
    }
    return { ...params };
}

function appendParams(url, params) {
    if (!params || typeof params !== 'object') {
        return url;
    }

    for (const [key, value] of Object.entries(params)) {
        if (value === null || value === undefined) {
            continue;
        }

        if (Array.isArray(value)) {
            for (const item of value) {
                if (item === null || item === undefined) {
                    continue;
                }
                url.searchParams.append(key, String(item));
            }
            continue;
        }

        if (value instanceof Date) {
            url.searchParams.set(key, value.toISOString());
            continue;
        }

        if (typeof value === 'object') {
            url.searchParams.set(key, String(value));
            continue;
        }

        url.searchParams.set(key, String(value));
    }

    return url;
}

function buildUrl(path, params, endpoint = '') {
    const baseUrl = getEndpointDomain(endpoint).replace(/\/?$/, '/');
    const url = new URL(path, baseUrl);
    return appendParams(url, params);
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

function unwrapErrorMessage(json, status) {
    const message = json?.error?.message ?? json?.message;
    if (typeof message === 'string' && message.trim()) {
        return message.replace(/^"+|"+$/g, '');
    }
    return `VRChat request failed (${status})`;
}

async function executeGet(path, params = {}, extra = {}, options = {}) {
    const normalizedParams = normalizeParams(params);
    const response = await webRepository.execute({
        url: buildUrl(path, normalizedParams, options.endpoint).toString(),
        method: 'GET'
    });
    const json = parseJsonResponse(response.data);

    if (response.status >= 400) {
        throw new Error(unwrapErrorMessage(json, response.status));
    }

    if (json && typeof json === 'object' && 'error' in json) {
        throw new Error(unwrapErrorMessage(json, response.status));
    }

    return {
        json,
        params: normalizedParams,
        ...extra,
        status: response.status,
        raw: response.raw
    };
}

async function getConfig(params = {}) {
    return executeGet('config', params);
}

async function getWorlds(params = {}, option, options = {}) {
    const path =
        typeof option === 'undefined' || option === null
            ? 'worlds'
            : `worlds/${encodeURIComponent(String(option))}`;
    return executeGet(path, params, { option }, options);
}

async function getUsers(params = {}, options = {}) {
    return executeGet('users', params, {}, options);
}

async function getGroups(params = {}) {
    return executeGet('groups', params);
}

async function getGroupsStrictSearch(params = {}, options = {}) {
    return executeGet('groups/strictsearch', params, {}, options);
}

async function getInstanceFromShortName(shortName, options = {}) {
    return executeGet(`instances/s/${encodeURIComponent(String(shortName || '').trim())}`, {}, {}, options);
}

const vrchatSearchRepository = Object.freeze({
    executeGet,
    getConfig,
    getWorlds,
    getUsers,
    getGroups,
    getGroupsStrictSearch,
    getInstanceFromShortName
});

export {
    executeGet,
    getConfig,
    getWorlds,
    getUsers,
    getGroups,
    getGroupsStrictSearch,
    getInstanceFromShortName
};
export default vrchatSearchRepository;
