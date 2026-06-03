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

import { useRuntimeStore } from './runtimeStore';
import { useShellStore } from './shellStore';
import { useVrcNotificationStore } from './vrcNotificationStore';

describe('vrcNotificationStore', () => {
    beforeEach(() => {
        notificationRepositoryMock.queryNotifications.mockReset();
        notificationRepositoryMock.markSeen.mockReset();
        notificationRepositoryMock.markSeenLocalBulk.mockReset();
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
        expect(notificationRepositoryMock.markSeenLocalBulk).not.toHaveBeenCalled();
    });
});
