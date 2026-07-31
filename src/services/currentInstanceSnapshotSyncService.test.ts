import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getCurrentInstanceSnapshot: vi.fn(),
    recordGameRuntimePresence: vi.fn()
}));

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((promiseResolve) => {
        resolve = promiseResolve;
    });
    return { promise, resolve };
}

vi.mock('@/repositories/playerListPersistenceRepository', () => ({
    default: {
        getCurrentInstanceSnapshot: mocks.getCurrentInstanceSnapshot
    }
}));

vi.mock('./domainIngestionService', () => ({
    recordGameRuntimePresence: mocks.recordGameRuntimePresence
}));

import { useRuntimeStore } from '@/state/runtimeStore';

import { startCurrentInstanceSnapshotSync } from './currentInstanceSnapshotSyncService';

describe('currentInstanceSnapshotSyncService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useRuntimeStore.getState().resetRuntimeState();
    });

    it('restores the current roster once after the app resumes into a running game', async () => {
        const location = 'wrld_current:123';
        mocks.getCurrentInstanceSnapshot.mockResolvedValue({
            context: {
                createdAt: '2026-07-31T10:00:00.000Z',
                location,
                worldId: 'wrld_current',
                worldName: 'Current World'
            },
            players: [
                {
                    displayName: 'Friend',
                    joinedAt: '2026-07-31T10:01:00.000Z',
                    joinedAtMs: 1,
                    userId: 'usr_friend'
                }
            ]
        });
        const cleanup = startCurrentInstanceSnapshotSync();
        useRuntimeStore.getState().setAuthBootstrap({
            currentUserEndpoint: 'https://api.vrchat.cloud/api/1',
            currentUserId: 'usr_self',
            currentUserSnapshot: {
                id: 'usr_self',
                location
            }
        });
        useRuntimeStore.getState().setGameState({
            isGameRunning: true,
            lastGameStartedAt: '2026-07-31T09:00:00.000Z'
        });

        await vi.waitFor(() =>
            expect(
                useRuntimeStore.getState().gameState.currentLocationPlayerIds
            ).toEqual(['usr_friend'])
        );
        expect(mocks.getCurrentInstanceSnapshot).toHaveBeenCalledWith({
            currentUserId: 'usr_self',
            currentLocation: location,
            currentLocationStartedAt: '2026-07-31T09:00:00.000Z'
        });
        expect(mocks.getCurrentInstanceSnapshot).toHaveBeenCalledTimes(1);
        expect(mocks.recordGameRuntimePresence).toHaveBeenCalledWith(
            expect.objectContaining({
                currentLocation: location,
                currentUserId: 'usr_self'
            })
        );

        cleanup();
    });

    it('does not restore a stale snapshot without a concrete current location', async () => {
        useRuntimeStore.getState().setAuthBootstrap({
            currentUserId: 'usr_self',
            currentUserSnapshot: {
                id: 'usr_self',
                location: 'private'
            }
        });
        useRuntimeStore.getState().setGameState({
            isGameRunning: true
        });

        const cleanup = startCurrentInstanceSnapshotSync();
        await Promise.resolve();

        expect(mocks.getCurrentInstanceSnapshot).not.toHaveBeenCalled();
        cleanup();
    });

    it('does not replace an explicit runtime sentinel with a stale profile location', async () => {
        useRuntimeStore.getState().setAuthBootstrap({
            currentUserId: 'usr_self',
            currentUserSnapshot: {
                id: 'usr_self',
                location: 'wrld_stale:123'
            }
        });
        useRuntimeStore.getState().setGameState({
            currentLocation: 'offline',
            isGameRunning: true
        });

        const cleanup = startCurrentInstanceSnapshotSync();
        await Promise.resolve();

        expect(mocks.getCurrentInstanceSnapshot).not.toHaveBeenCalled();
        cleanup();
    });

    it('does not overwrite a live roster that arrives before recovery completes', async () => {
        const location = 'wrld_current:123';
        const snapshotRequest = deferred<{
            context: {
                createdAt: string;
                location: string;
                worldId: string;
                worldName: string;
            };
            players: Array<{
                displayName: string;
                joinedAt: string;
                joinedAtMs: number;
                userId: string;
            }>;
        }>();
        mocks.getCurrentInstanceSnapshot.mockReturnValue(
            snapshotRequest.promise
        );
        useRuntimeStore.getState().setAuthBootstrap({
            currentUserEndpoint: 'https://api.vrchat.cloud/api/1',
            currentUserId: 'usr_self',
            currentUserSnapshot: {
                id: 'usr_self',
                location
            }
        });
        useRuntimeStore.getState().setGameState({
            currentLocation: location,
            currentLocationStartedAt: '2026-07-31T10:00:00.000Z',
            isGameRunning: true
        });

        const cleanup = startCurrentInstanceSnapshotSync();
        await vi.waitFor(() =>
            expect(mocks.getCurrentInstanceSnapshot).toHaveBeenCalledTimes(1)
        );
        useRuntimeStore.getState().setGameState({
            currentLocationPlayerIds: ['usr_live'],
            currentLocationPlayers: [
                {
                    displayName: 'Live Player',
                    userId: 'usr_live'
                }
            ]
        });
        snapshotRequest.resolve({
            context: {
                createdAt: '2026-07-31T10:00:00.000Z',
                location,
                worldId: 'wrld_current',
                worldName: 'Current World'
            },
            players: [
                {
                    displayName: 'Stale Player',
                    joinedAt: '2026-07-31T10:01:00.000Z',
                    joinedAtMs: 1,
                    userId: 'usr_stale'
                }
            ]
        });
        await snapshotRequest.promise;
        await Promise.resolve();

        expect(
            useRuntimeStore.getState().gameState.currentLocationPlayerIds
        ).toEqual(['usr_live']);
        expect(mocks.recordGameRuntimePresence).not.toHaveBeenCalled();
        cleanup();
    });
});
