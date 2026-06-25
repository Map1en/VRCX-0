import { beforeEach, describe, expect, it, vi } from 'vitest';

import { commands } from '@/platform/tauri/bindings';

import { getCurrentInstanceSnapshot } from './playerListPersistenceRepository';

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appPlayerListLocationGet: vi.fn(),
        appPlayerListLatestLocationGet: vi.fn(),
        appPlayerListJoinLeaveRows: vi.fn()
    }
}));

describe('playerListPersistenceRepository', () => {
    beforeEach(() => {
        vi.mocked(commands.appPlayerListLocationGet).mockReset();
        vi.mocked(commands.appPlayerListLatestLocationGet).mockReset();
        vi.mocked(commands.appPlayerListJoinLeaveRows).mockReset();
    });

    it('does not include join rows from earlier visits to the same instance', async () => {
        vi.mocked(commands.appPlayerListLocationGet).mockResolvedValueOnce({
            createdAt: '2026-04-30T10:00:00.000Z',
            location: 'wrld_live:123',
            worldId: 'wrld_live',
            worldName: 'Live World',
            time: 0,
            groupName: ''
        });
        vi.mocked(commands.appPlayerListJoinLeaveRows).mockResolvedValueOnce([
            {
                id: 1,
                createdAt: '2026-01-01T10:00:00.000Z',
                type: 'OnPlayerJoined',
                displayName: 'Old Player',
                userId: 'usr_old',
                time: 0
            },
            {
                id: 2,
                createdAt: '2026-04-30T10:01:00.000Z',
                type: 'OnPlayerJoined',
                displayName: 'Current Player',
                userId: 'usr_current',
                time: 0
            }
        ]);

        await expect(
            getCurrentInstanceSnapshot({
                currentLocation: 'wrld_live:123'
            })
        ).resolves.toMatchObject({
            players: [
                {
                    userId: 'usr_current',
                    displayName: 'Current Player'
                }
            ]
        });
    });

    it('uses the runtime location start time over stale database location rows', async () => {
        vi.mocked(commands.appPlayerListLocationGet).mockResolvedValueOnce({
            createdAt: '2026-01-01T10:00:00.000Z',
            location: 'wrld_live:123',
            worldId: 'wrld_live',
            worldName: 'Live World',
            time: 0,
            groupName: ''
        });
        vi.mocked(commands.appPlayerListJoinLeaveRows).mockResolvedValueOnce([
            {
                id: 1,
                createdAt: '2026-01-01T10:01:00.000Z',
                type: 'OnPlayerJoined',
                displayName: 'Old Player',
                userId: 'usr_old',
                time: 0
            },
            {
                id: 2,
                createdAt: '2026-04-30T10:01:00.000Z',
                type: 'OnPlayerJoined',
                displayName: 'Current Player',
                userId: 'usr_current',
                time: 0
            }
        ]);

        const snapshot = await getCurrentInstanceSnapshot({
            currentLocation: 'wrld_live:123',
            currentLocationStartedAt: '2026-04-30T10:00:00.000Z'
        });

        expect(snapshot.context.createdAt).toBe('2026-04-30T10:00:00.000Z');
        expect(snapshot.players).toEqual([
            expect.objectContaining({
                userId: 'usr_current',
                displayName: 'Current Player'
            })
        ]);
    });

    it('removes a joined row by unique display name when the leave row has a different id key', async () => {
        vi.mocked(commands.appPlayerListLocationGet).mockResolvedValueOnce({
            createdAt: '2026-04-30T10:00:00.000Z',
            location: 'wrld_live:123',
            worldId: 'wrld_live',
            worldName: 'Live World',
            time: 0,
            groupName: ''
        });
        vi.mocked(commands.appPlayerListJoinLeaveRows).mockResolvedValueOnce([
            {
                id: 1,
                createdAt: '2026-04-30T10:01:00.000Z',
                type: 'OnPlayerJoined',
                displayName: 'Left Player',
                userId: '',
                time: 0
            },
            {
                id: 2,
                createdAt: '2026-04-30T10:02:00.000Z',
                type: 'OnPlayerLeft',
                displayName: 'Left Player',
                userId: 'usr_left',
                time: 60000
            }
        ]);

        await expect(
            getCurrentInstanceSnapshot({
                currentLocation: 'wrld_live:123'
            })
        ).resolves.toMatchObject({
            players: []
        });
    });

    it('falls back to the database enter time when a stale runtime start filters the roster out', async () => {
        vi.mocked(commands.appPlayerListLocationGet).mockResolvedValueOnce({
            createdAt: '2026-06-09T12:26:31.000Z',
            location: 'wrld_live:83220',
            worldId: 'wrld_live',
            worldName: 'Live World',
            time: 0,
            groupName: ''
        });
        const joinRow = {
            id: 1,
            createdAt: '2026-06-09T12:26:59.000Z',
            type: 'OnPlayerJoined',
            displayName: 'CyanChanges',
            userId: 'usr_cyan',
            time: 0
        };
        vi.mocked(commands.appPlayerListJoinLeaveRows)
            .mockResolvedValueOnce([joinRow])
            .mockResolvedValueOnce([joinRow]);

        const snapshot = await getCurrentInstanceSnapshot({
            currentLocation: 'wrld_live:83220',
            // WS user-location fallback "now", later than every join row
            currentLocationStartedAt: '2026-06-10T19:00:00.000Z'
        });

        expect(snapshot.players).toEqual([
            expect.objectContaining({
                userId: 'usr_cyan',
                displayName: 'CyanChanges'
            })
        ]);
        expect(snapshot.context.createdAt).toBe('2026-06-09T12:26:31.000Z');
        expect(snapshot.context.playerFactsKnown).toBe(true);
    });
});
