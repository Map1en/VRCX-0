import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/ui/shadcn/button';

import {
    groupDrawerEntries,
    NOTIFICATION_LIFECYCLE_ORDER,
    type NotificationLifecycleBucket
} from './notificationDrawerBuckets';
import { NotificationDrawerRow } from './NotificationDrawerRow';

const GROUP_LABEL_KEYS: Record<NotificationLifecycleBucket, string> = {
    action: 'side_panel.notification_center.group_action',
    activity: 'side_panel.notification_center.group_activity',
    system: 'side_panel.notification_center.group_system'
};

function notificationBuckets(value: unknown): Record<string, unknown>[] {
    return value && typeof value === 'object'
        ? Object.values(value).filter(
              (bucket): bucket is Record<string, unknown> =>
                  Boolean(bucket && typeof bucket === 'object')
          )
        : [];
}

export function NotificationDrawerList({
    categories,
    currentUserId,
    canInviteFromCurrentLocation,
    handlers,
    onNavigateToTable
}: any) {
    const { t } = useTranslation();
    const groups = useMemo(() => {
        const entries: any[] = [];
        for (const bucket of notificationBuckets(categories)) {
            const unseen = Array.isArray(bucket.unseen) ? bucket.unseen : [];
            const recent = Array.isArray(bucket.recent) ? bucket.recent : [];
            for (const notification of unseen) {
                entries.push({ notification, isUnseen: true });
            }
            for (const notification of recent) {
                entries.push({ notification, isUnseen: false });
            }
        }
        return groupDrawerEntries(entries);
    }, [categories]);
    const hasAny = NOTIFICATION_LIFECYCLE_ORDER.some(
        (bucket: NotificationLifecycleBucket) => groups[bucket].length > 0
    );

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
                {hasAny ? (
                    NOTIFICATION_LIFECYCLE_ORDER.map(
                        (bucket: NotificationLifecycleBucket) => {
                            const items = groups[bucket];
                            if (!items.length) {
                                return null;
                            }
                            return (
                                <div key={bucket} className="mb-2">
                                    <div className="text-muted-foreground flex items-center gap-1.5 px-1 py-1.5 text-xs font-medium tracking-wider uppercase">
                                        <span>
                                            {t(GROUP_LABEL_KEYS[bucket])}
                                        </span>
                                        <span>({items.length})</span>
                                    </div>
                                    {items.map((entry: any) => (
                                        <NotificationDrawerRow
                                            key={`${bucket}:${entry.notification.id}`}
                                            notification={entry.notification}
                                            isUnseen={entry.isUnseen}
                                            currentUserId={currentUserId}
                                            canInviteFromCurrentLocation={
                                                canInviteFromCurrentLocation
                                            }
                                            handlers={handlers}
                                        />
                                    ))}
                                </div>
                            );
                        }
                    )
                ) : (
                    <div className="text-muted-foreground flex items-center justify-center p-8 text-sm">
                        {t(
                            'side_panel.notification_center.no_new_notifications'
                        )}
                    </div>
                )}
            </div>
            <div className="flex justify-center border-t p-3">
                <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={onNavigateToTable}
                >
                    {t('side_panel.notification_center.view_more')}
                </Button>
            </div>
        </div>
    );
}
