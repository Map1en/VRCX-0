import { beforeEach, describe, expect, it, vi } from 'vitest';

const tauriMock = vi.hoisted(() => ({
    commands: {
        appGameLogQuery: vi.fn()
    }
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: tauriMock.commands
}));

import gameLogRepository from './gameLogPersistenceRepository';

describe('gameLogPersistenceRepository', () => {
    beforeEach(() => {
        tauriMock.commands.appGameLogQuery.mockReset();
        tauriMock.commands.appGameLogQuery.mockResolvedValue([]);
    });

    it('keeps previous instance user queries unbounded by default', async () => {
        await gameLogRepository.getPreviousInstancesByUserId({
            id: ' usr_target '
        });

        expect(tauriMock.commands.appGameLogQuery).toHaveBeenCalledWith({
            kind: 'previousInstancesByUserIdRows',
            params: {
                userId: 'usr_target'
            }
        });
    });

    it('passes optional previous instance date windows to persistence', async () => {
        await gameLogRepository.getPreviousInstancesByUserId(
            { id: ' usr_self ' },
            {
                dateFrom: ' 2026-06-03T12:00:00.000Z ',
                dateTo: ' 2026-07-03T12:00:00.000Z '
            }
        );

        expect(tauriMock.commands.appGameLogQuery).toHaveBeenCalledWith({
            kind: 'previousInstancesByUserIdRows',
            params: {
                userId: 'usr_self',
                dateFrom: '2026-06-03T12:00:00.000Z',
                dateTo: '2026-07-03T12:00:00.000Z'
            }
        });
    });

    it('keeps the first join time and tracks the last leave time for instance players', async () => {
        tauriMock.commands.appGameLogQuery.mockResolvedValueOnce([
            {
                rowId: 1,
                created_at: '2026-01-01T12:00:00.000Z',
                displayName: 'Ava',
                userId: 'usr_ava',
                time: 0,
                type: 'OnPlayerJoined'
            },
            {
                rowId: 2,
                created_at: '2026-01-01T12:07:00.000Z',
                displayName: 'Ava',
                userId: 'usr_ava',
                time: 420_000,
                type: 'OnPlayerLeft'
            },
            {
                rowId: 3,
                created_at: '2026-01-01T12:10:00.000Z',
                displayName: 'Ava',
                userId: 'usr_ava',
                time: 0,
                type: 'OnPlayerJoined'
            },
            {
                rowId: 4,
                created_at: '2026-01-01T12:12:00.000Z',
                displayName: 'Ava',
                userId: 'usr_ava',
                time: 120_000,
                type: 'OnPlayerLeft'
            }
        ]);

        const players =
            await gameLogRepository.getPlayersFromInstance('wrld_test:12345');

        expect(tauriMock.commands.appGameLogQuery).toHaveBeenCalledWith({
            kind: 'playersFromInstanceRows',
            params: {
                location: 'wrld_test:12345'
            }
        });
        expect(players.get('usr_ava')).toMatchObject({
            created_at: '2026-01-01T12:00:00.000Z',
            left_at: '2026-01-01T12:12:00.000Z',
            time: 540_000,
            count: 2
        });
    });
});
