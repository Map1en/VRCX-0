import { describe, expect, it } from 'vitest';

import {
    buildFavoriteIdSet,
    buildPlayerSourceRows,
    isLiveLocation,
    normalizeString,
    parseTimeMs
} from './playerListRows.js';

describe('playerListRows', () => {
    it('normalizes ids and timestamps used by the current instance list', () => {
        expect(normalizeString(' usr_1 ')).toBe('usr_1');
        expect(normalizeString(null)).toBe('');
        expect(parseTimeMs(1234)).toBe(1234);
        expect(parseTimeMs('1234')).toBe(1234);
        expect(parseTimeMs('2026-01-02T03:04:05.000Z')).toBe(
            Date.parse('2026-01-02T03:04:05.000Z')
        );
        expect(parseTimeMs('not a date')).toBe(0);
    });

    it('recognizes only live world locations as active instance locations', () => {
        expect(isLiveLocation('wrld_123:456')).toBe(true);
        expect(isLiveLocation('private')).toBe(false);
        expect(isLiveLocation('offline')).toBe(false);
        expect(isLiveLocation('traveling')).toBe(false);
        expect(isLiveLocation('')).toBe(false);
    });

    it('combines remote and local favorite friend ids once', () => {
        expect(
            Array.from(
                buildFavoriteIdSet([' usr_remote ', 'usr_shared', ''], {
                    groupA: ['usr_local', 'usr_shared'],
                    groupB: null,
                    groupC: ['usr_other']
                })
            )
        ).toEqual(['usr_remote', 'usr_shared', 'usr_local', 'usr_other']);
    });

    it('deduplicates player rows and prepends the current user when the game is in a live instance', () => {
        expect(
            buildPlayerSourceRows({
                playerRows: [
                    { userId: 'usr_a', displayName: 'A' },
                    { userId: 'usr_a', displayName: 'A duplicate' },
                    { id: 'row_without_user', displayName: 'No user id' },
                    { id: 'row_without_user', displayName: 'Duplicate row id' },
                    { userId: 'usr_self', displayName: 'Self from log' }
                ],
                currentUserId: 'usr_self',
                currentUserSnapshot: {
                    id: 'usr_self',
                    displayName: 'Current User'
                },
                isGameRunning: true,
                context: {
                    location: 'wrld_live:123',
                    createdAt: '2026-01-02T03:04:05.000Z'
                },
                currentUserLocation: '',
                currentLocationStartedAt: ''
            })
        ).toEqual([
            {
                id: 'usr_self',
                userId: 'usr_self',
                displayName: 'Current User',
                joinedAt: '2026-01-02T03:04:05.000Z',
                joinedAtMs: Date.parse('2026-01-02T03:04:05.000Z'),
                lastDurationMs: 0,
                ref: {
                    id: 'usr_self',
                    displayName: 'Current User'
                },
                source: 'runtime'
            },
            { userId: 'usr_a', displayName: 'A' },
            { id: 'row_without_user', displayName: 'No user id' }
        ]);
    });

    it('uses the current runtime location start time for the current user row', () => {
        expect(
            buildPlayerSourceRows({
                playerRows: [],
                currentUserId: 'usr_self',
                currentUserSnapshot: {
                    username: 'Self Username'
                },
                isGameRunning: true,
                context: {
                    location: 'wrld_live:123',
                    createdAt: '2026-01-02T03:04:05.000Z'
                },
                currentUserLocation: '',
                currentLocationStartedAt: '2026-02-03T04:05:06.000Z'
            })[0]
        ).toMatchObject({
            id: 'usr_self',
            displayName: 'Self Username',
            joinedAt: '2026-02-03T04:05:06.000Z',
            joinedAtMs: Date.parse('2026-02-03T04:05:06.000Z')
        });
    });

    it('does not add another current user row when the source already identifies them by row id', () => {
        expect(
            buildPlayerSourceRows({
                playerRows: [
                    { id: 'usr_self', displayName: 'Self from source' }
                ],
                currentUserId: 'usr_self',
                currentUserSnapshot: {
                    displayName: 'Current User'
                },
                isGameRunning: true,
                context: {
                    location: 'wrld_live:123',
                    createdAt: '2026-01-02T03:04:05.000Z'
                },
                currentUserLocation: '',
                currentLocationStartedAt: ''
            })
        ).toEqual([{ id: 'usr_self', displayName: 'Self from source' }]);
    });

    it('does not add the current user when the list is not a live running instance', () => {
        expect(
            buildPlayerSourceRows({
                playerRows: [],
                currentUserId: 'usr_self',
                currentUserSnapshot: { displayName: 'Current User' },
                isGameRunning: true,
                context: {
                    location: 'private',
                    createdAt: '2026-01-02T03:04:05.000Z'
                },
                currentUserLocation: '',
                currentLocationStartedAt: ''
            })
        ).toEqual([]);

        expect(
            buildPlayerSourceRows({
                playerRows: [],
                currentUserId: 'usr_self',
                currentUserSnapshot: { displayName: 'Current User' },
                isGameRunning: false,
                context: {
                    location: 'wrld_live:123',
                    createdAt: '2026-01-02T03:04:05.000Z'
                },
                currentUserLocation: '',
                currentLocationStartedAt: ''
            })
        ).toEqual([]);
    });
});
