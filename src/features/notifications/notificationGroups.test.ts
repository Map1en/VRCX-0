import { describe, expect, it } from 'vitest';

import { foldAdjacentNotifications } from './notificationGroups';
import type { NotificationRow } from './notificationPageTypes';

function row(id: string, groupKey?: string): NotificationRow {
    return { id, type: 'group.announcement', groupKey };
}

function shape(rows: NotificationRow[]) {
    return foldAdjacentNotifications(rows, (item) => item).map((fold) =>
        fold.kind === 'group'
            ? fold.items.map((item) => item.id)
            : String(fold.item.id)
    );
}

describe('foldAdjacentNotifications', () => {
    it('folds only adjacent rows that share a backend group key', () => {
        expect(
            shape([
                row('a1', 'group.announcement:grp_a:2026-10-29'),
                row('a2', 'group.announcement:grp_a:2026-10-29'),
                row('invite'),
                row('a3', 'group.announcement:grp_a:2026-10-29'),
                row('b1', 'group.announcement:grp_b:2026-10-29'),
                row('b2', 'group.announcement:grp_b:2026-10-29'),
                row('b3', 'group.announcement:grp_b:2026-10-29')
            ])
        ).toEqual([['a1', 'a2'], 'invite', 'a3', ['b1', 'b2', 'b3']]);
    });

    it('keeps rows without a group key apart even when adjacent', () => {
        expect(shape([row('x'), row('y'), row('z', '')])).toEqual([
            'x',
            'y',
            'z'
        ]);
    });

    it('gives separate runs of the same key distinct run keys', () => {
        const key = 'group.announcement:grp_a:2026-10-29';
        const runKeys = foldAdjacentNotifications(
            [
                row('a1', key),
                row('a2', key),
                row('x'),
                row('a3', key),
                row('a4', key)
            ],
            (item) => item
        ).flatMap((fold) => (fold.kind === 'group' ? [fold.runKey] : []));

        expect(runKeys).toEqual([`${key}:a1`, `${key}:a3`]);
    });
});
