import { useCallback, useState } from 'react';

import type { NotificationRow } from './notificationPageTypes';

export type NotificationFold<T> =
    | { kind: 'single'; item: T }
    | { kind: 'group'; key: string; runKey: string; items: T[] };

type NotificationRun<T> = { key: string; gathered: boolean; items: T[] };

function notificationGroupKey(notification: NotificationRow): string {
    return typeof notification.groupKey === 'string'
        ? notification.groupKey
        : '';
}

export function foldNotifications<T>(
    items: readonly T[],
    rowOf: (item: T) => NotificationRow,
    gathersAcrossGaps: (item: T) => boolean = () => false
): NotificationFold<T>[] {
    const runs: NotificationRun<T>[] = [];
    const gatheredRuns = new Map<string, NotificationRun<T>>();
    for (const item of items) {
        const key = notificationGroupKey(rowOf(item));
        const gathered = key !== '' && gathersAcrossGaps(item);
        const gatheredRun = gathered ? gatheredRuns.get(key) : undefined;
        if (gatheredRun) {
            gatheredRun.items.push(item);
            continue;
        }
        const current = runs.at(-1);
        if (key && !gathered && current?.key === key && !current.gathered) {
            current.items.push(item);
            continue;
        }
        const run = { key, gathered, items: [item] };
        runs.push(run);
        if (gathered) {
            gatheredRuns.set(key, run);
        }
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
