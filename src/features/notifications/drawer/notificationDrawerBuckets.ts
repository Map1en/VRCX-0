import type { NotificationRow } from '@/repositories/notificationPersistenceRepository';
import { getNotificationTs } from '@/shared/utils/notificationCategory';
import {
    getNotificationLifecycleBucket,
    NOTIFICATION_LIFECYCLE_ORDER,
    type NotificationLifecycleBucket
} from '@/shared/utils/notificationLifecycle';

export type NotificationDrawerEntry = {
    notification: NotificationRow;
    isUnseen: boolean;
};

export type NotificationDrawerGroups = Record<
    NotificationLifecycleBucket,
    NotificationDrawerEntry[]
>;

export function groupDrawerEntries(
    entries: readonly NotificationDrawerEntry[]
): NotificationDrawerGroups {
    const groups: NotificationDrawerGroups = {
        action: [],
        activity: [],
        system: []
    };
    for (const entry of entries) {
        const bucket = getNotificationLifecycleBucket(
            entry?.notification?.type
        );
        groups[bucket].push(entry);
    }
    for (const bucket of NOTIFICATION_LIFECYCLE_ORDER) {
        groups[bucket].sort((left, right) => {
            if (bucket === 'action') {
                const leftQueue =
                    left.notification?.type === 'group.queueReady' ? 0 : 1;
                const rightQueue =
                    right.notification?.type === 'group.queueReady' ? 0 : 1;
                if (leftQueue !== rightQueue) {
                    return leftQueue - rightQueue;
                }
            }
            return (
                getNotificationTs(right.notification) -
                getNotificationTs(left.notification)
            );
        });
    }
    return groups;
}

export {
    getNotificationLifecycleBucket,
    NOTIFICATION_LIFECYCLE_ORDER,
    type NotificationLifecycleBucket
};
