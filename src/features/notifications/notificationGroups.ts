import { useCallback, useState } from 'react';

import type { NotificationRow } from './notificationPageTypes';

export type NotificationFold<T> =
    | { kind: 'single'; item: T }
    | { kind: 'group'; key: string; runKey: string; items: T[] };

function notificationGroupKey(notification: NotificationRow): string {
    return typeof notification.groupKey === 'string'
        ? notification.groupKey
        : '';
}

export function foldAdjacentNotifications<T>(
    items: readonly T[],
    rowOf: (item: T) => NotificationRow
): NotificationFold<T>[] {
    const runs: { key: string; items: T[] }[] = [];
    for (const item of items) {
        const key = notificationGroupKey(rowOf(item));
        const current = runs.at(-1);
        if (key && current?.key === key) {
            current.items.push(item);
            continue;
        }
        runs.push({ key, items: [item] });
    }
    return runs.map((run) =>
        run.key && run.items.length > 1
            ? {
                  kind: 'group',
                  key: run.key,
                  runKey: `${run.key}:${String(rowOf(run.items[0]).id ?? '')}`,
                  items: run.items
              }
            : { kind: 'single', item: run.items[0] }
    );
}

export function useExpandedNotificationGroups() {
    const [expanded, setExpanded] = useState<ReadonlySet<string>>(
        () => new Set()
    );
    const toggle = useCallback((key: string) => {
        setExpanded((current) => {
            const next = new Set(current);
            if (!next.delete(key)) {
                next.add(key);
            }
            return next;
        });
    }, []);
    return { expanded, toggle };
}
