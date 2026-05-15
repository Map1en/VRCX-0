import { beforeEach, describe, expect, it, vi } from 'vitest';

const serviceMocks = vi.hoisted(() => ({
    configRepository: {
        getBool: vi.fn()
    },
    persistence: {
        cancelRealtimeFriendPendingOffline: vi.fn(),
        persistRealtimeFriendAdd: vi.fn(),
        persistRealtimeFriendDelete: vi.fn(),
        persistRealtimeFriendLocationFeed: vi.fn(),
        persistRealtimeFriendOnlineFeed: vi.fn(),
        persistRealtimeFriendUpdateFeed: vi.fn(),
        scheduleRealtimeFriendOfflineFeed: vi.fn()
    },
    recordCurrentUserSnapshot: vi.fn(),
    recordFriendPatch: vi.fn(),
    handleRealtimeNotificationEvent: vi.fn(),
    applyCurrentUserLocationEvent: vi.fn(),
    handleInstanceClosedEvent: vi.fn(),
    persistAvatarWearTransition: vi.fn(),
    refreshCurrentUser: vi.fn(),
    pushSharedFeedNotification: vi.fn()
}));

vi.mock('@/repositories/index.js', () => ({
    configRepository: serviceMocks.configRepository
}));

vi.mock('./avatarWearTimeService.js', () => ({
    buildAvatarWearSnapshotUpdate: vi.fn(({ nextSnapshot }) => ({
        snapshot: nextSnapshot,
        transition: null
    })),
    persistAvatarWearTransition: serviceMocks.persistAvatarWearTransition
}));

vi.mock('./backgroundMaintenanceService.js', () => ({
    refreshCurrentUser: serviceMocks.refreshCurrentUser
}));

vi.mock('./domainIngestionService.js', () => ({
    recordCurrentUserSnapshot: serviceMocks.recordCurrentUserSnapshot,
    recordFriendPatch: serviceMocks.recordFriendPatch
}));

vi.mock('./realtime-presence/currentUserLocationFallback.js', () => ({
    applyCurrentUserLocationEvent: serviceMocks.applyCurrentUserLocationEvent
}));

vi.mock('./realtime-presence/notifications.js', () => ({
    handleInstanceClosedEvent: serviceMocks.handleInstanceClosedEvent
}));

vi.mock('./realtime-presence/persistence.js', () => serviceMocks.persistence);

