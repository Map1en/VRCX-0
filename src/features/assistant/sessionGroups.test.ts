import { describe, expect, it } from 'vitest';

import type { SessionSummary } from '@/domain/assistant/types';

import { groupSessions } from './sessionGroups';

function session(id: string, updatedAt: Date, pinned = false): SessionSummary {
    return {
        id,
        title: id,
        pinned,
        busy: false,
        updatedAt: updatedAt.toISOString()
    };
}

describe('groupSessions', () => {
    it('puts pinned first, then buckets by local day, keeping list order', () => {
        const now = new Date(2026, 10, 3, 9, 0);
        const at = (days: number, hour = 12) =>
            new Date(2026, 10, 3 - days, hour);

        const groups = groupSessions(
            [
                session('today-late', at(0, 8)),
                session('pinned-old', at(40), true),
                session('today-early', at(0, 0)),
                session('yesterday', at(1, 23)),
                session('six-days', at(6, 1)),
                session('seven-days', at(7, 23))
            ],
            now
        );

        expect(
            groups.map((group) => [
                group.key,
                group.sessions.map((item) => item.id)
            ])
        ).toEqual([
            ['pinned', ['pinned-old']],
            ['today', ['today-late', 'today-early']],
            ['yesterday', ['yesterday']],
            ['week', ['six-days']],
            ['older', ['seven-days']]
        ]);
    });
});
