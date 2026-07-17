import { beforeEach, describe, expect, it, vi } from 'vitest';

const serviceMocks = vi.hoisted(() => ({
    configRepository: {
        getString: vi.fn()
    },
    pushSharedFeedNotification: vi.fn(),
    recordCurrentUserSnapshot: vi.fn(),
    recordFriendPatch: vi.fn()
}));

vi.mock('@/repositories/configRepository', () => ({
    default: serviceMocks.configRepository
}));

vi.mock('./domainIngestionService', () => ({
    recordCurrentUserSnapshot: serviceMocks.recordCurrentUserSnapshot,
    recordFriendPatch: serviceMocks.recordFriendPatch
}));

vi.mock('./sharedFeedNotificationService', () => ({
    pushSharedFeedNotification: serviceMocks.pushSharedFeedNotification
}));

vi.mock('./shellIntegrationService', () => ({
    setTrayIconNotification: vi.fn(async () => undefined)
}));

describe('realtimePresenceService projection boundary', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        serviceMocks.configRepository.getString.mockResolvedValue('[]');
        serviceMocks.pushSharedFeedNotification.mockResolvedValue(undefined);

        const { useFriendRosterStore } =
            await import('@/state/friendRosterStore');
        const { useRuntimeStore } = await import('@/state/runtimeStore');
        const { useFeedLiveStore } = await import('@/state/feedLiveStore');
        const { useShellStore } = await import('@/state/shellStore');
        const { useVrcNotificationStore } =
            await import('@/state/vrcNotificationStore');

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

    it('applies runtime friend projection without frontend persistence writes', async () => {
        const { useFeedLiveStore } = await import('@/state/feedLiveStore');
        const { useFriendRosterStore } =
            await import('@/state/friendRosterStore');
        const { useRuntimeStore } = await import('@/state/runtimeStore');
        const { useShellStore } = await import('@/state/shellStore');
        const { handleRealtimeFriendProjection } =
            await import('./realtimePresenceService');

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
        expect(serviceMocks.recordFriendPatch).not.toHaveBeenCalled();
        expect(
            useRuntimeStore.getState().auth.currentUserSnapshot
        ).toMatchObject({
            friends: ['usr_friend'],
            onlineFriends: [],
            activeFriends: [],
            offlineFriends: ['usr_friend']
        });
        expect(useFeedLiveStore.getState().entries[0].entry).toMatchObject({
            type: 'Online',
            userId: 'usr_friend'
        });
        expect(useShellStore.getState().notifiedMenus).toContain('friend-log');
    });

    it('bumps the friend-log revision so the active friend-log page refreshes in place', async () => {
        const { useFriendLogStore } = await import('@/state/friendLogStore');
        const { handleRealtimeFriendProjection } =
            await import('./realtimePresenceService');

        const before = useFriendLogStore.getState().revision;
        handleRealtimeFriendProjection({
            patches: [],
            removals: [],
            feedEntries: [],
            friendLogChanged: true
        });
        expect(useFriendLogStore.getState().revision).toBe(before + 1);

        handleRealtimeFriendProjection({
            patches: [],
            removals: [],
            feedEntries: [],
            friendLogChanged: false
        });
        expect(useFriendLogStore.getState().revision).toBe(before + 1);
    });

    it('applies runtime friend removals only to the roster', async () => {
        const { useFriendRosterStore } =
            await import('@/state/friendRosterStore');
        const { useRuntimeStore } = await import('@/state/runtimeStore');
        const { handleRealtimeFriendProjection } =
            await import('./realtimePresenceService');

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
        ).toEqual(['usr_friend']);
    });

    it('preserves roster bucket for location-only friend projections', async () => {
        const { useFriendRosterStore } =
            await import('@/state/friendRosterStore');
        const { handleRealtimeFriendProjection } =
            await import('./realtimePresenceService');

        useFriendRosterStore.getState().setRosterSnapshot({
            currentUserId: 'usr_self',
            friendsById: {
                usr_friend: {
                    id: 'usr_friend',
                    displayName: 'Friend',
                    state: 'online',
                    stateBucket: 'online',
                    location: 'wrld_old:1'
                }
            },
            orderedFriendIds: ['usr_friend'],
            onlineIds: ['usr_friend'],
            activeIds: [],
            offlineIds: []
        });

        handleRealtimeFriendProjection({
            patches: [
                {
                    userId: 'usr_friend',
                    patch: {
                        id: 'usr_friend',
                        location: 'wrld_new:2'
                    },
                    stateBucket: 'offline',
                    stateBucketAuthority: 'preserve'
                }
            ]
        });

        expect(useFriendRosterStore.getState()).toMatchObject({
            onlineIds: ['usr_friend'],
            offlineIds: [],
            friendsById: {
                usr_friend: {
                    state: 'online',
                    stateBucket: 'online',
                    location: 'wrld_new:2'
                }
            }
        });
    });

    it('applies runtime notification projection and runtime delivery', async () => {
        const { useShellStore } = await import('@/state/shellStore');
        const { useVrcNotificationStore } =
            await import('@/state/vrcNotificationStore');
        const { handleRealtimeNotificationProjection } =
            await import('./realtimePresenceService');

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
    });

    it('uses the merged notification row for v2 update menu decisions', async () => {
        const { useShellStore } = await import('@/state/shellStore');
        const { useVrcNotificationStore } =
            await import('@/state/vrcNotificationStore');
        const { handleRealtimeNotificationProjection } =
            await import('./realtimePresenceService');

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

    it('does not sync roster buckets from complete current-user projection', async () => {
        const { useFriendRosterStore } =
            await import('@/state/friendRosterStore');
        const { useRuntimeStore } = await import('@/state/runtimeStore');
        const { handleRealtimeCurrentUserProjection } =
            await import('./realtimePresenceService');

        useRuntimeStore.getState().setAuthBootstrap({
            currentUserDisplayName: 'Self',
            currentUserSnapshot: {
                id: 'usr_self',
                displayName: 'Self',
                friends: ['usr_friend'],
                onlineFriends: [],
                activeFriends: [],
                offlineFriends: ['usr_friend']
            }
        });
        useFriendRosterStore.getState().applyFriendPatch({
            userId: 'usr_friend',
            patch: {
                id: 'usr_friend',
                displayName: 'Friend',
                state: 'offline'
            },
            stateBucket: 'offline'
        });
        handleRealtimeCurrentUserProjection({
            patch: {
                id: 'usr_self',
                displayName: 'New Self',
                status: 'active',
                friends: ['usr_friend'],
                onlineFriends: ['usr_friend'],
                activeFriends: [],
                offlineFriends: []
            },
            snapshot: {
                id: 'usr_self',
                displayName: 'New Self',
                status: 'active',
                friends: ['usr_friend'],
                onlineFriends: ['usr_friend'],
                activeFriends: [],
                offlineFriends: []
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
        expect(useFriendRosterStore.getState()).toMatchObject({
            onlineIds: [],
            offlineIds: ['usr_friend'],
            friendsById: {
                usr_friend: {
                    stateBucket: 'offline'
                }
            }
        });
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

    it('does not sync roster buckets from partial current-user projection', async () => {
        const { useFriendRosterStore } =
            await import('@/state/friendRosterStore');
        const { useRuntimeStore } = await import('@/state/runtimeStore');
        const { handleRealtimeCurrentUserProjection } =
            await import('./realtimePresenceService');

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
        useFriendRosterStore.getState().applyFriendPatch({
            userId: 'usr_friend',
            patch: {
                id: 'usr_friend',
                displayName: 'Friend',
                state: 'offline'
            },
            stateBucket: 'offline'
        });

        handleRealtimeCurrentUserProjection({
            patch: {
                id: 'usr_self',
                displayName: 'New Self',
                status: 'active'
            },
            snapshot: {
                id: 'usr_self',
                displayName: 'New Self',
                status: 'active',
                friends: ['usr_friend'],
                onlineFriends: ['usr_friend'],
                activeFriends: [],
                offlineFriends: []
            }
        });

        expect(useFriendRosterStore.getState()).toMatchObject({
            onlineIds: [],
            offlineIds: ['usr_friend'],
            friendsById: {
                usr_friend: {
                    stateBucket: 'offline'
                }
            }
        });
        expect(serviceMocks.recordFriendPatch).not.toHaveBeenCalled();
    });

    it('applies Rust current-user location authority patch', async () => {
        const { useRuntimeStore } = await import('@/state/runtimeStore');
        const { handleRealtimeCurrentUserProjection } =
            await import('./realtimePresenceService');

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

    it('applies runtime instance-closed projection', async () => {
        const { useFeedLiveStore } = await import('@/state/feedLiveStore');
        const { useShellStore } = await import('@/state/shellStore');
        const { useVrcNotificationStore } =
            await import('@/state/vrcNotificationStore');
        const { handleRealtimeInstanceClosedProjection } =
            await import('./realtimePresenceService');

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
