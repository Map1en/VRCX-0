import { commands } from '@/platform/tauri/bindings';

import {
    type QueryParams,
    type VrchatRequestResponse,
    unwrapVrchatResponse
} from './vrchatRequest';

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
};

function unwrapVrchatSearchResponse<TJson = unknown>(
    response: VrchatApiResult,
    path: string,
    params: QueryParams,
    extra: Record<string, unknown> = {},
    fallbackMessage: string = 'VRChat request failed'
): VrchatRequestResponse<TJson> {
    return {
        ...unwrapVrchatResponse<TJson>(response, path, { fallbackMessage }),
        params,
        ...extra
    };
}

async function getConfig(params: QueryParams = {}) {
    const normalizedParams = normalizeParams(params);
    const response = await commands.appVrchatSearchConfigGet({
        params: normalizedParams
    });
    return unwrapVrchatSearchResponse(response, 'config', normalizedParams);
}

async function getWorlds(params: QueryParams = {}, option?: unknown) {
    const normalizedParams = normalizeParams(params);
    const normalizedOption =
        typeof option === 'undefined' || option === null ? '' : String(option);
    const response = await commands.appVrchatSearchWorldsGet({
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

async function getUsers(params: QueryParams = {}) {
    const normalizedParams = normalizeParams(params);
    const response = await commands.appVrchatSearchUsersGet({
        params: normalizedParams
    });
    return unwrapVrchatSearchResponse(response, 'users', normalizedParams);
}

async function getGroups(params: QueryParams = {}) {
    const normalizedParams = normalizeParams(params);
    const response = await commands.appVrchatSearchGroupsGet({
        params: normalizedParams
    });
    return unwrapVrchatSearchResponse(response, 'groups', normalizedParams);
}

async function getGroupsStrictSearch(params: QueryParams = {}) {
    const normalizedParams = normalizeParams(params);
    const response = await commands.appVrchatSearchGroupsStrictGet({
        params: normalizedParams
    });
    return unwrapVrchatSearchResponse(
        response,
        'groups/strictsearch',
        normalizedParams
    );
}

async function getInstanceFromShortName(shortName: unknown) {
    const normalizedShortName = String(shortName || '').trim();
    const response = await commands.appVrchatSearchInstanceShortNameGet({
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
