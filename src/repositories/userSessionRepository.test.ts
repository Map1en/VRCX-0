import { beforeEach, describe, expect, it, vi } from 'vitest';

const commandMocks = vi.hoisted(() => ({
    appUserTablesEnsure: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: commandMocks
}));

import {
    ensureUserTables,
    initUserTablesUncached,
    normalizeUserTablePrefix
} from './userSessionRepository';

describe('userSessionRepository', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        commandMocks.appUserTablesEnsure.mockImplementation((userId: string) =>
            Promise.resolve({
                userId,
                userPrefix: normalizeUserTablePrefix(userId)
            })
        );
    });

    it('normalizes safe user ids into SQLite table prefixes', () => {
        expect(normalizeUserTablePrefix(' usr_123-abc ')).toBe('usr123abc');
        expect(normalizeUserTablePrefix('123')).toBe('_123');
        expect(() => normalizeUserTablePrefix('')).toThrow(
            'requires a user id'
        );
        expect(() => normalizeUserTablePrefix('usr/unsafe')).toThrow(
            'invalid characters'
        );
    });

    it('coalesces repeated ensure calls for the same normalized prefix', async () => {
        await Promise.all([
            ensureUserTables('usr_cache-1'),
            ensureUserTables('usr_cache_1')
        ]);

        expect(commandMocks.appUserTablesEnsure).toHaveBeenCalledTimes(1);
        expect(commandMocks.appUserTablesEnsure).toHaveBeenCalledWith(
            'usr_cache-1'
        );
    });

    it('clears failed ensure promises so a later retry can run', async () => {
        commandMocks.appUserTablesEnsure
            .mockRejectedValueOnce(new Error('init failed'))
            .mockResolvedValueOnce({
                userId: 'usr_retry',
                userPrefix: 'usrretry'
            });

        await expect(ensureUserTables('usr_retry')).rejects.toThrow(
            'init failed'
        );
        await expect(ensureUserTables('usr_retry')).resolves.toEqual({
            userId: 'usr_retry',
            userPrefix: 'usrretry'
        });
        expect(commandMocks.appUserTablesEnsure).toHaveBeenCalledTimes(2);
    });

    it('supports an uncached initialization path', async () => {
        await initUserTablesUncached(' usr_uncached ');

        expect(commandMocks.appUserTablesEnsure).toHaveBeenCalledWith(
            'usr_uncached'
        );
    });
});
