import { beforeEach, describe, expect, it, vi } from 'vitest';

const notificationRepositoryMock = vi.hoisted(() => ({
    queryNotifications: vi.fn(),
    markSeen: vi.fn(),
    markSeenLocalBulk: vi.fn()
}));

vi.mock('@/repositories/notificationPersistenceRepository', () => ({
    default: notificationRepositoryMock
}));

vi.mock('@/services/shellIntegrationService', () => ({
    setTrayIconNotification: vi.fn(() => Promise.resolve())
}));

vi.mock('@/shared/utils/delays', () => ({
    windowDelay: vi.fn(() => Promise.resolve())
}));

import { useRuntimeStore } from './runtimeStore';
import { useShellStore } from './shellStore';
import { useVrcNotificationStore } from './vrcNotificationStore';

describe('vrcNotificationStore', () => {
    beforeEach(() => {
        notificationRepositoryMock.queryNotifications.mockReset();
        notificationRepositoryMock.markSeen.mockReset();
        notificationRepositoryMock.markSeenLocalBulk.mockReset();
        notificationRepositoryMock.markSeen.mockResolvedValue(undefined);
        notificationRepositoryMock.markSeenLocalBulk.mockResolvedValue(
            undefined
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
        expect(notificationRepositoryMock.markSeen).not.toHaveBeenCalled();
        expect(
            notificationRepositoryMock.markSeenLocalBulk
        ).not.toHaveBeenCalled();
    });

    it('keeps system notifications unread after mark-all-seen', async () => {
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

        expect(useVrcNotificationStore.getState().unseenCount).toBe(1);
        expect(useVrcNotificationStore.getState().rows[0]).toMatchObject({
            id: 'notif_system',
            seen: false
        });
        expect(useShellStore.getState().vrcUnseenNotificationCount).toBe(1);
        expect(notificationRepositoryMock.markSeen).not.toHaveBeenCalled();
        expect(
            notificationRepositoryMock.markSeenLocalBulk
        ).not.toHaveBeenCalled();
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
        expect(notificationRepositoryMock.markSeen).toHaveBeenCalledWith({
            userId: 'usr_me',
            id: 'notif_activity',
            version: 2,
            endpoint: 'https://api.example.test/api/1'
        });
        expect(
            notificationRepositoryMock.markSeenLocalBulk
        ).toHaveBeenCalledWith({
            userId: 'usr_me',
            ids: ['notif_activity']
        });
    });
});
