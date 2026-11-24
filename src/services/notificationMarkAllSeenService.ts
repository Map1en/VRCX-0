import { toast } from '@/services/toastService';

import i18n from './i18nService';
import { markAllVrcNotificationsSeen } from './vrcNotificationService';

export async function markAllNotificationsSeenWithFeedback(
    errorTitle: string
): Promise<void> {
    try {
        const { failedCount } = await markAllVrcNotificationsSeen();
        if (failedCount > 0) {
            toast.add({
                type: 'warning',
                title: i18n.t(
                    'host.vrc_notification_center.toast.mark_all_seen_partially_failed'
                )
            });
        }
    } catch (error) {
        toast.add({
            type: 'error',
            title: error instanceof Error ? error.message : errorTitle
        });
    }
}
