import { beforeEach, describe, expect, it } from 'vitest';

import {
    cachePreviousInstances,
    cacheUserStats,
    clearUserDialogCaches,
    dialogTargetKey,
    readCachedPreviousInstances,
    readCachedUserStats
} from './userDialogCache.js';

describe('userDialogCache', () => {
    beforeEach(() => {
        clearUserDialogCaches();
    });

    it('uses the API endpoint and normalized user id to remember one user dialog target', () => {
        expect(
            dialogTargetKey(' https://api.example.test ', ' usr_target ')
        ).toBe('https://api.example.test:usr_target');
        expect(dialogTargetKey('https://api.example.test', '')).toBe('');
    });

    it('shows empty stats and no previous instances before a user has loaded', () => {
        const key = dialogTargetKey('https://api.example.test', 'usr_missing');

        expect(readCachedUserStats(key)).toEqual({
            timeSpent: 0,
            lastSeen: '',
            joinCount: 0,
            previousDisplayNames: []
        });
        expect(readCachedPreviousInstances(key)).toEqual([]);
    });

    it('restores cached stats and previous instances when the same user dialog opens again', () => {
        const key = dialogTargetKey('https://api.example.test', 'usr_target');
        cacheUserStats(key, {
            timeSpent: 12345,
            lastSeen: '2026-01-02T03:04:05.000Z',
            joinCount: 7,
            previousDisplayNames: [{ displayName: 'Old Name' }]
        });
        cachePreviousInstances(key, [
            { id: 'row_1', location: 'wrld_one:1' },
            { id: 'row_2', location: 'wrld_two:2' }
        ]);

        expect(readCachedUserStats(key)).toEqual({
            timeSpent: 12345,
            lastSeen: '2026-01-02T03:04:05.000Z',
            joinCount: 7,
            previousDisplayNames: [{ displayName: 'Old Name' }]
        });
        expect(readCachedPreviousInstances(key)).toEqual([
            { id: 'row_1', location: 'wrld_one:1' },
            { id: 'row_2', location: 'wrld_two:2' }
        ]);
    });

    it('shows the original cached stats when a dialog-local copy is edited then reopened', () => {
        const key = dialogTargetKey('https://api.example.test', 'usr_target');
        cacheUserStats(key, {
            timeSpent: '2000',
            lastSeen: '2026-01-02T03:04:05.000Z',
            joinCount: '3',
            previousDisplayNames: [{ displayName: 'Original' }]
        });

        const firstRead = readCachedUserStats(key);
        firstRead.previousDisplayNames[0].displayName = 'Mutated';
        firstRead.timeSpent = 0;

        expect(readCachedUserStats(key)).toEqual({
            timeSpent: 2000,
            lastSeen: '2026-01-02T03:04:05.000Z',
            joinCount: 3,
            previousDisplayNames: [{ displayName: 'Original' }]
        });
    });

    it('shows the original previous instance list when a dialog-local list is edited then reopened', () => {
        const key = dialogTargetKey('https://api.example.test', 'usr_target');
        cachePreviousInstances(key, [{ id: 'row_1' }]);

        const firstRead = readCachedPreviousInstances(key);
        firstRead.push({ id: 'row_2' });

        expect(readCachedPreviousInstances(key)).toEqual([{ id: 'row_1' }]);
    });
});
