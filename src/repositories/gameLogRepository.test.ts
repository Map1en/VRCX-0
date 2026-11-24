import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const commandMocks = vi.hoisted(() => ({
    sessionsQuery: vi.fn()
}));
const persistenceMocks = vi.hoisted(() => ({
    lookupGameLogDatabase: vi.fn(),
    searchGameLogDatabase: vi.fn()
}));
const configMocks = vi.hoisted(() => ({
    getInt: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appGameLogSessionsQuery: commandMocks.sessionsQuery
    }
}));

vi.mock('./configRepository', () => ({
    default: configMocks
}));

vi.mock('./gameLogPersistenceRepository', () => ({
    default: persistenceMocks
}));

import gameLogRepository from './gameLogRepository';

describe('gameLogRepository', () => {
    beforeEach(() => {
        vi.stubEnv('TZ', 'America/Los_Angeles');
        commandMocks.sessionsQuery.mockReset();
        commandMocks.sessionsQuery.mockResolvedValue({ sessions: [] });
        configMocks.getInt.mockReset();
        configMocks.getInt.mockResolvedValue(0);
        persistenceMocks.lookupGameLogDatabase.mockReset();
        persistenceMocks.lookupGameLogDatabase.mockResolvedValue([]);
        persistenceMocks.searchGameLogDatabase.mockReset();
        persistenceMocks.searchGameLogDatabase.mockResolvedValue([]);
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('treats date-only session filters as local calendar days', async () => {
        await gameLogRepository.queryLatestSessions({
            dateFrom: '2026-07-04',
            dateTo: '2026-07-04'
        });

        expect(commandMocks.sessionsQuery).toHaveBeenCalledWith(
            expect.objectContaining({
                dateFrom: '2026-07-04T07:00:00.000Z',
                dateTo: '2026-07-05T06:59:59.999Z'
            })
        );
    });

    it('caps lookup rows without exceeding the configured table size', async () => {
        configMocks.getInt.mockImplementation(async (key: string) =>
            key === 'maxTableSize_v2' ? 500 : 50000
        );

        await gameLogRepository.queryGameLog({ filters: ['Location'] });

        expect(persistenceMocks.lookupGameLogDatabase).toHaveBeenLastCalledWith(
            ['Location'],
            [],
            500,
            500
        );

        await gameLogRepository.queryGameLog({
            filters: ['Location'],
            limit: 200
        });

        expect(persistenceMocks.lookupGameLogDatabase).toHaveBeenCalledWith(
            ['Location'],
            [],
            500,
            200
        );

        configMocks.getInt.mockImplementation(async (key: string) =>
            key === 'maxTableSize_v2' ? 75 : 50000
        );

        await gameLogRepository.queryGameLog({
            filters: ['Location'],
            limit: 200
        });

        expect(persistenceMocks.lookupGameLogDatabase).toHaveBeenLastCalledWith(
            ['Location'],
            [],
            75,
            75
        );
    });

    it('applies the same row cap to search results', async () => {
        configMocks.getInt.mockImplementation(async (key: string) =>
            key === 'maxTableSize_v2' ? 500 : 50000
        );

        await gameLogRepository.queryGameLog({
            currentUserId: 'usr_self',
            search: 'Friend',
            limit: 200
        });

        expect(persistenceMocks.searchGameLogDatabase).toHaveBeenCalledWith(
            'Friend',
            [],
            [],
            50000,
            'usr_self',
            200
        );

        configMocks.getInt.mockImplementation(async (key: string) =>
            key === 'searchLimit' ? 75 : 500
        );

        await gameLogRepository.queryGameLog({ search: 'Friend', limit: 200 });

        expect(persistenceMocks.searchGameLogDatabase).toHaveBeenLastCalledWith(
            'Friend',
            [],
            [],
            75,
            '',
            75
        );
    });
});
