import { beforeEach, describe, expect, it, vi } from 'vitest';

const notificationRepositoryMock = vi.hoisted(() => ({
    queryNotifications: vi.fn(),
    markSeen: vi.fn()
}));

const commandMocks = vi.hoisted(() => ({
    markSeenBatch: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appNotificationMarkSeenBatch: commandMocks.markSeenBatch
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
        useRuntimeStore.getState().resetRuntimeState();
        useRuntimeStore.getState().setAuthBootstrap({
            currentUserId: 'usr_me',
            currentUserEndpoint: 'https://api.example.test/api/1'
        });
        useVrcNotificationStore.getState().resetVrcNotificationState();
    });

    it('keeps incoming v1 friend requests action-required after mark-all-seen', async () => {
        const friendRequest = {
            id: 'notif_friend_request',
            type: 'friendRequest',
            version: 1,
            seen: false,
            created_at: new Date().toISOString()
        };

        useVrcNotificationStore.getState().upsertNotification(friendRequest);

        await useVrcNotificationStore.getState().markAllSeen();

        expect(useVrcNotificationStore.getState().unseenCount).toBe(1);
        expect(useVrcNotificationStore.getState().rows[0]).toMatchObject({
            id: 'notif_friend_request',
            seen: false
        });
        expect(useShellStore.getState().vrcUnseenNotificationCount).toBe(1);
        expect(commandMocks.markSeenBatch).not.toHaveBeenCalled();
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

    it('marks system notifications locally and activity notifications remotely in one batch', async () => {
        const systemNotification = {
            id: 'notif_group_announcement',
            type: 'group.announcement',
            version: 2,
            seen: false,
            created_at: new Date().toISOString()
        };
        const activityNotification = {
            id: 'notif_activity',
            type: 'inviteResponse',
            version: 2,
            seen: false,
            created_at: new Date().toISOString()
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
