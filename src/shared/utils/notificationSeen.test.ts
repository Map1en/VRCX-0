import { describe, expect, it } from 'vitest';

import {
    isNotificationExpired,
    isUnseenNotification
} from './notificationSeen';

describe('isNotificationExpired', () => {
    it('trusts an explicit expiry flag from the server over a computed one', () => {
        expect(
            isNotificationExpired({
                $isExpired: true,
                expiresAt: new Date(Date.now() + 60_000).toISOString()
            })
        ).toBe(true);
        expect(
            isNotificationExpired({
                expired: false,
                expiresAt: new Date(Date.now() - 60_000).toISOString()
            })
        ).toBe(false);
    });

    it('falls back to comparing the expiry timestamp against now when no explicit flag is present', () => {
        expect(
            isNotificationExpired({
                expiresAt: new Date(Date.now() - 1000).toISOString()
            })
        ).toBe(true);
        expect(
            isNotificationExpired({
                expiresAt: new Date(Date.now() + 60_000).toISOString()
            })
        ).toBe(false);
    });

    it('treats a notification with no expiry information as not expired', () => {
        expect(isNotificationExpired({})).toBe(false);
        expect(isNotificationExpired(null)).toBe(false);
        expect(isNotificationExpired({ expiresAt: 'not-a-date' })).toBe(false);
    });
});

describe('isUnseenNotification', () => {
    it('counts an unread v2 notification toward the unread badge', () => {
        expect(
            isUnseenNotification({ version: 2, seen: false, type: 'message' })
        ).toBe(true);
    });

    it('does not count a v2 notification the user already saw', () => {
        expect(
            isUnseenNotification({ version: 2, seen: true, type: 'message' })
        ).toBe(false);
    });

    it('still counts a legacy (pre-v2) friend request as unread, since older clients never set a version field', () => {
        expect(
            isUnseenNotification({ seen: false, type: 'friendRequest' })
        ).toBe(true);
    });

    it('does not count other legacy notification types as unread, since only friend requests carried v1 read-state semantics', () => {
        expect(
            isUnseenNotification({ seen: false, type: 'inviteResponse' })
        ).toBe(false);
    });

    it('never counts an expired notification toward the unread badge, even if it was never marked seen', () => {
        expect(
            isUnseenNotification({
                version: 2,
                seen: false,
                type: 'message',
                expired: true
            })
        ).toBe(false);
    });

    it('treats a missing notification as not contributing to the unread count', () => {
        expect(isUnseenNotification(null)).toBe(false);
        expect(isUnseenNotification(undefined)).toBe(false);
    });
});
