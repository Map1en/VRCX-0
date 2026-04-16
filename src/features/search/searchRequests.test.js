import { describe, expect, it } from 'vitest';

import {
    buildAvatarSearchRequest,
    buildGroupSearchRequest,
    buildUserSearchRequest,
    buildWorldSearchRequest,
    SEARCH_PAGE_SIZE
} from './searchRequests.js';

describe('search request helpers', () => {
    it('builds a display-name user search by default', () => {
        expect(buildUserSearchRequest('maple', false, false, -20)).toEqual({
            params: {
                n: SEARCH_PAGE_SIZE,
                offset: 0,
                search: 'maple',
                customFields: 'displayName',
                sort: 'relevance'
            }
        });
    });

    it('builds a bio user search sorted by last login', () => {
        expect(buildUserSearchRequest('avatar maker', true, true, 30)).toEqual({
            params: {
                n: SEARCH_PAGE_SIZE,
                offset: 30,
                search: 'avatar maker',
                customFields: 'bio',
                sort: 'last_login'
            }
        });
    });

    it('keeps community labs out of normal world search results', () => {
        expect(buildWorldSearchRequest('hangout', null, false)).toEqual({
            categoryIndex: null,
            option: undefined,
            params: {
                n: SEARCH_PAGE_SIZE,
                offset: 0,
                sort: 'relevance',
                search: 'hangout',
                order: 'descending',
                tag: 'system_approved'
            }
        });
    });

    it('builds world category search params without forcing system approved when labs are included', () => {
        expect(
            buildWorldSearchRequest(
                'ignored',
                {
                    index: 7,
                    sortHeading: 'trending',
                    sortOrder: 'ascending',
                    tag: 'system_summer',
                    sortOwnership: 'mine'
                },
                true,
                20
            )
        ).toEqual({
            categoryIndex: 7,
            option: undefined,
            params: {
                n: SEARCH_PAGE_SIZE,
                offset: 20,
                sort: 'popularity',
                featured: 'false',
                order: 'ascending',
                user: 'me',
                releaseStatus: 'all',
                tag: 'system_summer'
            }
        });
    });

    it('uses option searches for special world categories', () => {
        expect(
            buildWorldSearchRequest('ignored', { index: 3, sortHeading: 'favorite' }, false)
        ).toEqual({
            categoryIndex: 3,
            option: 'favorites',
            params: {
                n: SEARCH_PAGE_SIZE,
                offset: 0,
                order: 'descending',
                tag: 'system_approved'
            }
        });
    });

    it('builds group and avatar searches with normalized offsets', () => {
        expect(buildGroupSearchRequest('club', -1)).toEqual({
            params: {
                n: SEARCH_PAGE_SIZE,
                offset: 0,
                query: 'club'
            }
        });
        expect(buildAvatarSearchRequest('robot', 'provider-a', 10)).toEqual({
            provider: 'provider-a',
            query: 'robot',
            offset: 10
        });
    });
});
