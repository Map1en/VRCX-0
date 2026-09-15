import {
    commands,
    type GroupSearchParams,
    type HttpApiExecuteResponse,
    type UserSearchParams,
    type WorldSearchParams
} from '@/platform/tauri/bindings';

import {
    type VrchatRequestResponse,
    unwrapVrchatResponse
} from './vrchatRequest';

type SearchEntityJson = Record<string, unknown> & {
    id: string;
};

type SearchWorldJson = SearchEntityJson & {
    name?: string;
};

type SearchUserJson = SearchEntityJson;
export type SearchGroupJson = SearchEntityJson & {
    bannerId: string | null;
    bannerUrl?: string;
    createdAt?: string;
    description?: string;
    discriminator?: string;
    galleries?: unknown[];
    iconId?: string;
    iconUrl?: string;
    isSearchable?: boolean;
    memberCount?: number;
    membershipStatus?: string;
    name?: string;
    ownerId?: string;
    rules?: string;
    shortCode?: string;
    tags?: unknown[];
};

type SearchInstanceJson = Record<string, unknown> & {
    location?: unknown;
    shortName?: unknown;
    world?: unknown;
    worldName?: unknown;
};

function normalizeParams<TParams extends object>(params: TParams): TParams {
    return { ...params };
}

type VrchatApiResult = HttpApiExecuteResponse;

function unwrapVrchatSearchResponse<
    TJson = unknown,
    TParams extends object = object
>(
    response: VrchatApiResult,
    path: string,
    params: TParams,
    extra: Record<string, unknown> = {},
    fallbackMessage: string = 'VRChat request failed'
): VrchatRequestResponse<TJson, TParams> {
    return {
        ...unwrapVrchatResponse<TJson>(response, path, { fallbackMessage }),
        params,
        ...extra
    };
}

async function getWorlds(
    params: WorldSearchParams = {},
    option: string | null = null
) {
    const normalizedParams = normalizeParams(params);
    const response = await commands.appVrchatSearchWorldsGet({
        params: normalizedParams,
        option
    });
    const path = option ? `worlds/${encodeURIComponent(option)}` : 'worlds';
    return unwrapVrchatSearchResponse<SearchWorldJson[]>(
        response,
        path,
        normalizedParams,
        {
            option
        }
    );
}

async function getWorldById(worldId: string) {
    const normalizedWorldId = worldId.trim();
    const response = await commands.appVrchatSearchWorldsGet({
        params: {},
        option: normalizedWorldId
    });
    return unwrapVrchatSearchResponse<SearchWorldJson>(
        response,
        `worlds/${encodeURIComponent(normalizedWorldId)}`,
        {},
        { option: normalizedWorldId }
    );
}

async function getUsers(params: UserSearchParams = {}) {
    const normalizedParams = normalizeParams(params);
    const response = await commands.appVrchatSearchUsersGet({
        params: normalizedParams
    });
    return unwrapVrchatSearchResponse<SearchUserJson[]>(
        response,
        'users',
        normalizedParams
    );
}

async function getGroups(params: GroupSearchParams = {}) {
    const normalizedParams = normalizeParams(params);
    const response = await commands.appVrchatSearchGroupsGet({
        params: normalizedParams
    });
    return unwrapVrchatSearchResponse<SearchGroupJson[]>(
        response,
        'groups',
        normalizedParams
    );
}

async function getGroupsStrictSearch(params: GroupSearchParams = {}) {
    const normalizedParams = normalizeParams(params);
    const response = await commands.appVrchatSearchGroupsStrictGet({
        params: normalizedParams
    });
    return unwrapVrchatSearchResponse<SearchGroupJson[]>(
        response,
        'groups/strictsearch',
        normalizedParams
    );
}

async function getInstanceFromShortName(shortName: string) {
    const normalizedShortName = shortName.trim();
    const response = await commands.appVrchatSearchInstanceShortNameGet({
        shortName: normalizedShortName
    });
    return unwrapVrchatSearchResponse<SearchInstanceJson>(
        response,
        `instances/s/${encodeURIComponent(normalizedShortName)}`,
        {}
    );
}

const vrchatSearchRepository = Object.freeze({
    getWorlds,
    getWorldById,
    getUsers,
    getGroups,
    getGroupsStrictSearch,
    getInstanceFromShortName
});

export { getUsers };
export default vrchatSearchRepository;
