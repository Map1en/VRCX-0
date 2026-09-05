import { beforeEach, describe, expect, it, vi } from 'vitest';

const tauriMock = vi.hoisted(() => ({
    commands: {
        appVrchatGroupGet: vi.fn(),
        appVrchatGroupUserInstancesGet: vi.fn(),
        appVrchatGroupUserGroupsGet: vi.fn(),
        appVrchatGroupLogsGet: vi.fn()
    }
}));

vi.mock('@/platform/tauri/bindings', () => ({ commands: tauriMock.commands }));

import * as groupProfileExports from './groupProfileRepository';
import type {
    GroupAuditLogRow,
    GroupMemberRow
} from './groupProfileRepository';

const { default: groupProfileRepository, normalize } = groupProfileExports;

describe('GroupProfileRepository', () => {
    beforeEach(() => {
        for (const command of Object.values(tauriMock.commands)) {
            command.mockReset();
            command.mockResolvedValue({
                status: 200,
                data: '{"ok":true}'
            });
        }
    });

    it('keeps the frozen facade aligned with public named exports', () => {
        expect(Object.isFrozen(groupProfileRepository)).toBe(true);
        expect(groupProfileExports.default).toBe(groupProfileRepository);
        expect(
            Object.keys(groupProfileExports)
                .filter((key) => key !== 'default')
                .toSorted()
        ).toEqual(
            Object.keys(groupProfileRepository)
                .filter((key) => key !== 'fetchGroupProfile')
                .toSorted()
        );
    });

    it('normalizes group profile fields, counts, roles, and public group URL', () => {
        expect(
            normalize({
                groupId: ' grp_123 ',
                name: ' Test Group ',
                description: '  Description  ',
                rules: '  Rules  ',
                shortCode: 'VRCX',
                discriminator: '1234',
                bannerUrl: ' banner.png ',
                iconUrl: ' icon.png ',
                memberCount: '42',
                onlineMemberCount: '7',
                ownerId: ' usr_owner ',
                privacy: ' public ',
                membershipStatus: ' member ',
                languages: [' eng ', '', null],
                links: [' https://example.test ', undefined],
                tags: [' tag ', ''],
                roles: [
                    {
                        id: ' role_1 ',
                        name: ' Admin ',
                        description: ' Full access ',
                        permissions: [' group-members-manage ', null, '']
                    },
                    null
                ]
            })
        ).toMatchObject({
            id: 'grp_123',
            name: 'Test Group',
            description: 'Description',
            rules: 'Rules',
            shortCode: 'VRCX',
            discriminator: '1234',
            url: 'https://vrc.group/VRCX.1234',
            bannerUrl: 'banner.png',
            iconUrl: 'icon.png',
            memberCount: 42,
            onlineMemberCount: 7,
            ownerId: 'usr_owner',
            privacy: 'public',
            membershipStatus: 'member',
            languages: ['eng'],
            links: ['https://example.test'],
            tags: ['tag'],
            roles: [
                {
                    id: 'role_1',
                    name: 'Admin',
                    description: 'Full access',
                    permissions: ['group-members-manage']
                }
            ]
        });
    });

    it('preserves nullable membership data and gallery role visibility', () => {
        expect(
            normalize({
                id: 'grp_redacted',
                name: 'Group',
                createdAt: { malformed: true },
                updatedAt: 42,
                myMember: null,
                memberCountSyncedAt: null,
                galleries: [
                    {
                        id: 'gal_redacted',
                        name: 'Gallery',
                        roleIdsToView: null
                    }
                ]
            })
        ).toMatchObject({
            id: 'grp_redacted',
            createdAt: '',
            updatedAt: '',
            myMember: null,
            memberCountSyncedAt: '',
            galleries: [{ id: 'gal_redacted', roleIdsToView: null }]
        });
    });

    it('preserves the wrapped group instance response shape', async () => {
        const wrappedRows = [
            {
                id: 'instance_wrapped',
                location: 'wrld_redacted:instance_wrapped~group(grp_redacted)'
            }
        ];
        tauriMock.commands.appVrchatGroupUserInstancesGet.mockResolvedValue({
            status: 200,
            data: JSON.stringify({ instances: wrappedRows })
        });

        await expect(
            groupProfileRepository.getUsersGroupInstances({
                userId: 'usr_redacted'
            })
        ).resolves.toMatchObject({ json: { instances: wrappedRows } });
    });

    it('models member nullability and open audit-log data without real account data', () => {
        const member = {
            acceptedByDisplayName: null,
            acceptedById: 'usr_actor_redacted',
            bannedAt: null,
            createdAt: '2026-01-01T00:00:00.000Z',
            groupId: 'grp_redacted',
            hasJoinedFromPurchase: false,
            id: 'gmem_redacted',
            isRepresenting: false,
            isSubscribedToAnnouncements: true,
            isSubscribedToEventAnnouncements: false,
            joinedAt: '2026-01-01T00:00:00.000Z',
            lastPostReadAt: null,
            managerNotes: '',
            membershipStatus: 'member',
            mRoleIds: [],
            roleIds: ['grol_redacted'],
            user: {
                currentAvatarImageUrl: '',
                currentAvatarTags: [],
                currentAvatarThumbnailImageUrl: '',
                displayName: 'Member',
                iconUrl: '',
                id: 'usr_member_redacted',
                profilePicOverride: '',
                thumbnailUrl: '',
                userIcon: ''
            },
            userId: 'usr_member_redacted',
            visibility: 'visible'
        } satisfies GroupMemberRow;
        const log = {
            actorDisplayName: 'Actor',
            actorId: 'usr_actor_redacted',
            created_at: '2026-01-01T00:00:00.000Z',
            data: {},
            description: 'Member joined',
            eventType: 'group.member.join',
            groupId: 'grp_redacted',
            id: 'gaud_redacted',
            targetId: 'usr_member_redacted'
        } satisfies GroupAuditLogRow;

        expect(member.acceptedByDisplayName).toBeNull();
        expect(member.lastPostReadAt).toBeNull();
        expect(log.data).toEqual({});
    });

    it('resolves the real group id from users/{id}/groups rows, not the gmem_ membership id', async () => {
        // VRChat's users/{id}/groups endpoint returns each row's `id` as the
        // gmem_ membership record id, not the group id — the real group id is
        // in `groupId`. getUserGroups must prefer groupId, or every group
        // shown from this endpoint would carry the wrong id.
        tauriMock.commands.appVrchatGroupUserGroupsGet.mockResolvedValue({
            status: 200,
            data: JSON.stringify([
                {
                    id: 'gmem_membership_1',
                    groupId: 'grp_real_1',
                    name: 'Real Group'
                }
            ])
        });

        const groups = await groupProfileRepository.getUserGroups({
            userId: 'usr_gmem_trap'
        });

        expect(groups).toHaveLength(1);
        expect(groups[0].id).toBe('grp_real_1');
    });

    it('unwraps string error bodies from failed group requests', async () => {
        tauriMock.commands.appVrchatGroupGet.mockResolvedValue({
            status: 403,
            data: '"Forbidden"'
        });

        await expect(
            groupProfileRepository.getGroupProfile({
                groupId: 'grp_123',
                force: true
            })
        ).rejects.toMatchObject({
            message: 'Forbidden',
            status: 403,
            endpoint: 'groups/grp_123',
            payload: 'Forbidden'
        });
    });

    it('collects group logs by hasNext and deduplicates by id', async () => {
        tauriMock.commands.appVrchatGroupLogsGet
            .mockResolvedValueOnce({
                status: 200,
                data: JSON.stringify({
                    hasNext: true,
                    results: [
                        {
                            id: 'log_1',
                            description: 'first page'
                        }
                    ],
                    totalCount: 3
                })
            })
            .mockResolvedValueOnce({
                status: 200,
                data: JSON.stringify({
                    hasNext: false,
                    results: [
                        {
                            id: 'log_1',
                            description: 'duplicate'
                        },
                        {
                            id: 'log_2',
                            description: 'second page'
                        }
                    ],
                    totalCount: 3
                })
            });

        const rows = await groupProfileRepository.getAllGroupLogs({
            groupId: 'grp_123',
            eventTypes: ['group.member.ban', 'group.member.kick']
        });

        expect(rows.map((row) => row.id)).toEqual(['log_1', 'log_2']);
        expect(tauriMock.commands.appVrchatGroupLogsGet).toHaveBeenCalledTimes(
            2
        );
        expect(
            tauriMock.commands.appVrchatGroupLogsGet
        ).toHaveBeenNthCalledWith(1, {
            groupId: 'grp_123',
            n: 100,
            offset: 0,
            eventTypes: 'group.member.ban,group.member.kick'
        });
        expect(
            tauriMock.commands.appVrchatGroupLogsGet
        ).toHaveBeenNthCalledWith(2, {
            groupId: 'grp_123',
            n: 100,
            offset: 100,
            eventTypes: 'group.member.ban,group.member.kick'
        });
    });
});
