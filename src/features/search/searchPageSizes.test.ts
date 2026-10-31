// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';

import { readSearchPageSizes, writeSearchPageSizes } from './searchPageSizes';

afterEach(() => localStorage.clear());

describe('search page sizes', () => {
    it('keeps a page size per tab across reads', () => {
        writeSearchPageSizes({ user: 50, world: 20, avatar: 10, group: 30 });

        expect(readSearchPageSizes()).toEqual({
            user: 50,
            world: 20,
            avatar: 10,
            group: 30
        });
    });

    it('falls back to 10 for missing, unsupported or unreadable values', () => {
        localStorage.setItem(
            'VRCX_0_SearchPageSizes',
            JSON.stringify({ user: 25, world: '20', group: 40 })
        );
        expect(readSearchPageSizes()).toEqual({
            user: 10,
            world: 10,
            avatar: 10,
            group: 40
        });

        localStorage.setItem('VRCX_0_SearchPageSizes', '{');
        expect(readSearchPageSizes()).toEqual({
            user: 10,
            world: 10,
            avatar: 10,
            group: 10
        });
    });
});
