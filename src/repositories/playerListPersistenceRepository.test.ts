import { beforeEach, describe, expect, it, vi } from 'vitest';

import { commands } from '@/platform/tauri/bindings';

import { getCurrentInstanceSnapshot } from './playerListPersistenceRepository';

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appPlayerListCurrentSnapshot: vi.fn()
    }
}));

describe('playerListPersistenceRepository', () => {
    beforeEach(() => {
        vi.mocked(commands.appPlayerListCurrentSnapshot).mockReset();
    });

    it('normalizes inputs before invoking the snapshot command', async () => {
        vi.mocked(commands.appPlayerListCurrentSnapshot).mockResolvedValueOnce({
            context: {
                createdAt: '',
                location: '',
                worldId: '',
                worldName: '',
                time: 0,
                groupName: '',
                source: 'none'
            },
            players: []
        });

        await getCurrentInstanceSnapshot({
            currentUserId: ' usr_me ',
            currentLocation: ' wrld_live:123 ',
            currentLocationStartedAt: undefined
        });

        expect(commands.appPlayerListCurrentSnapshot).toHaveBeenCalledWith(
            'usr_me',
            'wrld_live:123',
            ''
        );
    });

    it('sorts players by join time with locale-aware name tie-break', async () => {
        vi.mocked(commands.appPlayerListCurrentSnapshot).mockResolvedValueOnce({
            context: {
                createdAt: '2026-04-30T10:00:00.000Z',
                location: 'wrld_live:123',
                worldId: 'wrld_live',
                worldName: 'Live World',
                time: 0,
                groupName: '',
                source: 'database',
                playerCount: 3,
                observedPlayerEventCount: 3,
                playerFactsKnown: true
            },
            players: [
                {
                    id: 'usr_b',
                    userId: 'usr_b',
                    displayName: 'beta',
                    joinedAt: '2026-04-30T10:02:00.000Z',
                    joinedAtMs: 2
                },
                {
                    id: 'usr_c',
                    userId: 'usr_c',
                    displayName: 'Alpha',
                    joinedAt: '2026-04-30T10:02:00.000Z',
                    joinedAtMs: 2
                },
                {
                    id: 'usr_a',
                    userId: 'usr_a',
                    displayName: 'Zed',
                    joinedAt: '2026-04-30T10:01:00.000Z',
                    joinedAtMs: 1
                }
            ]
        });

        const snapshot = await getCurrentInstanceSnapshot({
            currentLocation: 'wrld_live:123'
        });

        expect(snapshot.players.map((player) => player.displayName)).toEqual([
            'Zed',
            'Alpha',
            'beta'
        ]);
        expect(snapshot.context.playerFactsKnown).toBe(true);
    });
});
