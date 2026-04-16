import { describe, expect, it } from 'vitest';

import { dedupeById, emptyArray } from './searchResults.js';

describe('search result helpers', () => {
    it('returns arrays as-is and treats non-arrays as empty result lists', () => {
        const rows = [{ id: 'usr_1' }];

        expect(emptyArray(rows)).toBe(rows);
        expect(emptyArray(null)).toEqual([]);
        expect(emptyArray({ id: 'usr_1' })).toEqual([]);
    });

    it('deduplicates results by id and keeps the newest row for repeated ids', () => {
        expect(
            dedupeById([
                { id: 'usr_1', name: 'Old' },
                { id: 'usr_2', name: 'Second' },
                { id: 'usr_1', name: 'New' },
                { name: 'No id' }
            ])
        ).toEqual([
            { id: 'usr_1', name: 'New' },
            { id: 'usr_2', name: 'Second' }
        ]);
    });
});
