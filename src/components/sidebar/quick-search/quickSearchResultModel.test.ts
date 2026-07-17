import { describe, expect, it } from 'vitest';

import {
    createEmptyCatalog,
    type QuickSearchResult
} from '../quickSearchCatalog';
import {
    buildEntityResult,
    buildQuickSearchResults,
    dedupeQuickSearchResults,
    filterQuickSearchResults,
    matchedField,
    matchesFriend,
    normalizeSearchQuery
} from './quickSearchResultModel';

function result(
    id: string,
    name: string,
    fields: Pick<QuickSearchResult, 'memo' | 'note'> = {}
): QuickSearchResult {
    return {
        id,
        name,
        type: 'friend',
        source: 'test',
        ...fields
    };
}

describe('quick search result model', () => {
    it('normalizes queries without changing internal spacing', () => {
        expect(normalizeSearchQuery('  Alpha  BETA ')).toBe('alpha  beta');
    });

    it('matches friend details only after the detail threshold', () => {
        const friend = result('usr_1', 'Alpha', {
            memo: 'x-ray',
            note: 'yellow'
        });

        expect(matchesFriend(friend, 'x')).toBe(false);
        expect(matchesFriend(friend, 'x-')).toBe(true);
        expect(matchesFriend(friend, 'ye')).toBe(true);
        expect(matchedField(friend, 'x-')).toBe('memo');
        expect(matchedField(friend, 'ye')).toBe('note');
        expect(matchedField(friend, 'al')).toBe('name');
    });

    it('requires two characters before searching non-friend details', () => {
        const input = {
            catalog: {
                ...createEmptyCatalog(),
                ownAvatars: [{ id: 'avtr_1', name: 'Alpha' }]
            },
            currentUserId: 'usr_owner',
            friendsById: {},
            knownFriendUsersById: {},
            remoteFavoritesByObjectId: {},
            localWorldDetailsById: {},
            localAvatarDetailsById: {},
            groupInstances: []
        };

        expect(
            buildQuickSearchResults({ ...input, normalizedQuery: 'a' })
                .ownAvatars
        ).toEqual([]);
        expect(
            buildQuickSearchResults({ ...input, normalizedQuery: 'al' })
                .ownAvatars
        ).toHaveLength(1);
    });

    it('keeps the first duplicate and removes excluded or empty ids', () => {
        const first = result('usr_1', 'First');
        const duplicate = result('usr_1', 'Duplicate');

        expect(
            dedupeQuickSearchResults(
                [
                    first,
                    duplicate,
                    result('usr_2', 'Excluded'),
                    result('', 'Empty'),
                    null,
                    undefined
                ],
                new Set(['usr_2'])
            )
        ).toEqual([first]);
    });

    it('sorts prefix matches first and limits each result group to eight', () => {
        const rows = [
            result('9', 'Zed alpha'),
            result('1', 'Alpha 9'),
            result('2', 'Alpha 8'),
            result('3', 'Alpha 7'),
            result('4', 'Alpha 6'),
            result('5', 'Alpha 5'),
            result('6', 'Alpha 4'),
            result('7', 'Alpha 3'),
            result('8', 'Alpha 2'),
            result('10', 'Beta alpha')
        ];

        const filtered = filterQuickSearchResults(rows, 'alpha');

        expect(filtered).toHaveLength(8);
        expect(filtered.map((row) => row.name)).toEqual([
            'Alpha 2',
            'Alpha 3',
            'Alpha 4',
            'Alpha 5',
            'Alpha 6',
            'Alpha 7',
            'Alpha 8',
            'Alpha 9'
        ]);
    });

    it('builds entity rows with the existing id and display precedence', () => {
        const built = buildEntityResult(
            {
                id: 'avtr_raw',
                objectId: 'avtr_object',
                favoriteId: 'avtr_favorite',
                displayName: 'Display Name',
                author_name: 'Author'
            },
            'avatar',
            'favorite'
        );

        expect(built).toMatchObject({
            id: 'avtr_favorite',
            name: 'Display Name',
            subtitle: 'Author',
            type: 'avatar',
            source: 'favorite'
        });
    });
});
