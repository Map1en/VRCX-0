// @vitest-environment jsdom

import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getCurrentInstanceSnapshot: vi.fn()
}));

vi.mock('@/repositories/playerListPersistenceRepository', () => ({
    default: {
        getCurrentInstanceSnapshot: mocks.getCurrentInstanceSnapshot
    }
}));

import { useInstancePresenceStore } from '@/state/instancePresenceStore';
import { useRuntimeStore } from '@/state/runtimeStore';

import { useCurrentInstancePresence } from './useCurrentInstancePresence';

describe('useCurrentInstancePresence', () => {
    beforeEach(() => {
        mocks.getCurrentInstanceSnapshot.mockReset();
        useInstancePresenceStore.getState().resetInstancePresence();
        useRuntimeStore.setState((state) => ({
            ...state,
            auth: {
                ...state.auth,
                currentUserEndpoint: 'https://api.vrchat.cloud/api/1',
                currentUserId: 'usr_self',
                currentUserSnapshot: {
                    id: 'usr_self'
                }
            },
            gameState: {
                ...state.gameState,
                currentLocation: '',
                currentLocationPlayerIds: [],
                currentLocationPlayers: [],
                currentLocationStartedAt: null,
                isGameRunning: true
            }
        }));
    });

    it('restores current instance players after restarting in an active instance', async () => {
        mocks.getCurrentInstanceSnapshot.mockResolvedValue({
            context: {
                createdAt: '2026-07-31T05:00:00.000Z',
                location: 'wrld_current:123',
                worldName: 'Current World'
            },
            players: [
                {
                    userId: 'usr_target',
                    displayName: 'Target',
                    joinedAt: '2026-07-31T05:01:00.000Z'
                }
            ]
        });

        const { result } = renderHook(() => useCurrentInstancePresence());

        await waitFor(() => {
            expect(result.current?.userIds).toEqual(['usr_target']);
        });
        expect(mocks.getCurrentInstanceSnapshot).toHaveBeenCalledTimes(1);
        expect(mocks.getCurrentInstanceSnapshot).toHaveBeenCalledWith({
            currentUserId: 'usr_self',
            currentLocation: '',
            currentLocationStartedAt: null
        });
        expect(useRuntimeStore.getState().gameState).toMatchObject({
            currentLocation: 'wrld_current:123',
            currentLocationPlayerIds: ['usr_target'],
            currentWorldId: 'wrld_current',
            currentWorldName: 'Current World'
        });
    });
});
