import {
    createRequestError,
    notifyVrchatAuthFailure,
    parseJsonResponse,
    type QueryParams,
    type VrchatRequestResponse,
    unwrapErrorMessage
} from './vrchatRequest.js';
import { backend } from '@/platform/index.js';
import { normalizeVrchatEndpoint } from '@/shared/vrchatEndpoint.js';

interface SearchRequestOptions {
    endpoint?: string;
}

function normalizeParams(params: QueryParams = {}): QueryParams {
    if (!params || typeof params !== 'object') {
        return {};
    }
    return { ...params };
}

type BackendApiResult = {
    status: number;
    data: unknown;
    raw: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object');
}

function unwrapBackendSearchResponse<TJson = unknown>(
    response: BackendApiResult,
    path: string,
    params: QueryParams,
    extra: Record<string, unknown> = {},
    fallbackMessage = 'VRChat request failed'
): Promise<VrchatRequestResponse<TJson>> {
    const json = parseJsonResponse(response.data);
    if (response.status >= 400 || (isRecord(json) && 'error' in json)) {
        const requestError = createRequestError(
            unwrapErrorMessage(json, response.status, {
                fallbackMessage
            }),
            response.status,
            path,
            json
        );
        notifyVrchatAuthFailure(requestError);
        throw new Error(requestError.message);
    }

    return Promise.resolve({
        json: json as TJson,
        params,
        ...extra,
        status: response.status,
        raw: response.raw
    });
}

async function getConfig(params: QueryParams = {}) {
    const normalizedParams = normalizeParams(params);
    const response = await backend.app.BackendSearchConfigGet({
        endpoint: normalizeVrchatEndpoint('', { allowDebugEndpoint: true }),
        params: normalizedParams,
    });
    return unwrapBackendSearchResponse(response, 'config', normalizedParams);
}

async function getWorlds(
    params: QueryParams = {},
    option?: unknown,
    options: SearchRequestOptions = {}
) {
    const normalizedParams = normalizeParams(params);
    const normalizedOption =
        typeof option === 'undefined' || option === null
            ? ''
            : String(option);
    const response = await backend.app.BackendSearchWorldsGet({
        endpoint: normalizeVrchatEndpoint(options.endpoint, {
            allowDebugEndpoint: true
        }),
        params: normalizedParams,
        option: normalizedOption
    });
    const path = normalizedOption
        ? `worlds/${encodeURIComponent(normalizedOption)}`
        : 'worlds';
    return unwrapBackendSearchResponse(response, path, normalizedParams, {
        option
    });
}

async function getUsers(
    params: QueryParams = {},
    options: SearchRequestOptions = {}
) {
    const normalizedParams = normalizeParams(params);
    const response = await backend.app.BackendSearchUsersGet({
        endpoint: normalizeVrchatEndpoint(options.endpoint, {
            allowDebugEndpoint: true
        }),
        params: normalizedParams
    });
    return unwrapBackendSearchResponse(response, 'users', normalizedParams);
}

async function getGroups(params: QueryParams = {}) {
    const normalizedParams = normalizeParams(params);
    const response = await backend.app.BackendSearchGroupsGet({
        endpoint: normalizeVrchatEndpoint('', { allowDebugEndpoint: true }),
        params: normalizedParams
    });
    return unwrapBackendSearchResponse(response, 'groups', normalizedParams);
}

async function getGroupsStrictSearch(
    params: QueryParams = {},
    options: SearchRequestOptions = {}
) {
    const normalizedParams = normalizeParams(params);
    const response = await backend.app.BackendSearchGroupsStrictGet({
        endpoint: normalizeVrchatEndpoint(options.endpoint, {
            allowDebugEndpoint: true
        }),
        params: normalizedParams
    });
    return unwrapBackendSearchResponse(
        response,
        'groups/strictsearch',
        normalizedParams
    );
}

async function getInstanceFromShortName(
    shortName: unknown,
    options: SearchRequestOptions = {}
) {
    const normalizedShortName = String(shortName || '').trim();
    const response = await backend.app.BackendSearchInstanceShortNameGet({
        endpoint: normalizeVrchatEndpoint(options.endpoint, {
            allowDebugEndpoint: true
        }),
        shortName: normalizedShortName
    });
    return unwrapBackendSearchResponse(
        response,
        `instances/s/${encodeURIComponent(normalizedShortName)}`,
        {}
    );
}

const vrchatSearchRepository = Object.freeze({
    getConfig,
    getWorlds,
    getUsers,
    getGroups,
    getGroupsStrictSearch,
    getInstanceFromShortName
});

export {
    getConfig,
    getWorlds,
    getUsers,
    getGroups,
    getGroupsStrictSearch,
    getInstanceFromShortName
};
export default vrchatSearchRepository;
