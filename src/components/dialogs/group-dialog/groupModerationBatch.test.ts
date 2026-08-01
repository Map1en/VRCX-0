import { describe, expect, it } from 'vitest';

import { buildGroupModerationBatchInput } from './groupModerationBatch';

describe('buildGroupModerationBatchInput', () => {
    it('builds one explicit role-operation batch without existing roles', () => {
        expect(
            buildGroupModerationBatchInput({
                action: { type: 'addRoles' },
                expectedEndpoint: 'https://api.example.test',
                expectedOwnerUserId: 'usr_self',
                groupId: 'grp_test',
                roleIds: ['grol_existing', 'grol_new', 'grol_new'],
                rows: [
                    {
                        userId: 'usr_a',
                        roleIds: ['grol_existing']
                    },
                    {
                        user: {
                            id: 'usr_b',
                            roleIds: []
                        }
                    }
                ]
            })
        ).toEqual({
            action: { type: 'addRoles' },
            expectedEndpoint: 'https://api.example.test',
            expectedOwnerUserId: 'usr_self',
            groupId: 'grp_test',
            targets: [
                {
                    userId: 'usr_a',
                    roleIds: ['grol_new']
                },
                {
                    userId: 'usr_b',
                    roleIds: ['grol_existing', 'grol_new']
                }
            ]
        });
    });

    it('keeps non-role actions free of role payloads', () => {
        expect(
            buildGroupModerationBatchInput({
                action: { type: 'saveNote', note: 'Reviewed' },
                expectedEndpoint: 'https://api.example.test',
                expectedOwnerUserId: 'usr_self',
                groupId: 'grp_test',
                roleIds: ['grol_ignored'],
                rows: [{ userId: 'usr_target' }]
            }).targets
        ).toEqual([{ userId: 'usr_target', roleIds: [] }]);
    });
});
