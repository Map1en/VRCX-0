import { describe, expect, it } from 'vitest';

import { groupsForInvitePicker } from './userDialogGroupInviteGroups';

function group(groupId: string, permissions: string[]) {
    return {
        groupId,
        name: groupId,
        shortCode: null,
        iconUrl: null,
        memberCount: null,
        permissions
    };
}

const groups = [
    group('grp_invites', ['group-invites-manage']),
    group('grp_owner', ['*']),
    group('grp_members', ['group-members-manage']),
    group('grp_none', [])
];

describe('groupsForInvitePicker', () => {
    it('keeps only invite managers and wildcard owners when permissions are available', () => {
        expect(
            groupsForInvitePicker(groups, false).map(({ groupId }) => groupId)
        ).toEqual(['grp_invites', 'grp_owner']);
    });

    it('keeps every current-account group when permissions are degraded', () => {
        expect(
            groupsForInvitePicker(groups, true).map(({ groupId }) => groupId)
        ).toEqual(['grp_invites', 'grp_owner', 'grp_members', 'grp_none']);
    });
});
