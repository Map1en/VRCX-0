import { replaceBioSymbols } from '@/shared/utils/base/string.js';

export const SEARCH_PAGE_SIZE = 10;

export function buildWorldSearchRequest(searchText, category, includeCommunityLabs, offset = 0) {
    const params = {
        n: SEARCH_PAGE_SIZE,
        offset: Math.max(0, offset)
    };
    let option;

    switch (category?.sortHeading) {
        case 'featured':
            params.sort = 'order';
            params.featured = 'true';
            break;
        case 'trending':
            params.sort = 'popularity';
            params.featured = 'false';
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
            params.featured = 'false';
            break;
        default:
            params.sort = 'relevance';
            params.search = replaceBioSymbols(searchText);
            break;
    }

    params.order = category?.sortOrder || 'descending';

    if (category?.sortOwnership === 'mine') {
        params.user = 'me';
        params.releaseStatus = 'all';
    }

    if (category?.tag) {
        params.tag = category.tag;
    }

    if (!includeCommunityLabs) {
        params.tag = params.tag ? `${params.tag},system_approved` : 'system_approved';
    }

    return {
        categoryIndex: category?.index ?? null,
        option,
        params
    };
}

export function buildGroupSearchRequest(searchText, offset = 0) {
    return {
        params: {
            n: SEARCH_PAGE_SIZE,
            offset: Math.max(0, offset),
            query: replaceBioSymbols(searchText)
        }
    };
}

export function buildAvatarSearchRequest(searchText, provider, offset = 0) {
    return {
        provider,
        query: replaceBioSymbols(searchText),
        offset: Math.max(0, offset)
    };
}

export function buildUserSearchRequest(
    searchText,
    searchByBio = false,
    sortByLastLoggedIn = false,
    offset = 0
) {
    return {
        params: {
            n: SEARCH_PAGE_SIZE,
            offset: Math.max(0, offset),
            search: replaceBioSymbols(searchText),
            customFields: searchByBio ? 'bio' : 'displayName',
            sort: sortByLastLoggedIn ? 'last_login' : 'relevance'
        }
    };
}
