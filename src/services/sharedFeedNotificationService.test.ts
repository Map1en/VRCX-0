import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    pushNotification: vi.fn()
}));

vi.mock('@/services/i18nService', () => ({
    default: {
        t: (key: string, values: { value: string }) => `${key}:${values.value}`
    }
}));

vi.mock('@/state/notificationStore', () => ({
    useNotificationStore: {
        getState: () => ({ pushNotification: mocks.pushNotification })
    }
}));

import { pushSharedFeedNotification } from './sharedFeedNotificationService';

describe('pushSharedFeedNotification', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('includes the new trust level in the desktop summary', async () => {
        await pushSharedFeedNotification({
            type: 'TrustLevel',
            userId: 'usr_friend',
            displayName: 'Friend',
            trustLevel: 'Trusted User'
        });

        expect(mocks.pushNotification).toHaveBeenCalledWith({
            level: 'info',
            title: 'service.shared_feed_notification_service.dynamic.feed_value:TrustLevel',
            message: 'Friend - Trusted User'
        });
    });
});
