import { describe, expect, it } from 'vitest';

import { checkCanInvite, checkCanInviteSelf } from './invite.js';

describe('invite permissions', () => {
    it('allows invite actions for public, group, and owned private instances', () => {
        const deps = {
            currentUserId: 'usr_me',
            lastLocationStr: '',
            cachedInstances: new Map()
        };

        expect(checkCanInvite('wrld_public:12345', deps)).toBe(true);
        expect(checkCanInvite(
            'wrld_group:group-room~group(grp_team)~groupAccessType(plus)',
            deps
        )).toBe(true);
        expect(checkCanInvite('wrld_private:12345~private(usr_me)', deps)).toBe(true);
    });

    it('blocks invite actions for closed or inaccessible private instances', () => {
        const friendsPlusLocation = 'wrld_hidden:12345~hidden(usr_owner)';
        const deps = {
            currentUserId: 'usr_me',
            lastLocationStr: '',
            cachedInstances: new Map([
                ['wrld_public:closed', { closedAt: '2024-01-01T00:00:00Z' }]
            ])
        };

        expect(checkCanInvite('wrld_public:closed', deps)).toBe(false);
        expect(checkCanInvite('wrld_friends:12345~friends(usr_owner)', deps)).toBe(false);
        expect(checkCanInvite('wrld_private:12345~private(usr_owner)', deps)).toBe(false);
        expect(checkCanInvite(friendsPlusLocation, deps)).toBe(false);
        expect(checkCanInvite(friendsPlusLocation, {
            ...deps,
            lastLocationStr: friendsPlusLocation
        })).toBe(true);
    });

    it('allows self-invite only when the target instance is joinable by the current user', () => {
        const deps = {
            currentUserId: 'usr_me',
            friends: new Map([['usr_friend', {}]]),
            cachedInstances: new Map()
        };

        expect(checkCanInviteSelf('wrld_private:12345~private(usr_me)', deps)).toBe(true);
        expect(checkCanInviteSelf('wrld_friends:12345~friends(usr_friend)', deps)).toBe(true);
        expect(checkCanInviteSelf('wrld_friends:12345~friends(usr_stranger)', deps)).toBe(false);
        expect(checkCanInviteSelf('wrld_public:closed', {
            ...deps,
            cachedInstances: new Map([
                ['wrld_public:closed', { closedAt: '2024-01-01T00:00:00Z' }]
            ])
        })).toBe(false);
    });
});
