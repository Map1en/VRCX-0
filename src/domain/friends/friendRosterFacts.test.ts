import { describe, expect, it } from 'vitest';

import {
    applyFactDerivedFields,
    mergeRosterFriendFacts
} from './friendRosterFacts';
import type { FriendRecord } from './friendRosterTypes';

type UserFact = NonNullable<Parameters<typeof applyFactDerivedFields>[1]>;

function friend(patch: Partial<FriendRecord> = {}): FriendRecord {
    return {
        id: 'usr_1',
        displayName: 'Friend',
        tags: [],
        state: 'offline',
        stateBucket: 'offline',
        $trustLevel: 'Visitor',
        $friendNumber: 0,
        $trustClass: 'x-tag-untrusted',
        $trustSortNum: 0,
        $isModerator: false,
        $isTroll: false,
        $isProbableTroll: false,
        $platform: '',
        ...patch
    };
}

function fact(patch: Partial<UserFact>): UserFact {
    return {
        id: 'usr_1',
        endpoint: 'api',
        updatedAt: '2026-01-01T00:00:00.000Z',
        ...patch
    };
}

describe('friendRosterFacts', () => {
    it('lets UserFact win for derived trust/platform fields', () => {
        const rosterFriend = friend({
            $trustClass: 'x-tag-untrusted',
            $trustLevel: 'Visitor',
            $platform: ''
        });
        const merged = applyFactDerivedFields(
            rosterFriend,
            fact({
                $trustClass: 'x-tag-veteran',
                $trustLevel: 'Trusted User',
                $platform: 'standalonewindows'
            })
        );
        expect(merged.$trustClass).toBe('x-tag-veteran');
        expect(merged.$trustLevel).toBe('Trusted User');
        expect(merged.$platform).toBe('standalonewindows');
    });

    it('keeps the roster value as first-frame fallback when UserFact is missing', () => {
        const rosterFriend = friend({ $trustClass: 'x-tag-veteran' });
        expect(applyFactDerivedFields(rosterFriend, null)).toBe(rosterFriend);
        expect(applyFactDerivedFields(rosterFriend, undefined)).toBe(
            rosterFriend
        );
    });

    it('does not overwrite a roster field the UserFact lacks', () => {
        const rosterFriend = friend({ $trustClass: 'x-tag-veteran' });
        const merged = applyFactDerivedFields(
            rosterFriend,
            fact({
                $platform: 'standalonewindows'
            })
        );
        expect(merged.$trustClass).toBe('x-tag-veteran');
        expect(merged.$platform).toBe('standalonewindows');
    });

    it('returns the same friend reference when nothing changed', () => {
        const rosterFriend = friend({ $trustClass: 'x-tag-veteran' });
        const merged = applyFactDerivedFields(
            rosterFriend,
            fact({
                $trustClass: 'x-tag-veteran'
            })
        );
        expect(merged).toBe(rosterFriend);
    });

    it('returns the same map reference when no friend changed', () => {
        const friendsById = {
            usr_1: friend({ $trustClass: 'x-tag-veteran' })
        };
        const factsById = {
            usr_1: fact({ $trustClass: 'x-tag-veteran' })
        };
        expect(mergeRosterFriendFacts(friendsById, factsById)).toBe(
            friendsById
        );
    });

    it('merges only changed friends into a new map', () => {
        const stable = friend({ $trustClass: 'x-tag-veteran' });
        const friendsById = {
            usr_1: stable,
            usr_2: friend({ id: 'usr_2', $trustClass: 'x-tag-untrusted' })
        };
        const factsById = {
            usr_2: fact({ id: 'usr_2', $trustClass: 'x-tag-trusted' })
        };
        const merged = mergeRosterFriendFacts(friendsById, factsById);
        expect(merged).not.toBe(friendsById);
        expect(merged.usr_1).toBe(stable);
        expect(merged.usr_2.$trustClass).toBe('x-tag-trusted');
    });
});
