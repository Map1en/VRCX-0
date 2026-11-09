import { beforeEach, describe, expect, it } from 'vitest';

import {
    PLAYER_LIST_COLUMN_IDS,
    DEFAULT_PLAYER_LIST_SORTING,
    PLAYER_LIST_STORAGE_KEY,
    readPersistedPlayerListState,
    sanitizePlayerListColumnOrder,
    sanitizePlayerListColumnVisibility,
    sanitizePlayerListSorting,
    writePersistedPlayerListState
} from './playerListState';

describe('playerListState', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('uses the default player-list table shape when saved state is missing or invalid', () => {
        expect(readPersistedPlayerListState()).toEqual({});
        expect(sanitizePlayerListSorting(null)).toEqual(
            DEFAULT_PLAYER_LIST_SORTING
        );
        expect(sanitizePlayerListColumnOrder(null)).toEqual(
            PLAYER_LIST_COLUMN_IDS
        );
        expect(sanitizePlayerListColumnVisibility(null)).toEqual({
            groupRoles: false
        });
    });

    it('hides the group roles column until the user turns it on', () => {
        expect(sanitizePlayerListColumnVisibility({})).toEqual({
            groupRoles: false
        });
        expect(
            sanitizePlayerListColumnVisibility({ groupRoles: true })
        ).toEqual({ groupRoles: true });
    });

    it('keeps valid saved table choices and drops unknown columns', () => {
        expect(
            sanitizePlayerListSorting([
                { id: 'displayName', desc: false },
                { id: 'unknown', desc: true },
                null
            ])
        ).toEqual([{ id: 'displayName', desc: false }]);

        expect(sanitizePlayerListSorting([{ id: 'icon', desc: true }])).toEqual(
            DEFAULT_PLAYER_LIST_SORTING
        );

        expect(
            sanitizePlayerListColumnVisibility({
                avatar: false,
                timer: true,
                unknown: false,
                displayName: 'yes',
                mutualFriends: true
            })
        ).toEqual({ avatar: false, groupRoles: false, timer: true });

        expect(
            sanitizePlayerListColumnOrder(['note', 'unknown', 'avatar', 'note'])
        ).toEqual([
            'note',
            'avatar',
            'timer',
            'displayName',
            'mutualFriends',
            'rank',
            'groupRoles',
            'status',
            'icon',
            'platform',
            'language',
            'bioLink'
        ]);
        expect(
            sanitizePlayerListColumnOrder(['displayName', 'timer', 'avatar'])
        ).toEqual([
            'displayName',
            'mutualFriends',
            'rank',
            'groupRoles',
            'status',
            'icon',
            'platform',
            'language',
            'bioLink',
            'note',
            'timer',
            'avatar'
        ]);
    });

    it('restores and updates persisted player-list table state without losing existing fields', () => {
        localStorage.setItem(
            PLAYER_LIST_STORAGE_KEY,
            JSON.stringify({
                sorting: [{ id: 'timer', desc: true }],
                columnVisibility: { avatar: false }
            })
        );

        expect(readPersistedPlayerListState()).toEqual({
            sorting: [{ id: 'timer', desc: true }],
            columnVisibility: { avatar: false }
        });

        writePersistedPlayerListState({
            columnOrder: ['avatar', 'timer']
        });

        const saved = JSON.parse(
            String(localStorage.getItem(PLAYER_LIST_STORAGE_KEY))
        );
        expect(saved.sorting).toEqual([{ id: 'timer', desc: true }]);
        expect(saved.columnVisibility).toEqual({ avatar: false });
        expect(saved.columnOrder).toEqual(['avatar', 'timer']);
        expect(Number.isFinite(saved.updatedAt)).toBe(true);
    });
});
