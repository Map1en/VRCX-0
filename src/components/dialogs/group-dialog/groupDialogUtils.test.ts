import { describe, expect, it } from 'vitest';

import {
    hasGroupModerationPermission,
    hasGroupPermission
} from './groupDialogUtils';

describe('group dialog permissions', () => {
    it('allows direct member permission and direct wildcard permission', () => {
        expect(
            hasGroupPermission(
                {
                    myMember: {
                        permissions: ['group-announcement-manage']
                    }
                },
                'group-announcement-manage'
            )
        ).toBe(true);

        expect(
            hasGroupPermission(
                {
                    myMember: {
                        permissions: ['*']
                    }
                },
                'group-members-manage'
            )
        ).toBe(true);
    });

    it('inherits permissions from matching member role ids only', () => {
        const group = {
            myMember: {
                permissions: [],
                roleIds: ['role_moderator']
            },
            roles: [
                {
                    id: 'role_moderator',
                    permissions: ['group-members-remove']
                },
                {
                    id: 'role_other',
                    permissions: ['group-data-manage']
                }
            ]
        };

        expect(hasGroupPermission(group, 'group-members-remove')).toBe(true);
        expect(hasGroupPermission(group, 'group-data-manage')).toBe(false);
    });

    it('inherits wildcard permissions from a matching role', () => {
        expect(
            hasGroupPermission(
                {
                    myMember: {
                        roleIds: ['role_owner']
                    },
                    roles: [
                        {
                            id: 'role_owner',
                            permissions: ['*']
                        }
                    ]
                },
                'group-audit-view'
            )
        ).toBe(true);
    });

    it('denies malformed member and role permission payloads', () => {
        expect(hasGroupPermission(null, 'group-members-manage')).toBe(false);
        expect(
            hasGroupPermission(
                {
                    myMember: {
                        permissions: 'group-members-manage',
                        roleIds: 'role_moderator'
                    },
                    roles: [
                        {
                            id: 'role_moderator',
                            permissions: ['group-members-manage']
                        }
                    ]
                },
                'group-members-manage'
            )
        ).toBe(false);
    });

    it('detects any moderation permission but ignores non-moderation permissions', () => {
        expect(
            hasGroupModerationPermission({
                myMember: {
                    permissions: ['group-bans-manage']
                }
            })
        ).toBe(true);

        expect(
            hasGroupModerationPermission({
                myMember: {
                    permissions: ['group-members-remove']
                }
            })
        ).toBe(true);

        expect(
            hasGroupModerationPermission({
                myMember: {
                    permissions: ['group-roles-assign']
                }
            })
        ).toBe(false);

        expect(
            hasGroupModerationPermission({
                myMember: {
                    permissions: ['group-announcement-manage']
                }
            })
        ).toBe(false);
    });
});
