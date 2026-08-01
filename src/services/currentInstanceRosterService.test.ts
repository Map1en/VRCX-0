import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getCurrentInstanceSnapshot: vi.fn()
}));

vi.mock('@/repositories/playerListPersistenceRepository', () => ({
    default: {
        getCurrentInstanceSnapshot: mocks.getCurrentInstanceSnapshot
    }
}));

import { loadCurrentInstanceRoster } from './currentInstanceRosterService';

const runtimePlayer = {
    id: 'usr_runtime',
    userId: 'usr_runtime',
    displayName: 'Runtime Player',
    joinedAt: '2026-08-01T01:00:00.000Z',
    joinedAtMs: Date.parse('2026-08-01T01:00:00.000Z'),
    lastDurationMs: 0,
    source: 'runtime' as const
};

const worldId = 'wrld_00000000-0000-0000-0000-000000000000';

function runtime(players = [runtimePlayer]) {
    return {
        currentLocation: `${worldId}:1~region(jp)`,
        currentLocationStartedAt: '2026-08-01T01:00:00.000Z',
        currentWorldId: worldId,
        currentWorldName: 'Runtime World',
        players
    };
}

describe('currentInstanceRosterService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('prefers the matching live runtime mirror for current-instance dialogs', async () => {
        await expect(
            loadCurrentInstanceRoster({
                currentLocation: `${worldId}:1~region(jp)`,
                currentUserId: 'usr_self',
                runtime: runtime()
            })
        ).resolves.toEqual({
            context: {
                createdAt: '2026-08-01T01:00:00.000Z',
                groupName: '',
                location: `${worldId}:1~region(jp)`,
                playerCount: 1,
                playerFactsKnown: true,
                source: 'runtime',
                time: 0,
                worldId,
                worldName: 'Runtime World'
            },
            players: [runtimePlayer]
        });
        expect(mocks.getCurrentInstanceSnapshot).not.toHaveBeenCalled();
    });

    it('keeps the persistence fallback when the runtime mirror is empty', async () => {
        mocks.getCurrentInstanceSnapshot.mockResolvedValueOnce({
            context: {
                createdAt: '2026-08-01T00:00:00.000Z',
                groupName: '',
                location: `${worldId}:1~region(jp)`,
                playerCount: 1,
                source: 'database',
                time: 0,
                worldId,
                worldName: 'Recovered World'
            },
            players: [
                {
                    id: 'usr_recovered',
                    userId: 'usr_recovered',
                    displayName: 'Recovered Player',
                    joinedAt: '2026-08-01T00:00:00.000Z',
                    joinedAtMs: Date.parse('2026-08-01T00:00:00.000Z')
                }
            ]
        });

        const result = await loadCurrentInstanceRoster({
            currentLocation: `${worldId}:1~region(jp)`,
            currentLocationStartedAt: '2026-08-01T01:00:00.000Z',
            currentUserId: 'usr_self',
            runtime: runtime([])
        });

        expect(result.context.source).toBe('database');
        expect(result.players[0]?.displayName).toBe('Recovered Player');
        expect(mocks.getCurrentInstanceSnapshot).toHaveBeenCalledWith({
            currentLocation: `${worldId}:1~region(jp)`,
            currentLocationStartedAt: '2026-08-01T01:00:00.000Z',
            currentUserId: 'usr_self'
        });
    });
});
