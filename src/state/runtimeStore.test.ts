import { beforeEach, describe, expect, it } from 'vitest';

import { useRuntimeStore } from './runtimeStore';

describe('runtimeStore render mirrors', () => {
    beforeEach(() => {
        useRuntimeStore.getState().resetRuntimeState();
    });

    it('merges game-state patches without replacing the render mirror', () => {
        useRuntimeStore.getState().setGameState({
            isGameRunning: true,
            currentLocation: 'wrld_1:123',
            currentWorldName: 'World One',
            currentLocationPlayerIds: ['usr_a']
        });
        useRuntimeStore.getState().setGameState({
            currentWorldName: 'World Two'
        });

        expect(useRuntimeStore.getState().gameState).toMatchObject({
            isGameRunning: true,
            currentLocation: 'wrld_1:123',
            currentWorldName: 'World Two',
            currentLocationPlayerIds: ['usr_a']
        });
    });

    it('records runtime event counts and payloads for event-driven UI refresh', () => {
        useRuntimeStore
            .getState()
            .recordRuntimeEvent('addGameLogEvent', { id: 1 });
        useRuntimeStore
            .getState()
            .recordRuntimeEvent('addGameLogEvent', { id: 2 });
        useRuntimeStore
            .getState()
            .recordRuntimeEvent('newRuntimeEvent', { ok: true });

        expect(
            useRuntimeStore.getState().runtimeEvents.addGameLogEvent
        ).toEqual(
            expect.objectContaining({
                count: 2,
                lastPayload: { id: 2 },
                lastReceivedAt: expect.any(String)
            })
        );
        expect(
            useRuntimeStore.getState().runtimeEvents.newRuntimeEvent
        ).toEqual(
            expect.objectContaining({
                count: 1,
                lastPayload: { ok: true },
                lastReceivedAt: expect.any(String)
            })
        );
    });

    it('resets group instances when authenticated owner scope changes', () => {
        useRuntimeStore.getState().setAuthBootstrap({
            currentUserId: 'usr_self',
            currentUserEndpoint: 'https://api.example.test'
        });
        useRuntimeStore.getState().setGroupInstancesState({
            status: 'ready',
            userId: 'usr_self',
            endpoint: 'https://api.example.test',
            instances: [{ id: 'instance-1' }],
            groupOrder: ['grp_1'],
            error: ''
        });

        useRuntimeStore.getState().setAuthBootstrap({
            currentUserDisplayName: 'Self'
        });
        expect(useRuntimeStore.getState().groupInstances).toMatchObject({
            status: 'ready',
            instances: [{ id: 'instance-1' }]
        });

        useRuntimeStore.getState().setAuthBootstrap({
            currentUserEndpoint: 'https://api.other.test'
        });
        expect(useRuntimeStore.getState().groupInstances).toMatchObject({
            status: 'idle',
            userId: '',
            endpoint: '',
            instances: [],
            groupOrder: [],
            error: ''
        });
    });

    it('resets friend profile loading when authenticated owner scope changes', () => {
        useRuntimeStore.getState().setAuthBootstrap({
            currentUserId: 'usr_self',
            currentUserEndpoint: 'https://api.example.test'
        });
        useRuntimeStore.getState().setFriendProfileLoadState({
            runId: 3,
            status: 'running',
            ownerUserId: 'usr_self',
            ownerEndpoint: 'https://api.example.test',
            totalFriends: 8,
            dialogOpen: true
        });

        useRuntimeStore.getState().setAuthBootstrap({
            currentUserDisplayName: 'Self'
        });
        expect(useRuntimeStore.getState().friendProfileLoad.status).toBe(
            'running'
        );

        useRuntimeStore.getState().setAuthBootstrap({
            currentUserEndpoint: 'https://api.other.test'
        });
        expect(useRuntimeStore.getState().friendProfileLoad).toMatchObject({
            runId: 0,
            status: 'idle',
            totalFriends: 0,
            dialogOpen: false
        });
    });

    it('mirrors database upgrade open state into system hosts', () => {
        useRuntimeStore.getState().setDatabaseUpgradeState({
            open: true,
            phase: 'copying',
            fromVersion: 17,
            toVersion: 18
        });

        expect(useRuntimeStore.getState().databaseUpgrade).toMatchObject({
            open: true,
            phase: 'copying',
            fromVersion: 17,
            toVersion: 18
        });
        expect(useRuntimeStore.getState().systemHosts.databaseUpgradeOpen).toBe(
            true
        );

        useRuntimeStore.getState().setDatabaseUpgradeState({
            phase: 'done'
        });
        expect(useRuntimeStore.getState().systemHosts.databaseUpgradeOpen).toBe(
            true
        );
    });

    it('resetRuntimeState restores startup, transport, and event mirrors', () => {
        useRuntimeStore.getState().setStartupTask('services', 'running', 'x');
        useRuntimeStore.getState().setTransportState({
            websocketConnected: true,
            websocketDomain: 'wss://pipeline.example'
        });
        useRuntimeStore
            .getState()
            .recordRuntimeEvent('backendRuntimeTelemetry', {
                kind: 'snapshot'
            });

        useRuntimeStore.getState().resetRuntimeState();

        expect(useRuntimeStore.getState().startup.services).toMatchObject({
            status: 'idle',
            detail: '',
            updatedAt: null
        });
        expect(useRuntimeStore.getState().transport).toMatchObject({
            websocketConnected: false,
            websocketDomain: ''
        });
        expect(
            useRuntimeStore.getState().runtimeEvents.backendRuntimeTelemetry
        ).toMatchObject({
            count: 0,
            lastPayload: null,
            lastReceivedAt: null
        });
    });
});
