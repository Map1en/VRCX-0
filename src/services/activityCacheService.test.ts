import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getActivitySyncState: vi.fn(),
    getActivitySessions: vi.fn(),
    refreshSelfActivitySessions: vi.fn(),
    getSelfActivitySourceBounds: vi.fn(),
    syncStartupServicesTask: vi.fn()
}));

vi.mock('@/repositories/activityPersistenceRepository', () => ({
    default: {
        getActivitySyncState: mocks.getActivitySyncState,
        getActivitySessions: mocks.getActivitySessions,
        refreshSelfActivitySessions: mocks.refreshSelfActivitySessions,
        getSelfActivitySourceBounds: mocks.getSelfActivitySourceBounds
    }
}));

vi.mock('./startupServicesStatus', () => ({
    syncStartupServicesTask: mocks.syncStartupServicesTask
}));

import { useRuntimeStore } from '@/state/runtimeStore';
import { useSessionStore } from '@/state/sessionStore';

import {
    bootstrapActivityCache,
    resetActivityCacheState
} from './activityCacheService';

function installWindowStub() {
    globalThis.window = {
        setTimeout: globalThis.setTimeout,
        clearTimeout: globalThis.clearTimeout
    } as unknown as Window & typeof globalThis;
}

function setAuthenticatedUser(userId: string) {
    useSessionStore.getState().setSessionState({
        isLoggedIn: true,
        sessionPhase: 'ready'
    });
    useRuntimeStore.getState().setAuthBootstrap({
        currentUserId: userId,
        currentUserSnapshot: {
            id: userId,
            displayName: 'Current User'
        }
    });
}

describe('activityCacheService', () => {
    beforeEach(() => {
        installWindowStub();
        vi.clearAllMocks();
        useRuntimeStore.getState().resetRuntimeState();
        useSessionStore.getState().resetSessionState();
        resetActivityCacheState();
        mocks.getActivitySyncState.mockResolvedValue(null);
        mocks.getActivitySessions.mockResolvedValue([]);
        mocks.getSelfActivitySourceBounds.mockResolvedValue({
            firstCreatedAt: '',
            lastCreatedAt: '',
            count: 0
        });
    });

    it('deduplicates concurrent warmups and marks the current user cache ready', async () => {
        setAuthenticatedUser('usr_self');
        mocks.refreshSelfActivitySessions.mockResolvedValue({
            sync: {
                userId: 'usr_self',
                updatedAt: '2026-06-08T10:00:00.000Z',
                isSelf: true,
                sourceLastCreatedAt: '2026-06-08T09:00:00.000Z',
                pendingSessionStartAt: null,
                cachedRangeDays: 90
            },
            sessions: [
                {
                    start: 1,
                    end: 2,
                    isOpenTail: false,
                    sourceRevision: 'rev-1'
                }
            ],
            sourceCount: 1
        });

        const firstWarmup = bootstrapActivityCache({
            userId: 'usr_self',
            currentUserSnapshot: {
                id: 'usr_self',
                displayName: 'Current User'
            }
        });
        const secondWarmup = bootstrapActivityCache({
            userId: 'usr_self',
            currentUserSnapshot: {
                id: 'usr_self',
                displayName: 'Current User'
            }
        });

        expect(secondWarmup).toBe(firstWarmup);
        await expect(firstWarmup).resolves.toMatchObject({
            userId: 'usr_self',
            stale: false,
            cachedRangeDays: 90,
            sessionCount: 1
        });
        expect(mocks.refreshSelfActivitySessions).toHaveBeenCalledTimes(1);
        expect(mocks.refreshSelfActivitySessions).toHaveBeenCalledWith({
            userId: 'usr_self',
            mode: 'full',
            rangeDays: 90
        });
        expect(useRuntimeStore.getState().activity).toMatchObject({
            currentUserId: 'usr_self',
            status: 'ready',
            cachedRangeDays: 90,
            sessionCount: 1,
            fullCacheReady: true
        });
    });

    it('returns stale without publishing ready state when the authenticated target changes mid-warmup', async () => {
        setAuthenticatedUser('usr_self');
        mocks.refreshSelfActivitySessions.mockImplementation(async () => {
            useRuntimeStore.getState().setAuthBootstrap({
                currentUserId: 'usr_other'
            });
            return {
                sync: {
                    userId: 'usr_self',
                    updatedAt: '2026-06-08T10:00:00.000Z',
                    isSelf: true,
                    sourceLastCreatedAt: '2026-06-08T09:00:00.000Z',
                    pendingSessionStartAt: null,
                    cachedRangeDays: 90
                },
                sessions: [],
                sourceCount: 0
            };
        });

        await expect(
            bootstrapActivityCache({
                userId: 'usr_self',
                currentUserSnapshot: {
                    id: 'usr_self',
                    displayName: 'Current User'
                }
            })
        ).resolves.toMatchObject({
            userId: 'usr_self',
            stale: true
        });

        expect(mocks.getSelfActivitySourceBounds).not.toHaveBeenCalled();
        expect(useRuntimeStore.getState().activity).toMatchObject({
            currentUserId: 'usr_self',
            status: 'running',
            fullCacheReady: false
        });
    });
});
