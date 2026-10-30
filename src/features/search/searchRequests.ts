import type {
    GroupSearchParams,
    UserSearchParams,
    WorldSearchParams
} from '@/platform/tauri/bindings';
import { replaceBioSymbols } from '@/shared/utils/string';

import { DEFAULT_SEARCH_PAGE_SIZE } from './searchPageSizes';

export type WorldSearchCategory = {
    index?: string | number;
    sortHeading?: string;
    sortOrder?: string;
    sortOwnership?: string;
    tag?: string;
};

export function buildWorldSearchRequest(
    searchText: string,
    category: WorldSearchCategory | null | undefined,
    includeCommunityLabs: boolean,
    pageSize = DEFAULT_SEARCH_PAGE_SIZE,
    offset = 0
) {
    const params: WorldSearchParams & { n: number; offset: number } = {
        n: pageSize,
        offset: Math.max(0, offset)
    };
    let option;

    switch (category?.sortHeading) {
        case 'featured':
            params.sort = 'order';
            params.featured = true;
            break;
        case 'trending':
            params.sort = 'popularity';
            params.featured = false;
            break;
        case 'updated':
            params.sort = 'updated';
            break;
        case 'created':
            params.sort = 'created';
            break;
        case 'publication':
            params.sort = 'publicationDate';
            break;
        case 'shuffle':
            params.sort = 'shuffle';
            break;
        case 'active':
            option = 'active';
            break;
        case 'recent':
            option = 'recent';
            break;
        case 'favorite':
            option = 'favorites';
            break;
        case 'labs':
            params.sort = 'labsPublicationDate';
            break;
        case 'heat':
            params.sort = 'heat';
            params.featured = false;
            break;
        default:
            params.sort = 'relevance';
            params.search = replaceBioSymbols(searchText);
            break;
    }

    params.order =
        category?.sortOrder === 'ascending' ? 'ascending' : 'descending';

    if (category?.sortOwnership === 'mine') {
        params.user = 'me';
        params.releaseStatus = 'all';
    }

    if (category?.tag) {
        params.tag = category.tag;
    }

    if (!includeCommunityLabs) {
        params.tag = params.tag
            ? `${params.tag},system_approved`
            : 'system_approved';
    }

    return {
        categoryIndex: category?.index ?? null,
        option,
        params
    };
}

export function buildGroupSearchRequest(
    searchText: string,
    pageSize = DEFAULT_SEARCH_PAGE_SIZE,
    offset = 0
) {
    const params: GroupSearchParams & { n: number; offset: number } = {
        n: pageSize,
        offset: Math.max(0, offset),
        query: replaceBioSymbols(searchText)
    };
    return {
        params
    };
}

export function buildAvatarSearchRequest(
    searchText: string,
    provider: string,
    offset = 0
) {
    return {
        provider,
        query: searchText,
        offset: Math.max(0, offset)
    };
}

export function buildUserSearchRequest(
    searchText: string,
    searchByBio = false,
    sortByLastLoggedIn = false,
    pageSize = DEFAULT_SEARCH_PAGE_SIZE,
    offset = 0
) {
    const params: UserSearchParams & { n: number; offset: number } = {
        n: pageSize,
        offset: Math.max(0, offset),
        search: searchText,
        customFields: searchByBio ? 'bio' : 'displayName',
        sort: sortByLastLoggedIn ? 'last_login' : 'relevance'
    };
    return {
        params
    };
}
