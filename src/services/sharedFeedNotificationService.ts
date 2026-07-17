import i18n from '@/services/i18nService';
import { normalizeString } from '@/shared/utils/string';
import { useNotificationStore } from '@/state/notificationStore';

type SharedFeedNotificationEntry = Record<string, unknown> & {
    type?: unknown;
    userId?: unknown;
    displayName?: unknown;
    worldName?: unknown;
    avatarName?: unknown;
    videoName?: unknown;
    notyName?: unknown;
    message?: unknown;
    status?: unknown;
    statusDescription?: unknown;
    trustLevel?: unknown;
};

export async function pushSharedFeedNotification(
    entry?: SharedFeedNotificationEntry | null
): Promise<void> {
    const type = normalizeString(entry?.type) || 'Feed';
    const displayName =
        normalizeString(entry?.displayName || entry?.userId) || 'Unknown';
    const detail =
        entry?.worldName ||
        entry?.avatarName ||
        entry?.videoName ||
        entry?.notyName ||
        entry?.message ||
        entry?.status ||
        entry?.statusDescription ||
        entry?.trustLevel ||
        '';
    useNotificationStore.getState().pushNotification({
        level: 'info',
        title: i18n.t(
            'service.shared_feed_notification_service.dynamic.feed_value',
            { value: type }
        ),
        message: [displayName, detail].filter(Boolean).join(' - ')
    });
}
