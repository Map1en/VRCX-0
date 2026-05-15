import { beforeEach, describe, expect, it, vi } from 'vitest';

const serviceMocks = vi.hoisted(() => ({
    configRepository: {
        getString: vi.fn()
    },
    deliverRuntimeNotification: vi.fn(),
    handleInviteAutomationNotification: vi.fn(),
    pushSharedFeedNotification: vi.fn(),
    recordCurrentUserSnapshot: vi.fn(),
    recordFriendPatch: vi.fn()
}));

vi.mock('@/repositories/index.js', () => ({
    configRepository: serviceMocks.configRepository
}));

vi.mock('./domainIngestionService.js', () => ({
    recordCurrentUserSnapshot: serviceMocks.recordCurrentUserSnapshot,
    recordFriendPatch: serviceMocks.recordFriendPatch
}));

vi.mock('./inviteAutomationService.js', () => ({
    handleInviteAutomationNotification:
        serviceMocks.handleInviteAutomationNotification
}));

vi.mock('./notificationDeliveryService.js', () => ({
    deliverRuntimeNotification: serviceMocks.deliverRuntimeNotification
}));

vi.mock('./sharedFeedFilterService.js', () => ({
    pushSharedFeedNotification: serviceMocks.pushSharedFeedNotification
}));

vi.mock('@/platform/index.js', () => ({
    backend: {
        app: {
            SetTrayIconNotification: vi.fn(async () => undefined)
        }
    }
}));

