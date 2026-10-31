import { toast } from '@/services/toastService';
import { useVrcNotificationStore } from '@/state/vrcNotificationStore';

import i18n from './i18nService';

export async function markAllNotificationsSeenWithFeedback(
    errorTitle: string
): Promise<void> {
    try {
        const { failedCount } = await useVrcNotificationStore
            .getState()
            .markAllSeen();
        if (failedCount > 0) {
            toast.add({
                type: 'warning',
                title: i18n.t(
                    'host.vrc_notification_center.toast.mark_all_seen_partially_failed'
                ),
                actionProps: {
                    children: i18n.t('common.action.retry'),
                    onClick: () => {
                        void markAllNotificationsSeenWithFeedback(errorTitle);
                    }
                }
            });
        }
    } catch (error) {
        toast.add({
            type: 'error',
            title: error instanceof Error ? error.message : errorTitle
        });
    }
}
