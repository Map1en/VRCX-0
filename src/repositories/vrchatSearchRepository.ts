import {
    executeVrchatBackendRequest,
    type QueryParams,
    type VrchatRequestResponse
} from './vrchatRequest.js';

interface SearchRequestOptions {
    endpoint?: string;
}

function normalizeParams(params: QueryParams = {}): QueryParams {
    if (!params || typeof params !== 'object') {
        return {};
    }
    return { ...params };
}

async function executeGet<TJson = unknown>(
    path: string,
    params: QueryParams = {},
    extra: Record<string, unknown> = {},
    options: SearchRequestOptions = {}
): Promise<VrchatRequestResponse<TJson>> {
    const normalizedParams = normalizeParams(params);
    return executeVrchatBackendRequest('VrchatSearchExecute', path, {
        endpoint: options.endpoint,
        method: 'GET',
        params: normalizedParams,
        allowDebugEndpoint: true,
        fallbackMessage: 'VRChat request failed',
        decorateError: false,
        includeParams: true,
        extra
    });
}

async function getConfig(params: QueryParams = {}) {
    return executeGet('config', params);
}

async function getWorlds(
    params: QueryParams = {},
    option?: unknown,
    options: SearchRequestOptions = {}
) {
    const path =
        typeof option === 'undefined' || option === null
            ? 'worlds'
            : `worlds/${encodeURIComponent(String(option))}`;
    return executeGet(path, params, { option }, options);
}

async function getUsers(
    params: QueryParams = {},
    options: SearchRequestOptions = {}
) {
    return executeGet('users', params, {}, options);
}

async function getGroups(params: QueryParams = {}) {
    return executeGet('groups', params);
}

async function getGroupsStrictSearch(
    params: QueryParams = {},
    options: SearchRequestOptions = {}
) {
    return executeGet('groups/strictsearch', params, {}, options);
}

async function getInstanceFromShortName(
    shortName: unknown,
    options: SearchRequestOptions = {}
) {
    return executeGet(
        `instances/s/${encodeURIComponent(String(shortName || '').trim())}`,
        {},
        {},
        options
    );
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
