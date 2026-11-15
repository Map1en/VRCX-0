import { describe, expect, it } from 'vitest';

import { offlinePresence, onlinePresence } from '@/test/presenceFixtures';

import { resolveFriendStatusMeta } from './friendListDisplay';

describe('friendListDisplay', () => {
    it('shows status text and indicator state for friend status badges', () => {
        const active = resolveFriendStatusMeta({
            status: 'active',
            statusDescription: '',
            $presence: onlinePresence()
        });
        expect(active.label).toBe('');
        expect(active.statusDotClassName).toBe(
            'user-status-indicator online bg-[var(--status-online)]'
        );

        const custom = resolveFriendStatusMeta({
            status: 'busy',
            statusDescription: 'Do not disturb'
        });
        expect(custom.label).toBe('Do not disturb');

        expect(resolveFriendStatusMeta(null).statusDotClassName).toBe('');
    });

    it('ranks join me, active, ask me, busy, then offline friends for sorting', () => {
        const ranks = [
            { status: 'join me', $presence: onlinePresence() },
            { status: 'active', $presence: onlinePresence() },
            { status: 'ask me', $presence: onlinePresence() },
            { status: 'busy', $presence: onlinePresence() },
            { status: 'active', $presence: offlinePresence }
        ].map((friend) => resolveFriendStatusMeta(friend).sortRank);

        expect([...ranks].sort((left, right) => left - right)).toEqual(ranks);
        expect(new Set(ranks).size).toBe(ranks.length);
    });
});
