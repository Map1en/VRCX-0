import { describe, expect, it } from 'vitest';

import { resolveSidebarStatusDotClassName } from '@/components/friends/friendStatusModel';
import {
    activePresence,
    onlinePresence,
    pendingPresence
} from '@/test/presenceFixtures';

import { buildSameInstanceGroups, sortRows } from './friendsSidebarModel';

describe('friendsSidebarModel time in instance sorting', () => {
    it('orders online friends by their stay clock and keeps possibly offline friends last', () => {
        const friend = (id: string, pending = false) => ({
            id,
            displayName: id,
            $presence: pending
                ? pendingPresence('wrld_a:1')
                : onlinePresence('wrld_a:1')
        });
        const staySince: Record<string, number> = {
            usr_long: 1_000,
            usr_short: 5_000,
            usr_pending: 9_000
        };

        expect(
            sortRows(
                [
                    friend('usr_long'),
                    friend('usr_pending', true),
                    friend('usr_short')
                ],
                { sidebarSortMethod1: 'Sort by Time in Instance' },
                { staySinceMs: (friendId) => staySince[friendId] }
            ).map((row) => row.id)
        ).toEqual(['usr_short', 'usr_long', 'usr_pending']);
    });
});

describe('friendsSidebarModel same-instance groups', () => {
    it('groups one friend with the current user but not a solo friend elsewhere', () => {
        const currentLocation = 'wrld_aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa:123';
        const otherLocation = 'wrld_bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb:456';
        const friendWithCurrentUser = {
            id: 'usr_1',
            displayName: 'With current user',
            $presence: onlinePresence(currentLocation),
            $location_at: 1
        };
        const soloElsewhere = {
            id: 'usr_2',
            displayName: 'Solo elsewhere',
            $presence: onlinePresence(otherLocation),
            $location_at: 1
        };

        expect(
            buildSameInstanceGroups(
                [friendWithCurrentUser, soloElsewhere],
                {},
                { location: currentLocation }
            )
        ).toEqual([
            {
                location: currentLocation,
                rows: [friendWithCurrentUser],
                isCurrentInstance: true
            }
        ]);
    });
});

describe('friendsSidebarModel status dot', () => {
    it('uses the solid status while online', () => {
        const friend = {
            id: 'usr_friend',
            status: 'busy',
            $presence: onlinePresence('wrld_local:1')
        };

        expect(resolveSidebarStatusDotClassName(friend)).toBe(
            'user-status-indicator busy bg-[var(--status-busy)]'
        );
    });

    it('uses the hollow status while only active', () => {
        const friend = {
            id: 'usr_friend',
            status: 'busy',
            $presence: activePresence()
        };

        expect(resolveSidebarStatusDotClassName(friend)).toBe(
            'user-status-indicator busy border-[var(--status-busy)] bg-background'
        );
    });

    it('shows a pending friend as offline', () => {
        const friend = {
            id: 'usr_friend',
            status: 'join me',
            $presence: pendingPresence()
        };

        expect(resolveSidebarStatusDotClassName(friend)).toBe(
            'user-status-indicator offline bg-[var(--status-offline)]'
        );
    });
});
