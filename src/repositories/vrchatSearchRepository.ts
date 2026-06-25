import { commands } from '@/platform/tauri/bindings';
import { normalizeVrchatEndpoint } from '@/shared/vrchatEndpoint';

import {
    createRequestError,
    notifyVrchatAuthFailure,
    parseJsonResponse,
    type QueryParams,
    type VrchatRequestResponse,
    unwrapErrorMessage
} from './vrchatRequest';

interface SearchRequestOptions {
    endpoint?: string;
}

type SearchWorldJson = Record<string, unknown> & {
    name?: string;
};

function normalizeParams(params: QueryParams = {}): QueryParams {
    if (!params || typeof params !== 'object') {
        return {};
    }
    return { ...params };
}

type VrchatApiResult = {
    status: number;
    data: unknown;
    raw: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object');
}

function unwrapVrchatSearchResponse<TJson = unknown>(
    response: VrchatApiResult,
    path: string,
    params: QueryParams,
    extra: Record<string, unknown> = {},
    fallbackMessage: string = 'VRChat request failed'
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
    const response = await commands.appVrchatSearchConfigGet({
        endpoint: normalizeVrchatEndpoint('', { allowDebugEndpoint: true }),
        params: normalizedParams
    });
    return unwrapVrchatSearchResponse(response, 'config', normalizedParams);
}

async function getWorlds(
    params: QueryParams = {},
    option?: unknown,
    options: SearchRequestOptions = {}
) {
    const normalizedParams = normalizeParams(params);
    const normalizedOption =
        typeof option === 'undefined' || option === null ? '' : String(option);
    const response = await commands.appVrchatSearchWorldsGet({
        endpoint: normalizeVrchatEndpoint(options.endpoint, {
            allowDebugEndpoint: true
        }),
        params: normalizedParams,
        option: normalizedOption
    });
    const path = normalizedOption
        ? `worlds/${encodeURIComponent(normalizedOption)}`
        : 'worlds';
    return unwrapVrchatSearchResponse<SearchWorldJson>(
        response,
        path,
        normalizedParams,
        {
            option
        }
    );
}

async function getUsers(
    params: QueryParams = {},
    options: SearchRequestOptions = {}
) {
    const normalizedParams = normalizeParams(params);
    const response = await commands.appVrchatSearchUsersGet({
        endpoint: normalizeVrchatEndpoint(options.endpoint, {
            allowDebugEndpoint: true
        }),
        params: normalizedParams
    });
    return unwrapVrchatSearchResponse(response, 'users', normalizedParams);
}

async function getGroups(params: QueryParams = {}) {
    const normalizedParams = normalizeParams(params);
    const response = await commands.appVrchatSearchGroupsGet({
        endpoint: normalizeVrchatEndpoint('', { allowDebugEndpoint: true }),
        params: normalizedParams
    });
    return unwrapVrchatSearchResponse(response, 'groups', normalizedParams);
}

async function getGroupsStrictSearch(
    params: QueryParams = {},
    options: SearchRequestOptions = {}
) {
    const normalizedParams = normalizeParams(params);
    const response = await commands.appVrchatSearchGroupsStrictGet({
        endpoint: normalizeVrchatEndpoint(options.endpoint, {
            allowDebugEndpoint: true
        }),
        params: normalizedParams
    });
    return unwrapVrchatSearchResponse(
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
    const response = await commands.appVrchatSearchInstanceShortNameGet({
        endpoint: normalizeVrchatEndpoint(options.endpoint, {
            allowDebugEndpoint: true
        }),
        shortName: normalizedShortName
    });
    return unwrapVrchatSearchResponse(
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
