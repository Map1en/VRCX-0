import { ChevronRightIcon } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { NotificationRow } from '@/repositories/notificationPersistenceRepository';
import type {
    NotificationBucket,
    NotificationCategories
} from '@/state/vrcNotificationStore';

import { NotificationGroupSummary } from '../components/NotificationGroupSummary';
import {
    foldAdjacentNotifications,
    useExpandedNotificationGroups
} from '../notificationGroups';
import type { NotificationRowActionHandlers } from '../notificationRowActions';
import {
    groupDrawerEntries,
    NOTIFICATION_LIFECYCLE_ORDER,
    type NotificationDrawerEntry,
    type NotificationLifecycleBucket
} from './notificationDrawerBuckets';
import { NotificationDrawerRow } from './NotificationDrawerRow';

export type NotificationDrawerHandlers = NotificationRowActionHandlers & {
    onDeleteNotification(notification: NotificationRow): void | Promise<void>;
    onJoinQueueReady(notification: NotificationRow): void | Promise<void>;
};

type NotificationDrawerListProps = {
    canInviteFromCurrentLocation: boolean;
    categories: NotificationCategories;
    currentUserId?: string;
    handlers: NotificationDrawerHandlers;
    onNavigateToTable(): void;
};

const GROUP_LABEL_KEYS: Record<NotificationLifecycleBucket, string> = {
    action: 'side_panel.notification_center.group_action',
    activity: 'side_panel.notification_center.group_activity',
    system: 'side_panel.notification_center.group_system'
};

function notificationBuckets(
    value: NotificationCategories
): NotificationBucket[] {
    return Object.values(value);
}

export function NotificationDrawerList({
    categories,
    currentUserId,
    canInviteFromCurrentLocation,
    handlers,
    onNavigateToTable
}: NotificationDrawerListProps) {
    const { t } = useTranslation();
    const groups = useMemo(() => {
        const entries: NotificationDrawerEntry[] = [];
        for (const bucket of notificationBuckets(categories)) {
            for (const notification of bucket.unseen) {
                entries.push({ notification, isUnseen: true });
            }
            for (const notification of bucket.recent) {
                entries.push({ notification, isUnseen: false });
            }
        }
        return groupDrawerEntries(entries);
    }, [categories]);
    const { expanded, toggle } = useExpandedNotificationGroups();
    const hasAny = NOTIFICATION_LIFECYCLE_ORDER.some(
        (bucket: NotificationLifecycleBucket) => groups[bucket].length > 0
    );

    function renderRow(
        bucket: NotificationLifecycleBucket,
        entry: NotificationDrawerEntry
    ) {
        return (
            <NotificationDrawerRow
                key={`${bucket}:${entry.notification.id}`}
                notification={entry.notification}
                isUnseen={entry.isUnseen}
                currentUserId={currentUserId}
                canInviteFromCurrentLocation={canInviteFromCurrentLocation}
                handlers={handlers}
            />
        );
    }

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto py-2">
                {hasAny ? (
                    NOTIFICATION_LIFECYCLE_ORDER.map(
                        (bucket: NotificationLifecycleBucket) => {
                            const items = groups[bucket];
                            if (!items.length) {
                                return null;
                            }
                            return (
                                <div key={bucket} className="mb-2">
                                    <div className="text-muted-foreground flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium">
                                        <span>
                                            {t(GROUP_LABEL_KEYS[bucket])}
                                        </span>
                                        <span>({items.length})</span>
                                    </div>
                                    {foldAdjacentNotifications(
                                        items,
                                        (entry) => entry.notification
                                    ).map((fold) => {
                                        if (fold.kind === 'single') {
                                            return renderRow(bucket, fold.item);
                                        }
                                        const isExpanded = expanded.has(
                                            fold.runKey
                                        );
                                        return (
                                            <div
                                                key={`${bucket}:group:${fold.runKey}`}
                                            >
                                                <NotificationGroupSummary
                                                    variant="drawer"
                                                    rows={fold.items.map(
                                                        (entry) =>
                                                            entry.notification
                                                    )}
                                                    unseen={fold.items.some(
                                                        (entry) =>
                                                            entry.isUnseen
                                                    )}
                                                    expanded={isExpanded}
                                                    onToggle={() =>
                                                        toggle(fold.runKey)
                                                    }
                                                />
                                                {isExpanded ? (
                                                    <div className="border-border/60 ml-6 border-l">
                                                        {fold.items.map(
                                                            (entry) =>
                                                                renderRow(
                                                                    bucket,
                                                                    entry
                                                                )
                                                        )}
                                                    </div>
                                                ) : null}
                                            </div>
                                        );
                                    })}
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
                <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground flex w-full items-center justify-center gap-1 px-4 py-3 text-xs font-medium transition-colors hover:bg-(--state-hover-surface)"
                    onClick={onNavigateToTable}
                >
                    {t('side_panel.notification_center.view_more')}
                    <ChevronRightIcon className="size-3.5" />
                </button>
            </div>
        </div>
    );
}
