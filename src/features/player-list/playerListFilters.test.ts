import { describe, expect, it } from 'vitest';

import {
    countPlayerListScopes,
    filterPlayerListRows,
    type PlayerListFilterableRow
} from './playerListFilters';

const rows: PlayerListFilterableRow[] = [
    {
        displayName: 'Maplen_',
        userId: 'usr_maplen',
        note: 'Host helper',
        isFriend: true,
        isFavorite: true,
        isBlocked: false,
        isMuted: false,
        isAvatarInteractionDisabled: false,
        isChatBoxMuted: false,
        timeoutTime: 0
    },
    {
        displayName: 'ＡＩＧＥ_NICE',
        userId: 'usr_aige',
        note: '',
        isFriend: false,
        isFavorite: false,
        isBlocked: false,
        isMuted: true,
        isAvatarInteractionDisabled: false,
        isChatBoxMuted: true,
        timeoutTime: 0
    },
    {
        displayName: 'Guest',
        userId: 'usr_guest',
        note: 'Stage moderator',
        isFriend: true,
        isFavorite: false,
        isBlocked: false,
        isMuted: false,
        isAvatarInteractionDisabled: false,
        isChatBoxMuted: false,
        timeoutTime: 12
    }
];

describe('playerListFilters', () => {
    it('searches the current rows by name, id, or note with normalized text', () => {
        expect(filterPlayerListRows(rows, 'aige', 'all')).toEqual([rows[1]]);
        expect(filterPlayerListRows(rows, 'USR_GUEST', 'all')).toEqual([
            rows[2]
        ]);
        expect(filterPlayerListRows(rows, 'host helper', 'all')).toEqual([
            rows[0]
        ]);
    });

    it('applies the selected quick scope before the search query', () => {
        expect(filterPlayerListRows(rows, '', 'favorite')).toEqual([rows[0]]);
        expect(filterPlayerListRows(rows, 'guest', 'friend')).toEqual([
            rows[2]
        ]);
        expect(filterPlayerListRows(rows, '', 'restricted')).toEqual([
            rows[1],
            rows[2]
        ]);
    });

    it('counts each quick scope from the unfiltered room roster', () => {
        expect(countPlayerListScopes(rows)).toEqual({
            all: 3,
            friend: 2,
            favorite: 1,
            restricted: 2
        });
    });
});
