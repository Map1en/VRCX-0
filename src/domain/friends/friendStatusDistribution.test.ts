import { describe, expect, it } from 'vitest';

import { buildFriendStatusDistribution } from './friendStatusDistribution';

function countsByKey(
    distribution: ReturnType<typeof buildFriendStatusDistribution>
) {
    return Object.fromEntries(
        distribution.entries.map((entry) => [entry.key, entry.count])
    );
}

describe('friendStatusDistribution', () => {
    it('groups only online ids into the four requested status colours', () => {
        const distribution = buildFriendStatusDistribution({
            onlineIds: [
                'usr_join',
                'usr_online',
                'usr_ask',
                'usr_busy',
                'usr_join_alias',
                'usr_ask_alias',
                'usr_unknown',
                'usr_missing'
            ],
            friendsById: {
                usr_join: { status: 'join me' },
                usr_online: { status: 'active' },
                usr_ask: { status: 'ask me' },
                usr_busy: { status: 'busy' },
                usr_join_alias: { status: 'joinme' },
                usr_ask_alias: { status: 'askme' },
                usr_unknown: { status: 'unexpected' }
            }
        });

        expect(distribution.total).toBe(8);
        expect(countsByKey(distribution)).toEqual({
            'join-me': 2,
            online: 3,
            'ask-me': 2,
            busy: 1
        });
        expect(
            distribution.entries.reduce(
                (total, entry) => total + entry.percentage,
                0
            )
        ).toBeCloseTo(100);
    });

    it('deduplicates and normalizes ids without accepting other roster buckets', () => {
        const distribution = buildFriendStatusDistribution({
            onlineIds: [' usr_join ', 'usr_join', '', null],
            friendsById: {
                usr_join: { status: 'join me' },
                usr_active_bucket: { status: 'ask me' },
                usr_offline_bucket: { status: 'busy' }
            }
        });

        expect(distribution.total).toBe(1);
        expect(countsByKey(distribution)).toEqual({
            'join-me': 1,
            online: 0,
            'ask-me': 0,
            busy: 0
        });
    });

    it('returns four stable zero-value entries for an empty online roster', () => {
        const distribution = buildFriendStatusDistribution({});

        expect(distribution.total).toBe(0);
        expect(distribution.entries.map((entry) => entry.key)).toEqual([
            'join-me',
            'online',
            'ask-me',
            'busy'
        ]);
        expect(
            distribution.entries.every((entry) => entry.percentage === 0)
        ).toBe(true);
    });
});
