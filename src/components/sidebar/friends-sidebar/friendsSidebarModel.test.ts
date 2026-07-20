import { describe, expect, it } from 'vitest';

import {
    readFriendRefLocation,
    readFriendStatusSource,
    resolveSidebarStatusDotClassName,
    toLegacyFriendSortRow
} from './friendsSidebarModel';

describe('friendsSidebarModel friend status source', () => {
    it('uses top-level roster presence over stale nested ref presence', () => {
        const friend = {
            id: 'usr_friend',
            displayName: 'Friend',
            state: 'online',
            stateBucket: 'online',
            location: 'wrld_live:123',
            status: 'join me',
            ref: {
                id: 'usr_friend',
                displayName: 'Friend',
                state: 'offline',
                stateBucket: 'offline',
                location: 'offline',
                status: 'active'
            }
        };

        const source = readFriendStatusSource(friend);
        const sortRow = toLegacyFriendSortRow(friend);

        expect(source).toMatchObject({
            state: 'online',
            stateBucket: 'online',
            location: 'wrld_live:123',
            status: 'join me'
        });
        expect(readFriendRefLocation(friend)).toBe('wrld_live:123');
        expect(sortRow.ref).toMatchObject({
            state: 'online',
            stateBucket: 'online',
            location: 'wrld_live:123',
            status: 'join me'
        });
    });
});

describe('friendsSidebarModel current user status dot', () => {
    const currentUser = {
        id: 'usr_self',
        status: 'active',
        state: 'online',
        stateBucket: 'online'
    };

    it('defaults to the active outline when local game state is unavailable', () => {
        expect(
            resolveSidebarStatusDotClassName(currentUser, currentUser, true)
        ).toBe('border-[var(--status-online)] bg-background');
    });

    it('uses the solid status colour while the local game is running', () => {
        expect(
            resolveSidebarStatusDotClassName(currentUser, currentUser, true, {
                isGameRunning: true
            })
        ).toBe('bg-[var(--status-online)]');
    });
});
