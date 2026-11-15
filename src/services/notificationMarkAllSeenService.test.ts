import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppToastOptions } from '@/services/toastService';

const mocks = vi.hoisted(() => ({
    markAllSeen: vi.fn(),
    toastAdd: vi.fn()
}));

vi.mock('@/services/toastService', () => ({
    toast: { add: mocks.toastAdd }
}));

vi.mock('@/state/vrcNotificationStore', () => ({
    useVrcNotificationStore: {
        getState: () => ({ markAllSeen: mocks.markAllSeen })
    }
}));

vi.mock('./i18nService', () => ({
    default: { t: (key: string) => key }
}));

import { markAllNotificationsSeenWithFeedback } from './notificationMarkAllSeenService';

describe('markAllNotificationsSeenWithFeedback', () => {
    beforeEach(() => {
        mocks.markAllSeen.mockReset();
        mocks.toastAdd.mockReset();
    });

    it('stays quiet when every notification is marked', async () => {
        mocks.markAllSeen.mockResolvedValue({ failedCount: 0 });

        await markAllNotificationsSeenWithFeedback('Failed');

        expect(mocks.toastAdd).not.toHaveBeenCalled();
    });

    it('summarizes rows that stayed local in one warning toast', async () => {
        mocks.markAllSeen.mockResolvedValueOnce({ failedCount: 2 });

        await markAllNotificationsSeenWithFeedback('Failed');

        expect(mocks.toastAdd).toHaveBeenCalledTimes(1);
        const options: AppToastOptions = mocks.toastAdd.mock.calls[0][0];
        expect(options).toEqual({
            type: 'warning',
            title: 'host.vrc_notification_center.toast.mark_all_seen_partially_failed'
        });
    });

    it('shows the error when mark-all-seen fails outright', async () => {
        mocks.markAllSeen.mockRejectedValue(new Error('IPC failed'));

        await markAllNotificationsSeenWithFeedback('Failed');

        expect(mocks.toastAdd).toHaveBeenCalledWith({
            type: 'error',
            title: 'IPC failed'
        });
    });
});
