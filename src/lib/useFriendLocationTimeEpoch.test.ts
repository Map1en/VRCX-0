import { describe, expect, it } from 'vitest';

import { resolveFriendLocationTimeEpoch } from './useFriendLocationTimeEpoch';

const entry = {
    location: 'wrld_test:1',
    sinceMs: 1_700_000_000_000,
    source: 'realtime' as const
};

describe('resolveFriendLocationTimeEpoch', () => {
    it('keeps local mode visible even when the remote friend is offline', () => {
        const localEntry = { ...entry, source: 'gameLog' as const };
        expect(
            resolveFriendLocationTimeEpoch(
                { state: 'offline' },
                localEntry,
                entry.location
            )
        ).toBe(entry.sinceMs);
        expect(
            resolveFriendLocationTimeEpoch(null, localEntry, entry.location)
        ).toBe(0);
    });

    it('returns the backend time only for an online matching friend', () => {
        expect(
            resolveFriendLocationTimeEpoch(
                { state: 'online' },
                entry,
                'wrld_test:1'
            )
        ).toBe(entry.sinceMs);
    });

    it('rejects mismatched locations', () => {
        expect(
            resolveFriendLocationTimeEpoch(
                { state: 'online' },
                entry,
                'wrld_other:2'
            )
        ).toBe(0);
    });

    it('keeps the backend time while an offline transition is pending', () => {
        const pendingFriend = {
            state: 'online',
            pendingOffline: true
        };

        expect(
            resolveFriendLocationTimeEpoch(pendingFriend, entry, entry.location)
        ).toBe(entry.sinceMs);
    });

    it('rejects offline, active, and removed friends', () => {
        expect(
            resolveFriendLocationTimeEpoch(
                { state: 'offline' },
                entry,
                entry.location
            )
        ).toBe(0);
        expect(
            resolveFriendLocationTimeEpoch(
                { state: 'active' },
                entry,
                entry.location
            )
        ).toBe(0);
        expect(
            resolveFriendLocationTimeEpoch(null, entry, entry.location)
        ).toBe(0);
    });
});
