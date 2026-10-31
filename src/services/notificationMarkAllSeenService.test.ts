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

    it('summarizes partial failures in one toast that can retry', async () => {
        mocks.markAllSeen
            .mockResolvedValueOnce({ failedCount: 2 })
            .mockResolvedValueOnce({ failedCount: 0 });

        await markAllNotificationsSeenWithFeedback('Failed');

        expect(mocks.toastAdd).toHaveBeenCalledTimes(1);
        const options: AppToastOptions = mocks.toastAdd.mock.calls[0][0];
        expect(options).toMatchObject({
            type: 'warning',
            title: 'host.vrc_notification_center.toast.mark_all_seen_partially_failed',
            actionProps: { children: 'common.action.retry' }
        });

        const retry = options.actionProps?.onClick as () => void;
        retry();

        await vi.waitFor(() =>
            expect(mocks.markAllSeen).toHaveBeenCalledTimes(2)
        );
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
