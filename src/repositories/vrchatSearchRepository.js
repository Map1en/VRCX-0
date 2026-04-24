import { executeVrchatRequest } from './vrchatRequest.js';

function normalizeParams(params = {}) {
    if (!params || typeof params !== 'object') {
        return {};
    }
    return { ...params };
}

async function executeGet(path, params = {}, extra = {}, options = {}) {
    const normalizedParams = normalizeParams(params);
    return executeVrchatRequest(path, {
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
