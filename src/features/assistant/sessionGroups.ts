import type { SessionSummary } from '@/domain/assistant/types';

export type SessionGroupKey =
    | 'pinned'
    | 'today'
    | 'yesterday'
    | 'week'
    | 'older';

const DAY_MS = 86_400_000;
const GROUP_ORDER: SessionGroupKey[] = [
    'pinned',
    'today',
    'yesterday',
    'week',
    'older'
];

function groupOf(session: SessionSummary, todayStart: number): SessionGroupKey {
    if (session.pinned) {
        return 'pinned';
    }
    const updated = Date.parse(session.updatedAt);
    if (updated >= todayStart) {
        return 'today';
    }
    if (updated >= todayStart - DAY_MS) {
        return 'yesterday';
    }
    if (updated >= todayStart - 6 * DAY_MS) {
        return 'week';
    }
    return 'older';
}

export function groupSessions(
    sessions: readonly SessionSummary[],
    now: Date
): Array<{ key: SessionGroupKey; sessions: SessionSummary[] }> {
    const todayStart = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate()
    ).getTime();
    const grouped = new Map<SessionGroupKey, SessionSummary[]>();
    for (const session of sessions) {
        const key = groupOf(session, todayStart);
        grouped.set(key, [...(grouped.get(key) ?? []), session]);
    }
    return GROUP_ORDER.flatMap((key) => {
        const members = grouped.get(key);
        return members ? [{ key, sessions: members }] : [];
    });
}
