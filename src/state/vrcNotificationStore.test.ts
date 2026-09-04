import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { NotificationRow } from '@/repositories/notificationPersistenceRepository';

type Deferred<T> = {
    promise: Promise<T>;
    resolve(value: T): void;
    reject(reason?: unknown): void;
};

function createDeferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

const notificationRepositoryMock = vi.hoisted(() => ({
    queryNotifications: vi.fn()
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
    setTrayIconNotification: vi.fn(() => Promise.resolve()),
    setTaskbarOverlayNotification: vi.fn(() => Promise.resolve())
}));

import { useRuntimeStore } from './runtimeStore';
import { useShellStore } from './shellStore';
import { useVrcNotificationStore } from './vrcNotificationStore';

describe('vrcNotificationStore', () => {
    beforeEach(() => {
        notificationRepositoryMock.queryNotifications.mockReset();
        commandMocks.markSeenBatch.mockReset();
        commandMocks.sync.mockReset();
        commandMocks.markSeenBatch.mockImplementation(
            async ({
                items
            }: {
                items: Array<{ id: string; version: number }>;
            }) => ({
                total: items.length,
                succeeded: items.length,
                failed: 0,
                items: items.map((item) => ({
                    id: item.id,
                    state: 'succeeded',
                    effect: 'seen',
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

    it('caps live upserts so a long session cannot grow rows without bound', () => {
        const store = useVrcNotificationStore.getState();
        for (let index = 0; index < 2050; index += 1) {
            store.upsertNotification({
                id: `notif_${index}`,
                type: 'inviteResponse',
                version: 2,
                seen: true,
                created_at: new Date(1700000000000 + index).toISOString()
            });
        }

        const { rows } = useVrcNotificationStore.getState();
        expect(rows).toHaveLength(2000);
        expect(rows[0].id).toBe('notif_2049');
        expect(rows.some((row) => row.id === 'notif_0')).toBe(false);
    });

    it('keeps an upserted notification even when it sorts past the cap', () => {
        const store = useVrcNotificationStore.getState();
        for (let index = 0; index < 2000; index += 1) {
            store.upsertNotification({
                id: `notif_${index}`,
                type: 'inviteResponse',
                version: 2,
                seen: true,
                created_at: new Date(1700000000000 + index).toISOString()
            });
        }
        expect(useVrcNotificationStore.getState().rows).toHaveLength(2000);

        store.upsertNotification({
            id: 'notif_backfill',
            type: 'inviteResponse',
            version: 2,
            seen: true
        });

        const { rows } = useVrcNotificationStore.getState();
        expect(rows).toHaveLength(2000);
        expect(rows.some((row) => row.id === 'notif_backfill')).toBe(true);
        expect(rows.some((row) => row.id === 'notif_0')).toBe(false);
    });

    it('never truncates a list that was loaded from the database', async () => {
        const loaded = Array.from({ length: 2400 }, (_, index) => ({
            id: `notif_loaded_${index}`,
            type: 'inviteResponse',
            version: 2,
            seen: true,
            created_at: new Date(1700000000000 + index).toISOString()
        }));
        notificationRepositoryMock.queryNotifications.mockResolvedValue(loaded);

        await useVrcNotificationStore.getState().loadForCurrentUser();
        expect(useVrcNotificationStore.getState().rows).toHaveLength(2400);

        useVrcNotificationStore.getState().upsertNotification({
            id: 'notif_live',
            type: 'inviteResponse',
            version: 2,
            seen: true,
            created_at: new Date(1800000000000).toISOString()
        });

        const { rows } = useVrcNotificationStore.getState();
        expect(rows).toHaveLength(2400);
        expect(rows[0].id).toBe('notif_live');
    });

    it('ignores a previous account load that finishes after the new account', async () => {
        const previousLoad = createDeferred<NotificationRow[]>();
        notificationRepositoryMock.queryNotifications
            .mockReturnValueOnce(previousLoad.promise)
            .mockResolvedValueOnce([
                {
                    id: 'notif_current_account',
                    type: 'inviteResponse',
                    version: 2,
                    seen: false,
                    created_at: '2026-08-16T01:00:00.000Z'
                }
            ]);

        const previousLoadPromise = useVrcNotificationStore
            .getState()
            .loadForCurrentUser();
        useVrcNotificationStore.getState().resetVrcNotificationState();
        useRuntimeStore.getState().setAuthBootstrap({
            currentUserId: 'usr_other',
            currentUserEndpoint: 'https://api.example.test/api/1'
        });
        await useVrcNotificationStore.getState().loadForCurrentUser();

        previousLoad.resolve([
            {
                id: 'notif_previous_account',
                type: 'inviteResponse',
                version: 2,
                seen: true,
                created_at: '2026-08-16T02:00:00.000Z'
            }
        ]);
        await previousLoadPromise;

        expect(useVrcNotificationStore.getState()).toMatchObject({
            rows: [expect.objectContaining({ id: 'notif_current_account' })],
            unseenCount: 1,
            loadStatus: 'ready'
        });
        expect(
            notificationRepositoryMock.queryNotifications
        ).toHaveBeenCalledWith({ userId: 'usr_me' });
        expect(
            notificationRepositoryMock.queryNotifications
        ).toHaveBeenCalledWith({ userId: 'usr_other' });
    });

    it('preserves a realtime notification received while persisted rows load', async () => {
        const persistedRows = createDeferred<NotificationRow[]>();
        notificationRepositoryMock.queryNotifications.mockReturnValueOnce(
            persistedRows.promise
        );
        const load = useVrcNotificationStore.getState().loadForCurrentUser();
        useVrcNotificationStore.getState().upsertNotification({
            id: 'notif_live',
            type: 'invite',
            version: 2,
            seen: false,
            created_at: '2026-09-01T00:01:00.000Z',
            message: 'Live update'
        });

        persistedRows.resolve([
            {
                id: 'notif_live',
                type: 'invite',
                version: 2,
                seen: true,
                created_at: '2026-09-01T00:00:30.000Z',
                senderUsername: 'Persisted Sender'
            },
            {
                id: 'notif_persisted',
                type: 'friendRequest',
                version: 1,
                seen: false,
                created_at: '2026-09-01T00:00:00.000Z'
            }
        ]);
        await load;

        expect(useVrcNotificationStore.getState()).toMatchObject({
            rows: [
                expect.objectContaining({
                    id: 'notif_live',
                    seen: false,
                    message: 'Live update',
                    senderUsername: 'Persisted Sender'
                }),
                expect.objectContaining({ id: 'notif_persisted' })
            ],
            unseenCount: 2,
            loadStatus: 'ready'
        });
    });

    it('preserves a realtime notification when the concurrent persisted load fails', async () => {
        const persistedRows = createDeferred<NotificationRow[]>();
        notificationRepositoryMock.queryNotifications.mockReturnValueOnce(
            persistedRows.promise
        );
        const load = useVrcNotificationStore.getState().loadForCurrentUser();
        useVrcNotificationStore.getState().upsertNotification({
            id: 'notif_live',
            type: 'invite',
            version: 2,
            seen: false,
            created_at: '2026-09-01T00:01:00.000Z'
        });

        persistedRows.reject(new Error('query failed'));
        await expect(load).rejects.toThrow('query failed');

        expect(useVrcNotificationStore.getState()).toMatchObject({
            rows: [expect.objectContaining({ id: 'notif_live' })],
            unseenCount: 1,
            loadStatus: 'error',
            detail: 'query failed'
        });
    });

    it('ignores a refresh error from a previous account', async () => {
        const previousSync = createDeferred<{
            v1Count: number;
            v2Count: number;
            hiddenFriendRequestCount: number;
            truncated: boolean;
        }>();
        commandMocks.sync.mockReturnValueOnce(previousSync.promise);

        const previousRefreshPromise = useVrcNotificationStore
            .getState()
            .refreshForCurrentUser();
        useVrcNotificationStore.getState().resetVrcNotificationState();
        useRuntimeStore.getState().setAuthBootstrap({
            currentUserId: 'usr_other',
            currentUserEndpoint: 'https://api.example.test/api/1'
        });
        useVrcNotificationStore.getState().upsertNotification({
            id: 'notif_current_account',
            type: 'inviteResponse',
            version: 2,
            seen: false,
            created_at: '2026-08-16T02:00:00.000Z'
        });

        previousSync.reject(new Error('Previous account sync failed'));
        await expect(previousRefreshPromise).resolves.toEqual([]);

        expect(useVrcNotificationStore.getState()).toMatchObject({
            rows: [expect.objectContaining({ id: 'notif_current_account' })],
            unseenCount: 1,
            loadStatus: 'idle',
            detail: ''
        });
        expect(
            notificationRepositoryMock.queryNotifications
        ).not.toHaveBeenCalled();
    });

    it('marks old v1 friend requests seen after mark-all-seen', async () => {
        const friendRequest = {
            id: 'notif_friend_request',
            type: 'friendRequest',
            version: 1,
            seen: false,
            created_at: '2020-01-01T00:00:00.000Z'
        };
        useVrcNotificationStore.getState().upsertNotification(friendRequest);

        await useVrcNotificationStore.getState().markAllSeen();

        expect(useVrcNotificationStore.getState().unseenCount).toBe(0);
        expect(useVrcNotificationStore.getState().rows[0]).toMatchObject({
            id: 'notif_friend_request',
            seen: true
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
        expect(
            notificationRepositoryMock.queryNotifications
        ).not.toHaveBeenCalled();
    });

    it('marks a v1 friend request seen', async () => {
        const friendRequest = {
            id: 'notif_friend_request',
            type: 'friendRequest',
            version: 1,
            seen: false,
            created_at: '2020-01-01T00:00:00.000Z'
        };
        useVrcNotificationStore.getState().upsertNotification(friendRequest);

        await useVrcNotificationStore
            .getState()
            .markNotificationSeen(friendRequest);

        expect(commandMocks.markSeenBatch).toHaveBeenCalledWith({
            items: [
                {
                    id: 'notif_friend_request',
                    version: 1,
                    location: 'remote'
                }
            ]
        });
        expect(useVrcNotificationStore.getState().unseenCount).toBe(0);
        expect(useVrcNotificationStore.getState().rows[0]).toMatchObject({
            id: 'notif_friend_request',
            seen: true
        });
        expect(
            notificationRepositoryMock.queryNotifications
        ).not.toHaveBeenCalled();
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
                    effect: null,
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

    it('reconciles partial failures without overriding persisted v1 seen state', async () => {
        const friendRequest = {
            id: 'notif_friend_request',
            type: 'friendRequest',
            version: 1,
            seen: false,
            created_at: '2020-01-01T00:00:00.000Z'
        };
        const failedNotification = {
            id: 'notif_failed',
            type: 'inviteResponse',
            version: 2,
            seen: false,
            created_at: '2020-01-01T00:00:01.000Z'
        };
        commandMocks.markSeenBatch.mockResolvedValue({
            total: 2,
            succeeded: 1,
            failed: 1,
            items: [
                {
                    id: friendRequest.id,
                    state: 'succeeded',
                    effect: 'seen',
                    attempts: 1,
                    message: ''
                },
                {
                    id: failedNotification.id,
                    state: 'failed',
                    effect: null,
                    attempts: 4,
                    message: 'Too many requests'
                }
            ],
            lastError: 'Too many requests'
        });
        notificationRepositoryMock.queryNotifications.mockResolvedValue([
            { ...friendRequest, seen: true },
            failedNotification
        ]);
        useVrcNotificationStore.getState().upsertNotification(friendRequest);
        useVrcNotificationStore
            .getState()
            .upsertNotification(failedNotification);

        await expect(
            useVrcNotificationStore.getState().markAllSeen()
        ).rejects.toThrow('Failed to mark 1 notification(s) as seen.');

        expect(
            useVrcNotificationStore
                .getState()
                .rows.find((row) => row.id === friendRequest.id)
        ).toMatchObject({ seen: true });
        expect(
            useVrcNotificationStore
                .getState()
                .rows.find((row) => row.id === failedNotification.id)
        ).toMatchObject({ seen: false });
        expect(useVrcNotificationStore.getState().unseenCount).toBe(1);
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
            created_at: '2020-01-01T00:00:00.000Z'
        };
        const activityNotification = {
            id: 'notif_activity',
            type: 'inviteResponse',
            version: 2,
            seen: false,
            created_at: '2020-01-01T00:00:00.000Z'
        };
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
                    effect: null,
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
