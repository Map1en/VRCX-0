import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    applyBoopLegacyHandling,
    createDefaultNotificationRef,
    createDefaultNotificationV2Ref,
    parseNotificationDetails,
    sanitizeNotificationJson,
    type NotificationV2Ref
} from './notificationTransforms';

describe('notificationTransforms', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('removes empty keys and normalizes message/title bio symbols in place', () => {
        const json: Record<string, unknown> = {
            id: 'notif_1',
            message: 'Hello ＠Maple',
            title: 'Look ≺here≻',
            nullValue: null,
            missingValue: undefined,
            keepFalse: false
        };

        expect(sanitizeNotificationJson(json)).toBe(json);
        expect(json).toEqual({
            id: 'notif_1',
            message: 'Hello @Maple',
            title: 'Look <here>',
            keepFalse: false
        });
    });

    it('parses details objects, JSON strings, and invalid details safely', () => {
        const objectDetails = {
            worldId: 'wrld_1'
        };
        expect(parseNotificationDetails(objectDetails)).toBe(objectDetails);
        expect(parseNotificationDetails('{"worldId":"wrld_2"}')).toEqual({
            worldId: 'wrld_2'
        });
        expect(parseNotificationDetails('{}')).toEqual({});

        const consoleLog = vi
            .spyOn(console, 'log')
            .mockImplementation(() => undefined);
        expect(parseNotificationDetails('{bad json')).toEqual({});
        expect(consoleLog).toHaveBeenCalledOnce();
    });

    it('builds default refs and parses v1 details', () => {
        expect(
            createDefaultNotificationRef({
                id: 'notif_1',
                type: 'invite',
                details: '{"location":"wrld_1"}'
            })
        ).toMatchObject({
            id: 'notif_1',
            senderUserId: '',
            type: 'invite',
            details: {
                location: 'wrld_1'
            },
            seen: false,
            $isExpired: false
        });

        expect(
            createDefaultNotificationV2Ref({
                id: 'notif_2',
                type: 'boop'
            })
        ).toMatchObject({
            id: 'notif_2',
            type: 'boop',
            version: 2,
            details: {},
            responses: []
        });
    });

    it('applies legacy boop titles for default and custom emoji images', () => {
        const defaultBoop = createDefaultNotificationV2Ref({
            type: 'boop',
            title: 'Maple booped you',
            details: {
                emojiId: 'default_wave'
            }
        });
        applyBoopLegacyHandling(defaultBoop, 'https://api.example.test');

        expect(defaultBoop).toMatchObject({
            title: '',
            message: 'Maple booped you wave',
            imageUrl: 'default_wave'
        });

        const customBoop = createDefaultNotificationV2Ref({
            type: 'boop',
            title: 'Custom boop',
            details: {
                emojiId: 'file_123',
                emojiVersion: 4
            }
        });
        applyBoopLegacyHandling(customBoop, 'https://api.example.test');

        expect(customBoop).toMatchObject({
            title: '',
            message: 'Custom boop',
            imageUrl: 'https://api.example.test/file/file_123/4'
        });

        const invite = createDefaultNotificationV2Ref({
            type: 'invite',
            title: 'Invite'
        }) as NotificationV2Ref;
        applyBoopLegacyHandling(invite, 'https://api.example.test');
        expect(invite).toMatchObject({
            title: 'Invite',
            message: '',
            imageUrl: ''
        });
    });
});