describe('realtimePresenceService projection boundary', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        serviceMocks.configRepository.getString.mockResolvedValue('[]');
        serviceMocks.deliverRuntimeNotification.mockResolvedValue(undefined);
        serviceMocks.handleInviteAutomationNotification.mockResolvedValue({
            handled: false
        });
        serviceMocks.pushSharedFeedNotification.mockResolvedValue(undefined);

        const { useFriendRosterStore } =
            await import('@/state/friendRosterStore.js');
        const { useRuntimeStore } = await import('@/state/runtimeStore.js');
        const { useFeedLiveStore } = await import('@/state/feedLiveStore.js');
        const { useShellStore } = await import('@/state/shellStore.js');
        const { useVrcNotificationStore } =
            await import('@/state/vrcNotificationStore.js');

        useFriendRosterStore.getState().resetRoster();
        useRuntimeStore.getState().resetRuntimeState();
        useRuntimeStore.getState().setAuthBootstrap({
            currentUserId: 'usr_self',
            currentUserEndpoint: 'https://api.example.test',
            currentUserWebsocket: 'wss://ws.example.test',
            currentUserSnapshot: {
                id: 'usr_self',
                friends: ['usr_friend'],
                onlineFriends: [],
                activeFriends: [],
                offlineFriends: ['usr_friend']
            }
        });
        useFeedLiveStore.getState().resetFeedLive();
        useShellStore.getState().clearAllNotifications();
        useVrcNotificationStore.getState().resetVrcNotificationState();
    });

    it('applies backend friend projection without frontend persistence writes', async () => {
        const { useFeedLiveStore } = await import('@/state/feedLiveStore.js');
        const { useFriendRosterStore } =
            await import('@/state/friendRosterStore.js');
        const { useShellStore } = await import('@/state/shellStore.js');
        const { handleRealtimeFriendProjection } =
            await import('./realtimePresenceService.js');

        handleRealtimeFriendProjection({
            patches: [
                {
                    userId: 'usr_friend',
                    patch: {
                        id: 'usr_friend',
                        displayName: 'Friend',
                        state: 'online',
                        location: 'wrld_1:123'
                    },
                    stateBucket: 'online'
                }
            ],
            removals: [],
            feedEntries: [
                {
                    created_at: '2026-05-15T00:00:00Z',
                    type: 'Online',
                    userId: 'usr_friend',
                    displayName: 'Friend',
                    location: 'wrld_1:123'
                }
            ],
            friendLogChanged: true
        });

        expect(
            useFriendRosterStore.getState().friendsById.usr_friend.stateBucket
        ).toBe('online');
        expect(serviceMocks.recordFriendPatch).toHaveBeenCalledWith(
            expect.objectContaining({
                endpoint: 'https://api.example.test',
                userId: 'usr_friend',
                stateBucket: 'online'
            })
        );
        expect(useFeedLiveStore.getState().entries[0].entry).toMatchObject({
            type: 'Online',
            userId: 'usr_friend'
        });
        expect(useShellStore.getState().notifiedMenus).toContain('friend-log');
    });

    it('applies backend friend removals to roster and current user snapshot', async () => {
        const { useFriendRosterStore } =
            await import('@/state/friendRosterStore.js');
        const { useRuntimeStore } = await import('@/state/runtimeStore.js');
        const { handleRealtimeFriendProjection } =
            await import('./realtimePresenceService.js');

        useFriendRosterStore.getState().setRosterSnapshot({
            currentUserId: 'usr_self',
            friendsById: {
                usr_friend: {
                    id: 'usr_friend',
                    displayName: 'Friend',
                    state: 'online',
                    stateBucket: 'online'
                }
            },
            orderedFriendIds: ['usr_friend'],
            onlineIds: ['usr_friend'],
            activeIds: [],
            offlineIds: []
        });

        handleRealtimeFriendProjection({
            removals: ['usr_friend'],
            patches: [],
            feedEntries: [],
            friendLogChanged: true
        });

        expect(
            useFriendRosterStore.getState().friendsById.usr_friend
        ).toBeUndefined();
        expect(
            useRuntimeStore.getState().auth.currentUserSnapshot?.friends
        ).toEqual([]);
    });

    it('applies backend notification projection and runtime delivery', async () => {
        const { useShellStore } = await import('@/state/shellStore.js');
        const { useVrcNotificationStore } =
            await import('@/state/vrcNotificationStore.js');
        const { handleRealtimeNotificationProjection } =
            await import('./realtimePresenceService.js');

        await handleRealtimeNotificationProjection({
            upserts: [
                {
                    notification: {
                        id: 'not_1',
                        version: 2,
                        type: 'invite',
                        seen: false,
                        createdAt: '2026-05-15T00:00:00Z'
                    },
                    notifyMenu: true,
                    deliverRuntime: true,
                    runAutomation: true
                }
            ],
            expiredIds: [],
            seenIds: []
        });

        expect(useVrcNotificationStore.getState().rows[0]).toMatchObject({
            id: 'not_1',
            type: 'invite'
        });
        expect(useShellStore.getState().notifiedMenus).toContain(
            'notification'
        );
        expect(
            serviceMocks.handleInviteAutomationNotification
        ).toHaveBeenCalled();
        expect(serviceMocks.deliverRuntimeNotification).toHaveBeenCalled();
    });

    it('uses the merged notification row for v2 update menu decisions', async () => {
        const { useShellStore } = await import('@/state/shellStore.js');
        const { useVrcNotificationStore } =
            await import('@/state/vrcNotificationStore.js');
        const { handleRealtimeNotificationProjection } =
            await import('./realtimePresenceService.js');

        useVrcNotificationStore.getState().upsertNotification({
            id: 'not_1',
            version: 2,
            type: 'invite',
            seen: false,
            createdAt: '2026-05-15T00:00:00Z'
        });
        useShellStore.getState().clearAllNotifications();

        await handleRealtimeNotificationProjection({
            upserts: [
                {
                    notification: {
                        id: 'not_1',
                        version: 2,
                        message: 'Updated'
                    },
                    notifyMenu: true,
                    deliverRuntime: false,
                    runAutomation: false
                }
            ],
            expiredIds: [],
            seenIds: []
        });

        expect(useVrcNotificationStore.getState().rows[0]).toMatchObject({
            id: 'not_1',
            seen: false,
            message: 'Updated'
        });
        expect(useShellStore.getState().notifiedMenus).toContain(
            'notification'
        );
    });

    it('applies backend current-user projection', async () => {
        const { useRuntimeStore } = await import('@/state/runtimeStore.js');
        const { handleRealtimeCurrentUserProjection } =
            await import('./realtimePresenceService.js');

        useRuntimeStore.getState().setAuthBootstrap({
            currentUserDisplayName: 'Self',
            currentUserSnapshot: {
                id: 'usr_self',
                displayName: 'Self',
                friends: ['usr_friend'],
                onlineFriends: ['usr_friend'],
                activeFriends: [],
                offlineFriends: []
            }
        });
        handleRealtimeCurrentUserProjection({
            snapshot: {
                id: 'usr_self',
                displayName: 'New Self',
                status: 'active',
                friends: []
            },
            gameStatePatch: {
                currentLocation: 'wrld_1:123',
                currentWorldId: 'wrld_1'
            }
        });

        expect(
            useRuntimeStore.getState().auth.currentUserSnapshot?.status
        ).toBe('active');
        expect(
            useRuntimeStore.getState().auth.currentUserSnapshot?.friends
        ).toEqual(['usr_friend']);
        expect(useRuntimeStore.getState().auth.currentUserDisplayName).toBe(
            'New Self'
        );
        expect(useRuntimeStore.getState().gameState.currentLocation).toBe(
            'wrld_1:123'
        );
        expect(serviceMocks.recordCurrentUserSnapshot).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 'usr_self',
                status: 'active'
            }),
            expect.objectContaining({
                source: 'currentUser'
            })
        );
    });

    it('applies Rust current-user location authority patch', async () => {
        const { useRuntimeStore } = await import('@/state/runtimeStore.js');
        const { handleRealtimeCurrentUserProjection } =
            await import('./realtimePresenceService.js');

        handleRealtimeCurrentUserProjection({
            snapshot: {
                id: 'usr_self',
                location: 'private:private',
                worldId: 'private'
            },
            patch: {
                id: 'usr_self',
                location: 'wrld_game:456',
                worldId: 'wrld_game',
                worldName: 'Game World'
            }
        });

        expect(
            useRuntimeStore.getState().auth.currentUserSnapshot?.location
        ).toBe('wrld_game:456');
        expect(
            useRuntimeStore.getState().auth.currentUserSnapshot?.worldName
        ).toBe('Game World');
    });

    it('applies backend instance-closed projection', async () => {
        const { useFeedLiveStore } = await import('@/state/feedLiveStore.js');
        const { useShellStore } = await import('@/state/shellStore.js');
        const { useVrcNotificationStore } =
            await import('@/state/vrcNotificationStore.js');
        const { handleRealtimeInstanceClosedProjection } =
            await import('./realtimePresenceService.js');

        await handleRealtimeInstanceClosedProjection({
            notification: {
                id: 'instance.closed:wrld_1:1',
                type: 'instance.closed',
                location: 'wrld_1:1'
            },
            feedEntry: {
                id: 'instance.closed:wrld_1:1',
                type: 'instance.closed'
            }
        });

        expect(useVrcNotificationStore.getState().rows[0]).toMatchObject({
            id: 'instance.closed:wrld_1:1'
        });
        expect(useFeedLiveStore.getState().entries[0].entry).toMatchObject({
            type: 'instance.closed'
        });
        expect(useShellStore.getState().notifiedMenus).toContain(
            'notification'
        );
    });
});
