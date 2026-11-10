import { describe, expect, it } from 'vitest';

import {
    EMPTY_WORLD_INSTANCE_FILTER,
    activeWorldInstanceFilterCount,
    filterWorldInstanceRows,
    worldInstanceFilterOptions,
    worldInstanceOccupancy,
    type WorldInstanceFilterRow
} from './worldInstanceFilters';

function row(
    id: string,
    ref: Record<string, unknown>,
    extra: Partial<WorldInstanceFilterRow> = {}
): WorldInstanceFilterRow {
    return { id, ref, users: [], ...extra };
}

const rows = [
    row(
        'hangout-jp',
        {
            categoryId: 'icat_hangout',
            vibeIds: ['ivib_chill', 'ivib_cozy'],
            languagesIso639: ['jpn'],
            capacity: 16
        },
        { users: [{ id: 'usr_friend' }], userCount: 5 }
    ),
    row(
        'games-en',
        {
            categoryId: 'icat_games',
            vibeIds: ['ivib_competitive'],
            languagesIso639: ['eng', 'jpn'],
            capacity: 16
        },
        { userCount: 16 }
    ),
    row(
        'closed',
        {
            categoryId: 'icat_hangout',
            vibeIds: ['ivib_chill'],
            languagesIso639: ['eng'],
            closedAt: '2026-11-10T00:00:00Z',
            capacity: 16
        },
        { userCount: 1 }
    ),
    row('plain', {}, { users: [{ id: 'usr_self' }] })
];

const isFriend = (userId: string) => userId === 'usr_friend';

function ids(filtered: WorldInstanceFilterRow[]) {
    return filtered.map((instance) => instance.id);
}

describe('worldInstanceOccupancy', () => {
    it('prefers live row counts and falls back to the instance and world capacity', () => {
        expect(
            worldInstanceOccupancy(
                { id: 'a', users: [], playerCount: 3, ref: { userCount: 9 } },
                80
            )
        ).toEqual({ playerCount: 3, capacity: 80 });
        expect(
            worldInstanceOccupancy(
                { id: 'b', users: [], ref: { capacity: 12 } },
                80
            )
        ).toEqual({ playerCount: 0, capacity: 12 });
    });
});

describe('filterWorldInstanceRows', () => {
    it('keeps every row without active filters', () => {
        expect(
            ids(
                filterWorldInstanceRows(rows, EMPTY_WORLD_INSTANCE_FILTER, {
                    isFriend
                })
            )
        ).toEqual(['hangout-jp', 'games-en', 'closed', 'plain']);
        expect(
            activeWorldInstanceFilterCount(EMPTY_WORLD_INSTANCE_FILTER)
        ).toBe(0);
    });

    it('matches the category, any selected language and every selected vibe', () => {
        const filter = {
            ...EMPTY_WORLD_INSTANCE_FILTER,
            categoryId: 'icat_hangout',
            languages: ['jpn', 'kor'],
            vibeIds: ['ivib_chill', 'ivib_cozy']
        };

        expect(
            ids(filterWorldInstanceRows(rows, filter, { isFriend }))
        ).toEqual(['hangout-jp']);
        expect(activeWorldInstanceFilterCount(filter)).toBe(3);
    });

    it('keeps only rows with friends and hides closed or full rooms', () => {
        expect(
            ids(
                filterWorldInstanceRows(
                    rows,
                    { ...EMPTY_WORLD_INSTANCE_FILTER, withFriends: true },
                    { isFriend }
                )
            )
        ).toEqual(['hangout-jp']);
        expect(
            ids(
                filterWorldInstanceRows(
                    rows,
                    { ...EMPTY_WORLD_INSTANCE_FILTER, hideUnavailable: true },
                    { isFriend, worldCapacity: 16 }
                )
            )
        ).toEqual(['hangout-jp', 'plain']);
    });
});

describe('worldInstanceFilterOptions', () => {
    it('lists only the categories, vibes and languages present, most common first', () => {
        expect(worldInstanceFilterOptions(rows)).toEqual({
            categoryIds: ['icat_hangout', 'icat_games'],
            vibeIds: ['ivib_chill', 'ivib_cozy', 'ivib_competitive'],
            languages: ['jpn', 'eng']
        });
    });
});
