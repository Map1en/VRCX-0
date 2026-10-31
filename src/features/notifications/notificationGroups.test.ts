import { describe, expect, it } from 'vitest';

import { foldNotifications } from './notificationGroups';
import type { NotificationRow } from './notificationPageTypes';

function row(id: string, groupKey?: string, seen = true): NotificationRow {
    return { id, type: 'group.announcement', groupKey, seen };
}

function shape(rows: NotificationRow[]) {
    return foldNotifications(
        rows,
        (item) => item,
        (item) => item.seen === false
    ).map((fold) =>
        fold.kind === 'group'
            ? fold.items.map((item) => item.id)
            : String(fold.item.id)
    );
}

describe('foldNotifications', () => {
    it('folds only adjacent rows that share a backend group key', () => {
        expect(
            shape([
                row('a1', 'group.announcement:grp_a'),
                row('a2', 'group.announcement:grp_a'),
                row('invite'),
                row('a3', 'group.announcement:grp_a'),
                row('b1', 'group.announcement:grp_b'),
                row('b2', 'group.announcement:grp_b'),
                row('b3', 'group.announcement:grp_b')
            ])
        ).toEqual([['a1', 'a2'], 'invite', 'a3', ['b1', 'b2', 'b3']]);
    });

    it('keeps rows without a group key apart even when adjacent', () => {
        expect(
            shape([row('x'), row('y'), row('z', ''), row('u', '', false)])
        ).toEqual(['x', 'y', 'z', 'u']);
    });

    it('gathers unseen rows of the same key into the first one across gaps', () => {
        expect(
            shape([
                row('a1', 'group.announcement:grp_a', false),
                row('b1', 'group.announcement:grp_b', false),
                row('a2', 'group.announcement:grp_a', false),
                row('a3', 'group.announcement:grp_a'),
                row('a4', 'group.announcement:grp_a'),
                row('b2', 'group.announcement:grp_b', false)
            ])
        ).toEqual([
            ['a1', 'a2'],
            ['b1', 'b2'],
            ['a3', 'a4']
        ]);
    });

    it('gives separate runs of the same key distinct run keys', () => {
        const key = 'group.announcement:grp_a';
        const runKeys = foldNotifications(
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
