import { beforeEach, describe, expect, it, vi } from 'vitest';

const commandMocks = vi.hoisted(() => ({
    appUserTablesEnsure: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: commandMocks
}));

import userSessionRepository from './userSessionRepository';

describe('userSessionRepository', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        commandMocks.appUserTablesEnsure.mockImplementation((userId: string) =>
            Promise.resolve({
                userId,
                userPrefix:
                    userSessionRepository.normalizeUserTablePrefix(userId)
            })
        );
    });

    it('normalizes safe user ids into SQLite table prefixes', () => {
        expect(
            userSessionRepository.normalizeUserTablePrefix(' usr_123-abc ')
        ).toBe('usr123abc');
        expect(userSessionRepository.normalizeUserTablePrefix('123')).toBe(
            '_123'
        );
        expect(() =>
            userSessionRepository.normalizeUserTablePrefix('')
        ).toThrow('requires a user id');
        expect(() =>
            userSessionRepository.normalizeUserTablePrefix('usr/unsafe')
        ).toThrow('invalid characters');
    });

    it('coalesces repeated ensure calls for the same normalized prefix', async () => {
        await Promise.all([
            userSessionRepository.ensureUserTables('usr_cache-1'),
            userSessionRepository.ensureUserTables('usr_cache_1')
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

        await expect(
            userSessionRepository.ensureUserTables('usr_retry')
        ).rejects.toThrow('init failed');
        await expect(
            userSessionRepository.ensureUserTables('usr_retry')
        ).resolves.toEqual({
            userId: 'usr_retry',
            userPrefix: 'usrretry'
        });
        expect(commandMocks.appUserTablesEnsure).toHaveBeenCalledTimes(2);
    });
});
