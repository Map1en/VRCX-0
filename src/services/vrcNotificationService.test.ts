import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { NotificationRow } from '@/repositories/notificationPersistenceRepository';
import i18n from '@/services/i18nService';

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

const notificationActionMocks = vi.hoisted(() => ({
    sendNotificationButtonResponse: vi.fn()
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

vi.mock('@/services/notificationActionService', () => ({
    sendNotificationButtonResponse:
        notificationActionMocks.sendNotificationButtonResponse
}));

vi.mock('@/services/shellIntegrationService', () => ({
    setTrayIconNotification: vi.fn(() => Promise.resolve()),
    setTaskbarOverlayNotification: vi.fn(() => Promise.resolve())
}));

import { useRuntimeStore } from '@/state/runtimeStore';
import { useShellStore } from '@/state/shellStore';
import {
    selectCanMarkAllSeen,
    selectMarkAllSeenRowState,
    useVrcNotificationStore
} from '@/state/vrcNotificationStore';

import {
    expireVrcNotifications,
    loadVrcNotificationsForCurrentUser,
    markAllVrcNotificationsSeen,
    markVrcNotificationRead,
    markVrcNotificationsSeen,
    openVrcNotificationCenter,
    patchVrcNotification,
    refreshVrcNotificationsForCurrentUser,
    resetVrcNotificationState,
    setVrcNotificationCenterOpen,
    upsertVrcNotification
} from './vrcNotificationService';

describe('vrcNotificationStore', () => {
    beforeEach(() => {
        notificationRepositoryMock.queryNotifications.mockReset();
        commandMocks.markSeenBatch.mockReset();
        commandMocks.sync.mockReset();
        notificationActionMocks.sendNotificationButtonResponse.mockReset();
        notificationActionMocks.sendNotificationButtonResponse.mockResolvedValue(
            undefined
        );
        commandMocks.markSeenBatch.mockImplementation(
            async ({
                items
            }: {
                items: Array<{ id: string; version: number; type: string }>;
            }) => ({
                total: items.length,
                succeeded: items.length,
                failed: 0,
                items: items.map((item) => ({
                    id: item.id,
                    state: 'succeeded',
                    effect:
                        item.version < 2 &&
                        (item.type === 'invite' ||
                            item.type === 'requestInvite')
                            ? 'expired'
                            : 'seen',
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
        resetVrcNotificationState();
    });

    async function loadRowsAtCap() {
        notificationRepositoryMock.queryNotifications.mockResolvedValue(
            Array.from({ length: 2000 }, (_, index) => ({
                id: `notif_${index}`,
                type: 'inviteResponse',
                version: 2,
                seen: true,
                created_at: new Date(1700000000000 + index).toISOString()
            }))
        );
        await loadVrcNotificationsForCurrentUser();
        expect(useVrcNotificationStore.getState().rows).toHaveLength(2000);
    }

    it('caps live upserts so a long session cannot grow rows without bound', async () => {
        await loadRowsAtCap();
        for (let index = 2000; index < 2050; index += 1) {
            upsertVrcNotification({
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

    it('keeps an upserted notification even when it sorts past the cap', async () => {
        await loadRowsAtCap();

        upsertVrcNotification({
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

        await loadVrcNotificationsForCurrentUser();
        expect(useVrcNotificationStore.getState().rows).toHaveLength(2400);

        upsertVrcNotification({
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

        const previousLoadPromise = loadVrcNotificationsForCurrentUser();
        resetVrcNotificationState();
        useRuntimeStore.getState().setAuthBootstrap({
            currentUserId: 'usr_other',
            currentUserEndpoint: 'https://api.example.test/api/1'
        });
        await loadVrcNotificationsForCurrentUser();

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
        const load = loadVrcNotificationsForCurrentUser();
        upsertVrcNotification({
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
        const load = loadVrcNotificationsForCurrentUser();
        upsertVrcNotification({
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

        const previousRefreshPromise = refreshVrcNotificationsForCurrentUser();
        resetVrcNotificationState();
        useRuntimeStore.getState().setAuthBootstrap({
            currentUserId: 'usr_other',
            currentUserEndpoint: 'https://api.example.test/api/1'
        });
        upsertVrcNotification({
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
        upsertVrcNotification(friendRequest);

        await markAllVrcNotificationsSeen();

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
                    type: 'friendRequest'
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
        upsertVrcNotification(friendRequest);

        await expect(markVrcNotificationRead(friendRequest)).resolves.toEqual({
            remoteFailed: false,
            message: ''
        });

        expect(commandMocks.markSeenBatch).toHaveBeenCalledWith({
            items: [
                {
                    id: 'notif_friend_request',
                    version: 1,
                    type: 'friendRequest'
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

    it('keeps a v1 friend request read locally when VRChat rejects mark-all-seen', async () => {
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
                    state: 'remoteFailed',
                    effect: 'seen',
                    attempts: 4,
                    message: 'Too many requests'
                }
            ],
            lastError: 'Too many requests'
        });
        upsertVrcNotification(friendRequest);

        await expect(markAllVrcNotificationsSeen()).resolves.toEqual({
            failedCount: 1
        });

        expect(commandMocks.markSeenBatch).toHaveBeenCalledWith({
            items: [
                {
                    id: friendRequest.id,
                    version: 1,
                    type: 'friendRequest'
                }
            ]
        });
        expect(useVrcNotificationStore.getState().rows[0]).toMatchObject({
            id: friendRequest.id,
            seen: true
        });
        expect(useVrcNotificationStore.getState().unseenCount).toBe(0);
        expect(useShellStore.getState().vrcUnseenNotificationCount).toBe(0);
        expect(
            selectMarkAllSeenRowState(
                useVrcNotificationStore.getState(),
                friendRequest.id
            )
        ).toBe('failed');
    });

    it('keeps a single read local and flags the row when VRChat rejects it', async () => {
        const boop = {
            id: 'notif_boop',
            type: 'boop',
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
                    id: boop.id,
                    state: 'remoteFailed',
                    effect: 'seen',
                    attempts: 1,
                    message: 'HTTP 500'
                }
            ],
            lastError: 'HTTP 500'
        });
        upsertVrcNotification(boop);

        await expect(markVrcNotificationRead(boop)).resolves.toEqual({
            remoteFailed: true,
            message: 'HTTP 500'
        });

        const state = useVrcNotificationStore.getState();
        expect(state.rows[0]).toMatchObject({ id: boop.id, seen: true });
        expect(state.unseenCount).toBe(0);
        expect(selectMarkAllSeenRowState(state, boop.id)).toBe('failed');
        expect(
            notificationRepositoryMock.queryNotifications
        ).not.toHaveBeenCalled();
    });

    it('marks a pending invite read on VRChat and clears it from pending invites', async () => {
        const invite = {
            id: 'notif_invite',
            type: 'invite',
            version: 1,
            seen: true,
            created_at: new Date().toISOString()
        };
        upsertVrcNotification(invite);
        expect(useVrcNotificationStore.getState().pendingInviteCount).toBe(1);

        await markVrcNotificationRead(invite);

        expect(commandMocks.markSeenBatch).toHaveBeenCalledWith({
            items: [{ id: 'notif_invite', version: 1, type: 'invite' }]
        });
        expect(useVrcNotificationStore.getState()).toMatchObject({
            pendingInviteCount: 0
        });
        expect(useVrcNotificationStore.getState().rows[0]).toMatchObject({
            id: 'notif_invite',
            expired: true
        });
    });

    it('keeps every row read locally when part of mark-all-seen fails remotely', async () => {
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
                    state: 'remoteFailed',
                    effect: 'seen',
                    attempts: 4,
                    message: 'Too many requests'
                }
            ],
            lastError: 'Too many requests'
        });
        upsertVrcNotification(friendRequest);
        upsertVrcNotification(failedNotification);

        await expect(markAllVrcNotificationsSeen()).resolves.toEqual({
            failedCount: 1
        });

        expect(
            useVrcNotificationStore
                .getState()
                .rows.find((row) => row.id === friendRequest.id)
        ).toMatchObject({ seen: true });
        expect(
            useVrcNotificationStore
                .getState()
                .rows.find((row) => row.id === failedNotification.id)
        ).toMatchObject({ seen: true });
        expect(useVrcNotificationStore.getState().unseenCount).toBe(0);
    });

    it('excludes expired friend requests from the notification center', () => {
        upsertVrcNotification({
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

        await refreshVrcNotificationsForCurrentUser();

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

        await expect(refreshVrcNotificationsForCurrentUser()).rejects.toThrow(
            'Network unavailable'
        );

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
        upsertVrcNotification(systemNotification);

        await markAllVrcNotificationsSeen();

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
                    type: 'event.announcement'
                }
            ]
        });
    });

    it('dismisses notifications that offer a dismiss response on mark-all-seen', async () => {
        const dismissResponse = {
            type: 'delete',
            icon: 'check',
            text: 'Acknowledge and dismiss this notification'
        };
        const announcement = {
            id: 'notif_announcement',
            type: 'group.announcement',
            version: 2,
            seen: false,
            responses: [dismissResponse],
            created_at: new Date().toISOString()
        };
        const plain = {
            id: 'notif_plain',
            type: 'event.announcement',
            version: 2,
            seen: false,
            created_at: new Date().toISOString()
        };
        upsertVrcNotification(announcement);
        upsertVrcNotification(plain);
        notificationRepositoryMock.queryNotifications.mockResolvedValue([]);

        await markAllVrcNotificationsSeen();

        expect(
            notificationActionMocks.sendNotificationButtonResponse
        ).toHaveBeenCalledTimes(1);
        expect(
            notificationActionMocks.sendNotificationButtonResponse
        ).toHaveBeenCalledWith({
            currentUserId: 'usr_me',
            notification: expect.objectContaining({
                id: 'notif_announcement'
            }),
            response: dismissResponse
        });
        expect(commandMocks.markSeenBatch).toHaveBeenCalledWith({
            items: [
                {
                    id: 'notif_plain',
                    version: 2,
                    type: 'event.announcement'
                }
            ]
        });
    });

    it('marks pending invites read on VRChat during mark-all-seen', async () => {
        const invite = {
            id: 'notif_invite',
            type: 'invite',
            seen: true,
            created_at: new Date().toISOString()
        };
        const requestInvite = {
            id: 'notif_request_invite',
            type: 'requestInvite',
            seen: true,
            created_at: new Date().toISOString()
        };
        const expiredInvite = {
            id: 'notif_expired_invite',
            type: 'invite',
            seen: true,
            expired: true,
            created_at: new Date().toISOString()
        };
        upsertVrcNotification(invite);
        upsertVrcNotification(requestInvite);
        upsertVrcNotification(expiredInvite);
        expect(useVrcNotificationStore.getState()).toMatchObject({
            unseenCount: 0,
            pendingInviteCount: 2
        });

        await markAllVrcNotificationsSeen();

        expect(commandMocks.markSeenBatch).toHaveBeenCalledTimes(1);
        expect(
            commandMocks.markSeenBatch.mock.calls[0][0].items
                .map((item: { id: string }) => item.id)
                .sort()
        ).toEqual(['notif_invite', 'notif_request_invite']);
        expect(useVrcNotificationStore.getState()).toMatchObject({
            pendingInviteCount: 0
        });
        expect(selectCanMarkAllSeen(useVrcNotificationStore.getState())).toBe(
            false
        );
    });

    it('marks non-system v2 notifications read after mark-all-seen', async () => {
        const activityNotification = {
            id: 'notif_activity',
            type: 'inviteResponse',
            version: 2,
            seen: false,
            created_at: new Date().toISOString()
        };
        upsertVrcNotification(activityNotification);

        await markAllVrcNotificationsSeen();

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
                    type: 'inviteResponse'
                }
            ]
        });
    });

    it('marks system and activity notifications on VRChat in one batch', async () => {
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
        upsertVrcNotification(systemNotification);
        upsertVrcNotification(activityNotification);

        await markAllVrcNotificationsSeen();

        expect(useVrcNotificationStore.getState().unseenCount).toBe(0);
        expect(useShellStore.getState().vrcUnseenNotificationCount).toBe(0);
        expect(commandMocks.markSeenBatch).toHaveBeenCalledWith({
            items: [
                {
                    id: 'notif_group_announcement',
                    version: 2,
                    type: 'group.announcement'
                },
                {
                    id: 'notif_activity',
                    version: 2,
                    type: 'inviteResponse'
                }
            ]
        });
    });

    it('keeps notifications read locally and reports the failure when the server call fails', async () => {
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
                    state: 'remoteFailed',
                    effect: 'seen',
                    attempts: 4,
                    message: 'Too many requests'
                }
            ],
            lastError: 'Too many requests'
        });

        upsertVrcNotification(activityNotification);

        await expect(markAllVrcNotificationsSeen()).resolves.toEqual({
            failedCount: 1
        });

        expect(commandMocks.markSeenBatch).toHaveBeenCalledTimes(1);
        expect(useVrcNotificationStore.getState().unseenCount).toBe(0);
        expect(
            selectMarkAllSeenRowState(
                useVrcNotificationStore.getState(),
                'notif_failing'
            )
        ).toBe('failed');
        expect(useVrcNotificationStore.getState().rows[0]).toMatchObject({
            id: 'notif_failing',
            seen: true
        });
        expect(useShellStore.getState().vrcUnseenNotificationCount).toBe(0);
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
        upsertVrcNotification(notification);

        await expect(markAllVrcNotificationsSeen()).rejects.toThrow(
            'IPC failed'
        );

        expect(
            notificationRepositoryMock.queryNotifications
        ).toHaveBeenCalled();
        expect(useVrcNotificationStore.getState().rows[0]).toMatchObject({
            id: notification.id,
            seen: false
        });
        expect(useVrcNotificationStore.getState().unseenCount).toBe(1);
    });

    it('marks plain notifications seen before dismissing the rest one by one', async () => {
        const dismissResponse = {
            type: 'delete',
            icon: 'check',
            text: 'Acknowledge and dismiss this notification'
        };
        const first = {
            id: 'notif_dismiss_first',
            type: 'group.announcement',
            version: 2,
            seen: false,
            responses: [dismissResponse],
            created_at: new Date().toISOString()
        };
        const second = {
            id: 'notif_dismiss_second',
            type: 'group.announcement',
            version: 2,
            seen: false,
            responses: [dismissResponse],
            created_at: new Date().toISOString()
        };
        const plain = {
            id: 'notif_plain',
            type: 'event.announcement',
            version: 2,
            seen: false,
            created_at: new Date().toISOString()
        };
        upsertVrcNotification(first);
        upsertVrcNotification(second);
        upsertVrcNotification(plain);
        notificationRepositoryMock.queryNotifications.mockResolvedValue([]);
        const dismissCalls: Deferred<void>[] = [];
        notificationActionMocks.sendNotificationButtonResponse.mockImplementation(
            () => {
                const deferred = createDeferred<void>();
                dismissCalls.push(deferred);
                return deferred.promise;
            }
        );

        const marking = markAllVrcNotificationsSeen();
        await vi.waitFor(() => expect(dismissCalls).toHaveLength(1));

        const activeId =
            notificationActionMocks.sendNotificationButtonResponse.mock
                .calls[0][0].notification.id;
        const queuedId = activeId === first.id ? second.id : first.id;
        let state = useVrcNotificationStore.getState();
        expect(state.markAllSeenProgress).toEqual({
            total: 3,
            done: 1,
            activeId,
            queuedIds: [queuedId]
        });
        expect(state.rows.find((row) => row.id === plain.id)).toMatchObject({
            seen: true
        });
        expect(selectMarkAllSeenRowState(state, activeId)).toBe('active');
        expect(selectMarkAllSeenRowState(state, queuedId)).toBe('queued');
        expect(selectCanMarkAllSeen(state)).toBe(false);

        dismissCalls[0].resolve();
        await vi.waitFor(() => expect(dismissCalls).toHaveLength(2));
        state = useVrcNotificationStore.getState();
        expect(state.markAllSeenProgress).toMatchObject({
            done: 2,
            activeId: queuedId,
            queuedIds: []
        });
        expect(state.unseenCount).toBe(1);

        dismissCalls[1].resolve();
        await expect(marking).resolves.toEqual({ failedCount: 0 });
        expect(useVrcNotificationStore.getState().markAllSeenProgress).toBe(
            null
        );
    });

    it('dismisses recent seen notifications that still offer a dismiss response', async () => {
        const dismissResponse = {
            type: 'delete',
            icon: 'check',
            text: 'Acknowledge and dismiss this notification'
        };
        const recentSeen = {
            id: 'notif_recent_seen',
            type: 'group.announcement',
            version: 2,
            seen: true,
            responses: [dismissResponse],
            created_at: new Date().toISOString()
        };
        const oldSeen = {
            ...recentSeen,
            id: 'notif_old_seen',
            created_at: '2020-01-01T00:00:00.000Z'
        };
        const recentWithoutDismiss = {
            id: 'notif_recent_plain',
            type: 'group.announcement',
            version: 2,
            seen: true,
            created_at: new Date().toISOString()
        };
        upsertVrcNotification(recentSeen);
        upsertVrcNotification(oldSeen);
        upsertVrcNotification(recentWithoutDismiss);
        notificationRepositoryMock.queryNotifications.mockResolvedValue([]);
        expect(useVrcNotificationStore.getState().unseenCount).toBe(0);
        expect(selectCanMarkAllSeen(useVrcNotificationStore.getState())).toBe(
            true
        );

        await expect(markAllVrcNotificationsSeen()).resolves.toEqual({
            failedCount: 0
        });

        expect(
            notificationActionMocks.sendNotificationButtonResponse
        ).toHaveBeenCalledTimes(1);
        expect(
            notificationActionMocks.sendNotificationButtonResponse
        ).toHaveBeenCalledWith(
            expect.objectContaining({
                notification: expect.objectContaining({ id: recentSeen.id }),
                response: dismissResponse
            })
        );
        expect(commandMocks.markSeenBatch).not.toHaveBeenCalled();
    });

    it('reports a failed dismissal of a seen notification without marking it read', async () => {
        const recentSeen = {
            id: 'notif_recent_seen',
            type: 'group.announcement',
            version: 2,
            seen: true,
            responses: [{ type: 'delete', icon: 'check', text: 'Dismiss' }],
            created_at: new Date().toISOString()
        };
        upsertVrcNotification(recentSeen);
        notificationRepositoryMock.queryNotifications.mockResolvedValue([
            recentSeen
        ]);
        notificationActionMocks.sendNotificationButtonResponse.mockRejectedValue(
            new Error('Too many requests')
        );

        await expect(markAllVrcNotificationsSeen()).resolves.toEqual({
            failedCount: 1
        });

        expect(commandMocks.markSeenBatch).not.toHaveBeenCalled();
        expect(
            selectMarkAllSeenRowState(
                useVrcNotificationStore.getState(),
                recentSeen.id
            )
        ).toBe('failed');
    });

    it('keeps mark-all-seen running once and marks failed dismissals read instead', async () => {
        const announcement = {
            id: 'notif_announcement',
            type: 'group.announcement',
            version: 2,
            seen: false,
            responses: [{ type: 'delete', icon: 'check', text: 'Dismiss' }],
            created_at: new Date().toISOString()
        };
        upsertVrcNotification(announcement);
        notificationRepositoryMock.queryNotifications.mockResolvedValue([
            { ...announcement, seen: true }
        ]);
        const dismissal = createDeferred<void>();
        notificationActionMocks.sendNotificationButtonResponse.mockReturnValue(
            dismissal.promise
        );

        const marking = markAllVrcNotificationsSeen();
        await expect(markAllVrcNotificationsSeen()).resolves.toEqual({
            failedCount: 0
        });
        dismissal.reject(new Error('Too many requests'));

        await expect(marking).resolves.toEqual({ failedCount: 0 });
        expect(
            notificationActionMocks.sendNotificationButtonResponse
        ).toHaveBeenCalledTimes(1);
        expect(commandMocks.markSeenBatch).toHaveBeenCalledWith({
            items: [
                {
                    id: announcement.id,
                    version: 2,
                    type: 'group.announcement'
                }
            ]
        });
        const state = useVrcNotificationStore.getState();
        expect(state.markAllSeenProgress).toBe(null);
        expect(
            state.rows.find((row) => row.id === announcement.id)
        ).toMatchObject({ seen: true });
        expect(selectMarkAllSeenRowState(state, announcement.id)).toBe(null);
    });

    it('drops a same-account load that finishes after a direct reset', async () => {
        const staleLoad = createDeferred<NotificationRow[]>();
        notificationRepositoryMock.queryNotifications.mockReturnValueOnce(
            staleLoad.promise
        );

        const load = loadVrcNotificationsForCurrentUser();
        resetVrcNotificationState();
        staleLoad.resolve([
            {
                id: 'notif_stale',
                type: 'inviteResponse',
                version: 2,
                seen: false,
                created_at: '2026-08-16T02:00:00.000Z'
            }
        ]);
        await expect(load).resolves.toEqual([
            expect.objectContaining({ id: 'notif_stale' })
        ]);

        expect(useVrcNotificationStore.getState()).toMatchObject({
            rows: [],
            unseenCount: 0,
            loadStatus: 'idle'
        });
        expect(useShellStore.getState().vrcUnseenNotificationCount).toBe(0);
    });

    it('drops a same-account load failure that lands after a direct reset', async () => {
        const staleLoad = createDeferred<NotificationRow[]>();
        notificationRepositoryMock.queryNotifications.mockReturnValueOnce(
            staleLoad.promise
        );

        const load = loadVrcNotificationsForCurrentUser();
        resetVrcNotificationState();
        staleLoad.reject(new Error('stale failure'));

        await expect(load).resolves.toEqual([]);
        expect(useVrcNotificationStore.getState()).toMatchObject({
            loadStatus: 'idle',
            detail: ''
        });
    });

    it('clears rows and reports the missing session when no user is signed in', async () => {
        upsertVrcNotification({
            id: 'notif_unseen',
            type: 'invite',
            version: 2,
            seen: false
        });
        expect(useShellStore.getState().vrcUnseenNotificationCount).toBe(1);
        useRuntimeStore.getState().setAuthBootstrap({ currentUserId: '' });

        await expect(loadVrcNotificationsForCurrentUser()).resolves.toEqual([]);

        expect(useVrcNotificationStore.getState()).toMatchObject({
            rows: [],
            unseenCount: 0,
            loadStatus: 'idle',
            detail: i18n.t('view.notifications.toast.no_current_user_session')
        });
        expect(useShellStore.getState().vrcUnseenNotificationCount).toBe(0);
        expect(
            notificationRepositoryMock.queryNotifications
        ).not.toHaveBeenCalled();
    });

    it('falls back to a plain load when refreshing without a session', async () => {
        useRuntimeStore.getState().setAuthBootstrap({ currentUserId: '' });

        await expect(refreshVrcNotificationsForCurrentUser()).resolves.toEqual(
            []
        );

        expect(commandMocks.sync).not.toHaveBeenCalled();
    });

    it('refreshes from VRChat when the center opens but not when it closes', async () => {
        notificationRepositoryMock.queryNotifications.mockResolvedValue([]);

        setVrcNotificationCenterOpen(false);
        expect(useVrcNotificationStore.getState().isCenterOpen).toBe(false);
        expect(commandMocks.sync).not.toHaveBeenCalled();

        openVrcNotificationCenter();
        expect(useVrcNotificationStore.getState()).toMatchObject({
            isCenterOpen: true,
            loadStatus: 'running'
        });
        await vi.waitFor(() =>
            expect(useVrcNotificationStore.getState().loadStatus).toBe('ready')
        );
        expect(commandMocks.sync).toHaveBeenCalledOnce();
        expect(
            notificationRepositoryMock.queryNotifications
        ).toHaveBeenCalledWith({ userId: 'usr_me' });
    });

    it('swallows a refresh failure triggered by opening the center', async () => {
        commandMocks.sync.mockRejectedValue(new Error('sync failed'));
        notificationRepositoryMock.queryNotifications.mockResolvedValue([]);

        setVrcNotificationCenterOpen(true);

        await vi.waitFor(() =>
            expect(useVrcNotificationStore.getState()).toMatchObject({
                loadStatus: 'error',
                detail: 'sync failed'
            })
        );
    });

    it('mirrors the unseen count into the shell as rows change', () => {
        upsertVrcNotification({
            id: 'notif_a',
            type: 'invite',
            version: 2,
            seen: false
        });
        upsertVrcNotification({
            id: 'notif_b',
            type: 'invite',
            version: 2,
            seen: false
        });
        expect(useShellStore.getState().vrcUnseenNotificationCount).toBe(2);

        markVrcNotificationsSeen(' notif_a ');
        expect(useShellStore.getState().vrcUnseenNotificationCount).toBe(1);

        expireVrcNotifications(['notif_b']);
        expect(useShellStore.getState().vrcUnseenNotificationCount).toBe(0);
        expect(
            useVrcNotificationStore
                .getState()
                .rows.find((row) => row.id === 'notif_b')
        ).toMatchObject({ expired: true, seen: true });

        upsertVrcNotification({
            id: 'notif_c',
            type: 'invite',
            version: 2,
            seen: false
        });
        resetVrcNotificationState();
        expect(useShellStore.getState().vrcUnseenNotificationCount).toBe(0);
    });

    it('ignores upserts without an id and blank id lists', () => {
        upsertVrcNotification({ id: '', type: 'invite', seen: false });
        markVrcNotificationsSeen(['', '  ']);
        expireVrcNotifications([]);
        patchVrcNotification('  ', { worldName: 'World' });

        expect(useVrcNotificationStore.getState().rows).toEqual([]);
    });

    it('patches non-empty display fields and mirrors world fields into details', () => {
        upsertVrcNotification({
            id: 'notif_patch',
            type: 'invite',
            version: 2,
            seen: true,
            senderDisplayName: 'Old Name',
            details: { worldId: 'wrld_1' }
        });

        patchVrcNotification(' notif_patch ', {
            senderDisplayName: 'New Name',
            senderUsername: '  ',
            worldName: 'World One',
            displayLocation: 'World One #123'
        });

        expect(useVrcNotificationStore.getState().rows[0]).toMatchObject({
            senderDisplayName: 'New Name',
            worldName: 'World One',
            displayLocation: 'World One #123',
            details: {
                worldId: 'wrld_1',
                worldName: 'World One',
                displayLocation: 'World One #123'
            }
        });
        expect(
            useVrcNotificationStore.getState().rows[0].senderUsername
        ).toBeUndefined();
    });

    it('keeps the same rows when a patch carries only blank fields', () => {
        upsertVrcNotification({
            id: 'notif_patch',
            type: 'invite',
            version: 2,
            seen: true
        });
        const rows = useVrcNotificationStore.getState().rows;

        patchVrcNotification('notif_patch', { worldName: '   ' });

        expect(useVrcNotificationStore.getState().rows).toBe(rows);
    });

    it('clears a failed flag once the row is later seen or expired', async () => {
        const first = {
            id: 'notif_first',
            type: 'invite',
            version: 2,
            seen: false
        };
        const second = { ...first, id: 'notif_second' };
        upsertVrcNotification(first);
        upsertVrcNotification(second);
        useVrcNotificationStore.setState({
            markAllSeenFailedIds: [first.id, second.id]
        });

        markVrcNotificationsSeen(first.id);
        expireVrcNotifications(second.id);

        expect(useVrcNotificationStore.getState().markAllSeenFailedIds).toEqual(
            []
        );
    });

    it('treats a read of a missing, already read or unscoped notification as a no-op', async () => {
        const seenRow = {
            id: 'notif_seen',
            type: 'inviteResponse',
            version: 2,
            seen: true
        };

        await expect(markVrcNotificationRead(null)).resolves.toEqual({
            remoteFailed: false,
            message: ''
        });
        await expect(markVrcNotificationRead(seenRow)).resolves.toEqual({
            remoteFailed: false,
            message: ''
        });
        useRuntimeStore.getState().setAuthBootstrap({ currentUserId: '' });
        await expect(
            markVrcNotificationRead({
                ...seenRow,
                seen: false
            })
        ).resolves.toEqual({ remoteFailed: false, message: '' });

        expect(commandMocks.markSeenBatch).not.toHaveBeenCalled();
    });

    it('keeps a pending optimistic read applied to rows loaded mid-batch', async () => {
        const unseen = {
            id: 'notif_pending',
            type: 'inviteResponse',
            version: 2,
            seen: false,
            created_at: new Date().toISOString()
        };
        upsertVrcNotification(unseen);
        const batch = createDeferred<unknown>();
        commandMocks.markSeenBatch.mockReturnValueOnce(batch.promise);
        notificationRepositoryMock.queryNotifications.mockResolvedValue([
            unseen
        ]);

        const reading = markVrcNotificationRead(unseen);
        await loadVrcNotificationsForCurrentUser();

        expect(useVrcNotificationStore.getState().rows[0]).toMatchObject({
            id: unseen.id,
            seen: true
        });
        batch.resolve({
            total: 1,
            succeeded: 1,
            failed: 0,
            items: [
                {
                    id: unseen.id,
                    state: 'succeeded',
                    effect: 'seen',
                    attempts: 1,
                    message: ''
                }
            ],
            lastError: null
        });
        await expect(reading).resolves.toEqual({
            remoteFailed: false,
            message: ''
        });
    });

    it('stops dismissing and leaves progress alone after a reset mid mark-all-seen', async () => {
        const responses = [{ type: 'delete', icon: 'check', text: 'Dismiss' }];
        const now = new Date().toISOString();
        upsertVrcNotification({
            id: 'notif_one',
            type: 'group.announcement',
            version: 2,
            seen: false,
            responses,
            created_at: now
        });
        upsertVrcNotification({
            id: 'notif_two',
            type: 'group.announcement',
            version: 2,
            seen: false,
            responses,
            created_at: now
        });
        const dismissal = createDeferred<void>();
        notificationActionMocks.sendNotificationButtonResponse.mockReturnValueOnce(
            dismissal.promise
        );

        const marking = markAllVrcNotificationsSeen();
        await vi.waitFor(() =>
            expect(
                notificationActionMocks.sendNotificationButtonResponse
            ).toHaveBeenCalledOnce()
        );
        resetVrcNotificationState();
        dismissal.resolve();

        await expect(marking).resolves.toEqual({ failedCount: 0 });
        expect(
            notificationActionMocks.sendNotificationButtonResponse
        ).toHaveBeenCalledOnce();
        expect(
            notificationRepositoryMock.queryNotifications
        ).not.toHaveBeenCalled();
        expect(useVrcNotificationStore.getState()).toMatchObject({
            rows: [],
            markAllSeenProgress: null,
            markAllSeenFailedIds: []
        });
    });
});