vi.mock('./vrcNotificationRuntimeService.js', () => ({
    handleRealtimeNotificationEvent:
        serviceMocks.handleRealtimeNotificationEvent
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

describe('realtimePresenceService friend persistence boundary', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        serviceMocks.persistence.cancelRealtimeFriendPendingOffline.mockReturnValue(
            false
        );
        serviceMocks.persistence.persistRealtimeFriendAdd.mockResolvedValue({
            historyCount: 0
        });
        serviceMocks.persistence.persistRealtimeFriendDelete.mockResolvedValue(
            undefined
        );
        serviceMocks.persistence.scheduleRealtimeFriendOfflineFeed.mockReturnValue(
            false
        );
        serviceMocks.handleRealtimeNotificationEvent.mockResolvedValue(true);
        serviceMocks.pushSharedFeedNotification.mockResolvedValue(undefined);

        const { useFriendRosterStore } =
            await import('@/state/friendRosterStore.js');
        const { useRuntimeStore } = await import('@/state/runtimeStore.js');
        const { usePreferencesStore } =
            await import('@/state/preferencesStore.js');
        const { useFeedLiveStore } = await import('@/state/feedLiveStore.js');
        const { useShellStore } = await import('@/state/shellStore.js');

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
        usePreferencesStore.getState().hydratePreferences({
            gameLogDisabled: false
        });
        useFeedLiveStore.getState().resetFeedLive();
        useShellStore.getState().clearAllNotifications();
    });

    it('routes friend-online persistence through the realtime helper', async () => {
        const { useFriendRosterStore } =
            await import('@/state/friendRosterStore.js');
        const { handleRealtimePresenceEvent } =
            await import('./realtimePresenceService.js');

        useFriendRosterStore.getState().setRosterSnapshot({
            currentUserId: 'usr_self',
            friendsById: {
                usr_friend: {
                    id: 'usr_friend',
                    displayName: 'Friend',
                    state: 'offline',
                    stateBucket: 'offline',
                    location: 'offline'
                }
            },
            orderedFriendIds: ['usr_friend'],
            onlineIds: [],
            activeIds: [],
            offlineIds: ['usr_friend']
        });

        await expect(
            handleRealtimePresenceEvent({
                type: 'friend-online',
                content: {
                    userId: 'usr_friend',
                    user: {
                        id: 'usr_friend',
                        displayName: 'Friend',
                        location: 'wrld_1:123'
                    },
                    platform: 'standalonewindows'
                }
            })
        ).resolves.toBe(true);

        expect(
            serviceMocks.persistence.cancelRealtimeFriendPendingOffline
        ).toHaveBeenCalledWith('usr_friend');
        expect(
            serviceMocks.persistence.persistRealtimeFriendOnlineFeed
        ).toHaveBeenCalledWith(
            expect.objectContaining({
                userId: 'usr_friend',
                previous: expect.objectContaining({
                    stateBucket: 'offline'
                }),
                canceledPendingOffline: false
            })
        );
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
    });

    it('routes friend-delete through friend-log helper and removes projection state', async () => {
        const { useFriendRosterStore } =
            await import('@/state/friendRosterStore.js');
        const { useRuntimeStore } = await import('@/state/runtimeStore.js');
        const { useShellStore } = await import('@/state/shellStore.js');
        const { handleRealtimePresenceEvent } =
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

        await expect(
            handleRealtimePresenceEvent({
                type: 'friend-delete',
                content: {
                    userId: 'usr_friend'
                }
            })
        ).resolves.toBe(true);

        expect(
            serviceMocks.persistence.cancelRealtimeFriendPendingOffline
        ).toHaveBeenCalledWith('usr_friend');
        expect(
            serviceMocks.persistence.persistRealtimeFriendDelete
        ).toHaveBeenCalledWith({
            userId: 'usr_friend'
        });
        expect(
            useFriendRosterStore.getState().friendsById.usr_friend
        ).toBeUndefined();
        expect(
            useRuntimeStore.getState().auth.currentUserSnapshot?.friends
        ).toEqual([]);
        expect(useShellStore.getState().notifiedMenus).toContain('friend-log');
    });

    it('keeps notification events on the existing notification path', async () => {
        const { handleRealtimePresenceEvent } =
            await import('./realtimePresenceService.js');

        await expect(
            handleRealtimePresenceEvent({
                type: 'notification',
                content: {
                    id: 'not_1',
                    type: 'friendRequest'
                }
            })
        ).resolves.toBe(true);

        expect(
            serviceMocks.handleRealtimeNotificationEvent
        ).toHaveBeenCalledWith('notification', {
            id: 'not_1',
            type: 'friendRequest'
        });
        expect(
            serviceMocks.persistence.persistRealtimeFriendOnlineFeed
        ).not.toHaveBeenCalled();
        expect(
            serviceMocks.persistence.persistRealtimeFriendDelete
        ).not.toHaveBeenCalled();
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
            serviceMocks.persistence.persistRealtimeFriendOnlineFeed
        ).not.toHaveBeenCalled();
        expect(
            useFriendRosterStore.getState().friendsById.usr_friend.stateBucket
        ).toBe('online');
        expect(useFeedLiveStore.getState().entries[0].entry).toMatchObject({
            type: 'Online',
            userId: 'usr_friend'
        });
        expect(useShellStore.getState().notifiedMenus).toContain('friend-log');
    });
});
