import { beforeEach, describe, expect, it, vi } from 'vitest';

const notificationRepositoryMock = vi.hoisted(() => ({
    queryNotifications: vi.fn(),
    markSeen: vi.fn()
}));

const commandMocks = vi.hoisted(() => ({
    markSeenBatch: vi.fn(),
    sync: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appNotificationMarkSeenBatch: commandMocks.markSeenBatch,
        appNotificationSync: commandMocks.sync
    }
}));

vi.mock('@/repositories/notificationPersistenceRepository', () => ({
    default: notificationRepositoryMock
}));

vi.mock('@/services/shellIntegrationService', () => ({
    setTrayIconNotification: vi.fn(() => Promise.resolve())
}));

import { useRuntimeStore } from './runtimeStore';
import { useShellStore } from './shellStore';
import { useVrcNotificationStore } from './vrcNotificationStore';

describe('vrcNotificationStore', () => {
    beforeEach(() => {
        notificationRepositoryMock.queryNotifications.mockReset();
        notificationRepositoryMock.markSeen.mockReset();
        commandMocks.markSeenBatch.mockReset();
        commandMocks.sync.mockReset();
        notificationRepositoryMock.markSeen.mockResolvedValue(undefined);
        commandMocks.markSeenBatch.mockImplementation(
            async ({ items }: { items: Array<{ id: string }> }) => ({
                total: items.length,
                succeeded: items.length,
                failed: 0,
                items: items.map((item) => ({
                    id: item.id,
                    state: 'succeeded',
                    attempts: 1,
                    message: ''
                })),
                lastError: null
            })
        );
        commandMocks.sync.mockResolvedValue({
            v1Count: 0,
            v2Count: 0,
            hiddenFriendRequestCount: 0,
            truncated: false
        });
        useRuntimeStore.getState().resetRuntimeState();
        useRuntimeStore.getState().setAuthBootstrap({
            currentUserId: 'usr_me',
            currentUserEndpoint: 'https://api.example.test/api/1'
        });
        useVrcNotificationStore.getState().resetVrcNotificationState();
    });

    it('expires old v1 friend requests after mark-all-seen', async () => {
        const friendRequest = {
            id: 'notif_friend_request',
            type: 'friendRequest',
            version: 1,
            seen: false,
            created_at: '2020-01-01T00:00:00.000Z'
        };
        notificationRepositoryMock.queryNotifications.mockResolvedValue([
            { ...friendRequest, expired: true }
        ]);

        useVrcNotificationStore.getState().upsertNotification(friendRequest);

        await useVrcNotificationStore.getState().markAllSeen();

        expect(useVrcNotificationStore.getState().unseenCount).toBe(0);
        expect(useVrcNotificationStore.getState().rows[0]).toMatchObject({
            id: 'notif_friend_request',
            expired: true
        });
        expect(useShellStore.getState().vrcUnseenNotificationCount).toBe(0);
        expect(commandMocks.markSeenBatch).toHaveBeenCalledWith({
            items: [
                {
                    id: 'notif_friend_request',
                    version: 1,
                    location: 'remote'
                }
            ]
        });
    });

    it('expires a v1 friend request after marking it seen', async () => {
        const friendRequest = {
            id: 'notif_friend_request',
            type: 'friendRequest',
            version: 1,
            seen: false,
            created_at: '2020-01-01T00:00:00.000Z'
        };
        notificationRepositoryMock.queryNotifications.mockResolvedValue([
            { ...friendRequest, expired: true }
        ]);
        useVrcNotificationStore.getState().upsertNotification(friendRequest);

        await useVrcNotificationStore
            .getState()
            .markNotificationSeen(friendRequest);

        expect(notificationRepositoryMock.markSeen).toHaveBeenCalledWith({
            userId: 'usr_me',
            id: 'notif_friend_request',
            version: 1
        });
        expect(useVrcNotificationStore.getState().unseenCount).toBe(0);
        expect(useVrcNotificationStore.getState().rows[0]).toMatchObject({
            id: 'notif_friend_request',
            expired: true
        });
    });

    it('keeps a v1 friend request pending when mark-all-seen fails', async () => {
        const friendRequest = {
            id: 'notif_friend_request',
            type: 'friendRequest',
            version: 1,
            seen: false,
            created_at: '2020-01-01T00:00:00.000Z'
        };
        commandMocks.markSeenBatch.mockResolvedValue({
            total: 1,
            succeeded: 0,
            failed: 1,
            items: [
                {
                    id: friendRequest.id,
                    state: 'failed',
                    attempts: 4,
                    message: 'Too many requests'
                }
            ],
            lastError: 'Too many requests'
        });
        notificationRepositoryMock.queryNotifications.mockResolvedValue([
            friendRequest
        ]);
        useVrcNotificationStore.getState().upsertNotification(friendRequest);

        await expect(
            useVrcNotificationStore.getState().markAllSeen()
        ).rejects.toThrow('Failed to mark 1 notification(s) as seen.');

        expect(commandMocks.markSeenBatch).toHaveBeenCalledWith({
            items: [
                {
                    id: friendRequest.id,
                    version: 1,
                    location: 'remote'
                }
            ]
        });
        expect(useVrcNotificationStore.getState().rows[0]).toMatchObject({
            id: friendRequest.id,
            seen: false
        });
        expect(useVrcNotificationStore.getState().unseenCount).toBe(1);
        expect(useShellStore.getState().vrcUnseenNotificationCount).toBe(1);
    });

    it('excludes expired friend requests from the notification center', () => {
        useVrcNotificationStore.getState().upsertNotification({
            id: 'notif_expired_friend_request',
            type: 'friendRequest',
            version: 1,
            seen: false,
            expired: true,
            created_at: '2020-01-01T00:00:00.000Z'
        });

        const state = useVrcNotificationStore.getState();
        expect(state.unseenCount).toBe(0);
        expect(state.categories.friend).toEqual({
            unseen: [],
            recent: []
        });
    });

    it('syncs remote notifications before loading persisted rows', async () => {
        notificationRepositoryMock.queryNotifications.mockResolvedValue([
            {
                id: 'notif_offline',
                type: 'invite',
                version: 1,
                seen: false,
                created_at: new Date().toISOString()
            }
        ]);

        await useVrcNotificationStore.getState().refreshForCurrentUser();

        expect(commandMocks.sync).toHaveBeenCalledTimes(1);
        expect(commandMocks.sync.mock.invocationCallOrder[0]).toBeLessThan(
            notificationRepositoryMock.queryNotifications.mock
                .invocationCallOrder[0]
        );
        expect(useVrcNotificationStore.getState().rows[0]?.id).toBe(
            'notif_offline'
        );
    });

    it('keeps local rows available when remote sync fails', async () => {
        commandMocks.sync.mockRejectedValue(new Error('Network unavailable'));
        notificationRepositoryMock.queryNotifications.mockResolvedValue([
            {
                id: 'notif_local',
                type: 'invite',
                version: 1,
                seen: false,
                created_at: new Date().toISOString()
            }
        ]);

        await expect(
            useVrcNotificationStore.getState().refreshForCurrentUser()
        ).rejects.toThrow('Network unavailable');

        expect(useVrcNotificationStore.getState().rows[0]?.id).toBe(
            'notif_local'
        );
        expect(useVrcNotificationStore.getState()).toMatchObject({
            loadStatus: 'error',
            detail: 'Network unavailable'
        });
    });

    it('marks system v2 notifications read after mark-all-seen', async () => {
        const systemNotification = {
            id: 'notif_system',
            type: 'event.announcement',
            version: 2,
            seen: false,
            created_at: new Date().toISOString()
        };
        notificationRepositoryMock.queryNotifications.mockResolvedValue([
            {
                ...systemNotification,
                seen: true
            }
        ]);

        useVrcNotificationStore
            .getState()
            .upsertNotification(systemNotification);

        await useVrcNotificationStore.getState().markAllSeen();

        expect(useVrcNotificationStore.getState().unseenCount).toBe(0);
        expect(useVrcNotificationStore.getState().rows[0]).toMatchObject({
            id: 'notif_system',
            seen: true
        });
        expect(useShellStore.getState().vrcUnseenNotificationCount).toBe(0);
        expect(commandMocks.markSeenBatch).toHaveBeenCalledWith({
            items: [
                {
                    id: 'notif_system',
                    version: 2,
                    location: 'local'
                }
            ]
        });
    });

    it('marks non-system v2 notifications read after mark-all-seen', async () => {
        const activityNotification = {
            id: 'notif_activity',
            type: 'inviteResponse',
            version: 2,
            seen: false,
            created_at: new Date().toISOString()
        };
        notificationRepositoryMock.queryNotifications.mockResolvedValue([
            {
                ...activityNotification,
                seen: true
            }
        ]);

        useVrcNotificationStore
            .getState()
            .upsertNotification(activityNotification);

        await useVrcNotificationStore.getState().markAllSeen();

        expect(useVrcNotificationStore.getState().unseenCount).toBe(0);
        expect(useVrcNotificationStore.getState().rows[0]).toMatchObject({
            id: 'notif_activity',
            seen: true
        });
        expect(useShellStore.getState().vrcUnseenNotificationCount).toBe(0);
        expect(commandMocks.markSeenBatch).toHaveBeenCalledWith({
            items: [
                {
                    id: 'notif_activity',
                    version: 2,
                    location: 'remote'
                }
            ]
        });
    });

    it('clears only the notification menu marker after mark-all-seen succeeds', async () => {
        const notification = {
            id: 'notif_menu_marker',
            type: 'invite',
            version: 2,
            seen: false,
            created_at: new Date().toISOString()
        };
        notificationRepositoryMock.queryNotifications.mockResolvedValue([
            { ...notification, seen: true }
        ]);
        useShellStore.setState({
            notifiedMenus: ['notification', 'friend-log']
        });
        useVrcNotificationStore.getState().upsertNotification(notification);

        await useVrcNotificationStore.getState().markAllSeen();

        expect(useShellStore.getState().notifiedMenus).toEqual(['friend-log']);
    });

    it('continues through hidden unread pages and keeps every batch within the backend limit', async () => {
        const firstPage = Array.from({ length: 1_001 }, (_, index) => ({
            id: `notif_page_one_${index}`,
            type: 'invite',
            version: 2,
            seen: false,
            created_at: new Date().toISOString()
        }));
        const secondPage = {
            id: 'notif_page_two',
            type: 'invite',
            version: 2,
            seen: false,
            created_at: new Date().toISOString()
        };
        notificationRepositoryMock.queryNotifications
            .mockResolvedValueOnce([secondPage])
            .mockResolvedValueOnce([{ ...secondPage, seen: true }]);
        useVrcNotificationStore.setState({
            ...useVrcNotificationStore.getState(),
            rows: firstPage,
            unseenCount: firstPage.length
        });

        await useVrcNotificationStore.getState().markAllSeen();

        expect(commandMocks.markSeenBatch).toHaveBeenCalledTimes(3);
        expect(
            commandMocks.markSeenBatch.mock.calls.map(
                ([input]) => input.items.length
            )
        ).toEqual([1_000, 1, 1]);
        expect(useVrcNotificationStore.getState().unseenCount).toBe(0);
    });

    it('marks system notifications locally and activity notifications remotely in one batch', async () => {
        const systemNotification = {
            id: 'notif_group_announcement',
            type: 'group.announcement',
            version: 2,
            seen: false,
            created_at: '2020-01-01T00:00:00.000Z'
        };
        const activityNotification = {
            id: 'notif_activity',
            type: 'inviteResponse',
            version: 2,
            seen: false,
            created_at: '2020-01-01T00:00:00.000Z'
        };
        notificationRepositoryMock.queryNotifications.mockResolvedValue([
            { ...systemNotification, seen: true },
            { ...activityNotification, seen: true }
        ]);

        useVrcNotificationStore
            .getState()
            .upsertNotification(systemNotification);
        useVrcNotificationStore
            .getState()
            .upsertNotification(activityNotification);

        await useVrcNotificationStore.getState().markAllSeen();

        expect(useVrcNotificationStore.getState().unseenCount).toBe(0);
        expect(useShellStore.getState().vrcUnseenNotificationCount).toBe(0);
        expect(commandMocks.markSeenBatch).toHaveBeenCalledWith({
            items: [
                {
                    id: 'notif_group_announcement',
                    version: 2,
                    location: 'local'
                },
                {
                    id: 'notif_activity',
                    version: 2,
                    location: 'remote'
                }
            ]
        });
    });

    it('keeps notifications unread and throws when the server call fails', async () => {
        const activityNotification = {
            id: 'notif_failing',
            type: 'inviteResponse',
            version: 2,
            seen: false,
            created_at: new Date().toISOString()
        };
        commandMocks.markSeenBatch.mockResolvedValue({
            total: 1,
            succeeded: 0,
            failed: 1,
            items: [
                {
                    id: 'notif_failing',
                    state: 'failed',
                    attempts: 4,
                    message: 'Too many requests'
                }
            ],
            lastError: 'Too many requests'
        });
        notificationRepositoryMock.queryNotifications.mockResolvedValue([
            activityNotification
        ]);

        useVrcNotificationStore
            .getState()
            .upsertNotification(activityNotification);
        useShellStore.setState({ notifiedMenus: ['notification'] });

        await expect(
            useVrcNotificationStore.getState().markAllSeen()
        ).rejects.toThrow('Failed to mark 1 notification(s) as seen.');

        expect(commandMocks.markSeenBatch).toHaveBeenCalledTimes(1);
        expect(useVrcNotificationStore.getState().unseenCount).toBe(1);
        expect(useVrcNotificationStore.getState().rows[0]).toMatchObject({
            id: 'notif_failing',
            seen: false
        });
        expect(useShellStore.getState().vrcUnseenNotificationCount).toBe(1);
        expect(useShellStore.getState().notifiedMenus).toEqual([
            'notification'
        ]);
    });

    it('reloads the persisted unread state when the batch command rejects', async () => {
        const notification = {
            id: 'notif_transport_failure',
            type: 'inviteResponse',
            version: 2,
            seen: false,
            created_at: new Date().toISOString()
        };
        commandMocks.markSeenBatch.mockRejectedValue(new Error('IPC failed'));
        notificationRepositoryMock.queryNotifications.mockResolvedValue([
            notification
        ]);
        useVrcNotificationStore.getState().upsertNotification(notification);

        await expect(
            useVrcNotificationStore.getState().markAllSeen()
        ).rejects.toThrow('IPC failed');

        expect(
            notificationRepositoryMock.queryNotifications
        ).toHaveBeenCalled();
        expect(useVrcNotificationStore.getState().rows[0]).toMatchObject({
            id: notification.id,
            seen: false
        });
        expect(useVrcNotificationStore.getState().unseenCount).toBe(1);
    });
});
