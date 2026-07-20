import { beforeEach, describe, expect, it, vi } from 'vitest';

const commandMocks = vi.hoisted(() => ({
    appNotificationListQuery: vi.fn(),
    appNotificationAddV1: vi.fn(),
    appNotificationMarkSeenLocalBulk: vi.fn(),
    appVrchatNotificationMarkSeen: vi.fn(),
    appVrchatNotificationHideRemote: vi.fn(),
    appVrchatNotificationRespond: vi.fn()
}));

const configMocks = vi.hoisted(() => ({
    getInt: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', () => ({ commands: commandMocks }));
vi.mock('./configRepository', () => ({ default: configMocks }));

import {
    addNotificationToDatabase,
    hideRemoteNotification,
    markSeen,
    markSeenLocalBulk,
    queryNotifications,
    sendNotificationResponse
} from './notificationPersistenceRepository';

function httpResponse(status = 200, data: unknown = { ok: true }) {
    return {
        status,
        data: typeof data === 'string' ? data : JSON.stringify(data)
    };
}

describe('notificationPersistenceRepository', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        configMocks.getInt.mockImplementation(
            async (key: string, fallback: number) =>
                key === 'maxTableSize_v2' ? 250 : fallback
        );
        commandMocks.appNotificationListQuery.mockResolvedValue([]);
        commandMocks.appNotificationAddV1.mockResolvedValue(undefined);
        commandMocks.appNotificationMarkSeenLocalBulk.mockResolvedValue(
            undefined
        );
        commandMocks.appVrchatNotificationMarkSeen.mockResolvedValue(
            httpResponse()
        );
        commandMocks.appVrchatNotificationHideRemote.mockResolvedValue(
            httpResponse()
        );
        commandMocks.appVrchatNotificationRespond.mockResolvedValue(
            httpResponse()
        );
    });

    it('uses the bounded default list query and normalizes nested row data', async () => {
        commandMocks.appNotificationListQuery.mockResolvedValueOnce([
            {
                id: 'notification_1',
                details: null,
                data: 'invalid',
                responses: [{ type: 'accept' }, null, 'invalid']
            }
        ]);

        await expect(
            queryNotifications({ userId: ' usr_1 ' })
        ).resolves.toEqual([
            {
                id: 'notification_1',
                details: {},
                data: {},
                responses: [{ type: 'accept' }]
            }
        ]);
        expect(commandMocks.appNotificationListQuery).toHaveBeenCalledWith({
            userId: 'usr_1',
            search: '',
            filters: [],
            perTableLimit: 500,
            limit: 250,
            includeUnseen: true
        });
    });

    it('uses the search limit and disables unseen expansion for filtered queries', async () => {
        configMocks.getInt.mockImplementation(async (key: string) =>
            key === 'searchLimit' ? 1200 : 250
        );

        await queryNotifications({
            userId: 'usr_1',
            search: ' sender ',
            filters: [' invite ', '', null]
        });

        expect(commandMocks.appNotificationListQuery).toHaveBeenCalledWith({
            userId: 'usr_1',
            search: 'sender',
            filters: ['invite'],
            perTableLimit: 1200,
            limit: 1200,
            includeUnseen: false
        });
    });

    it('skips list IPC when no current user id is available', async () => {
        await expect(queryNotifications({ userId: ' ' })).resolves.toEqual([]);
        expect(configMocks.getInt).not.toHaveBeenCalled();
        expect(commandMocks.appNotificationListQuery).not.toHaveBeenCalled();
    });

    it('fills V1 detail defaults and mirrors a top-level image URL', async () => {
        await addNotificationToDatabase({
            userId: ' usr_1 ',
            notification: {
                id: 'notification_1',
                created_at: '2026-07-17T00:00:00.000Z',
                type: 'invite',
                imageUrl: 'https://example.test/image.png',
                details: { worldId: 'wrld_1' }
            }
        });

        expect(commandMocks.appNotificationAddV1).toHaveBeenCalledWith(
            'usr_1',
            expect.objectContaining({
                id: 'notification_1',
                type: 'invite',
                details: {
                    worldId: 'wrld_1',
                    worldName: '',
                    imageUrl: 'https://example.test/image.png',
                    inviteMessage: '',
                    requestMessage: '',
                    responseMessage: ''
                }
            })
        );
    });

    it('rejects incomplete V1 rows before persistence', async () => {
        await expect(
            addNotificationToDatabase({
                userId: 'usr_1',
                notification: { id: 'notification_1', type: 'invite' }
            })
        ).rejects.toThrow('missing required field');
        expect(commandMocks.appNotificationAddV1).not.toHaveBeenCalled();
    });

    it('normalizes local-only bulk ids without sending remote requests', async () => {
        await markSeenLocalBulk({
            userId: ' usr_1 ',
            ids: [' notification_1 ', null, '', 42]
        });

        expect(
            commandMocks.appNotificationMarkSeenLocalBulk
        ).toHaveBeenCalledWith('usr_1', ['notification_1', '42']);
        expect(
            commandMocks.appVrchatNotificationMarkSeen
        ).not.toHaveBeenCalled();
    });

    it('preserves the version-specific mark-seen path on auth failure', async () => {
        commandMocks.appVrchatNotificationMarkSeen.mockResolvedValueOnce(
            httpResponse(401, {
                error: { message: 'Missing Credentials' }
            })
        );

        await expect(
            markSeen({
                userId: 'usr_1',
                id: 'notification/2',
                version: 2
            })
        ).rejects.toMatchObject({
            message: 'Missing Credentials',
            status: 401,
            endpoint: 'notifications/notification%2F2/see'
        });
    });

    it('uses the sender deletion path for ignored friend requests', async () => {
        await hideRemoteNotification({
            id: ' notification_1 ',
            version: 1,
            type: 'ignoredFriendRequest',
            senderUserId: ' usr_sender '
        });

        expect(
            commandMocks.appVrchatNotificationHideRemote
        ).toHaveBeenCalledWith({
            id: 'notification_1',
            version: 1,
            type: 'ignoredFriendRequest',
            senderUserId: 'usr_sender'
        });
    });

    it('treats an expired notification response as an idempotent no-op', async () => {
        commandMocks.appVrchatNotificationRespond.mockResolvedValueOnce(
            httpResponse(404, { error: { message: 'Not Found' } })
        );

        await expect(
            sendNotificationResponse({
                id: 'notification_1',
                responseType: 'accept'
            })
        ).resolves.toBeNull();
    });
});
