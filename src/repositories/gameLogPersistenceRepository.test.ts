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
});
