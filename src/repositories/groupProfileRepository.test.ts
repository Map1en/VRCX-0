import { beforeEach, describe, expect, it, vi } from 'vitest';

const tauriMock = vi.hoisted(() => ({
    commands: {
        appVrchatGroupGet: vi.fn(),
        appVrchatGroupInstancesGet: vi.fn(),
        appVrchatGroupUserInstancesGet: vi.fn(),
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
                data: '{"ok":true}',
                raw: {}
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

    it('preserves direct-array and wrapped group instance response shapes', async () => {
        const directRows = [
            {
                id: 'instance_direct',
                location: 'wrld_redacted:instance_direct~group(grp_redacted)'
            }
        ];
        const wrappedRows = [
            {
                id: 'instance_wrapped',
                location: 'wrld_redacted:instance_wrapped~group(grp_redacted)'
            }
        ];
        tauriMock.commands.appVrchatGroupInstancesGet.mockResolvedValue({
            status: 200,
            data: JSON.stringify(directRows),
            raw: {}
        });
        tauriMock.commands.appVrchatGroupUserInstancesGet.mockResolvedValue({
            status: 200,
            data: JSON.stringify({ instances: wrappedRows }),
            raw: {}
        });

        await expect(
            groupProfileRepository.getGroupInstances({
                groupId: 'grp_redacted',
                userId: 'usr_redacted'
            })
        ).resolves.toMatchObject({ json: directRows });
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

    it('unwraps string error bodies from failed group requests', async () => {
        tauriMock.commands.appVrchatGroupGet.mockResolvedValue({
            status: 403,
            data: '"Forbidden"',
            raw: {}
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
                }),
                raw: {}
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
                }),
                raw: {}
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
            eventTypes: 'group.member.ban,group.member.kick',
            endpoint: ''
        });
        expect(
            tauriMock.commands.appVrchatGroupLogsGet
        ).toHaveBeenNthCalledWith(2, {
            groupId: 'grp_123',
            n: 100,
            offset: 100,
            eventTypes: 'group.member.ban,group.member.kick',
            endpoint: ''
        });
    });

    it('keeps getGroupLogs compatible with row-array callers', async () => {
        tauriMock.commands.appVrchatGroupLogsGet.mockResolvedValue({
            status: 200,
            data: JSON.stringify({
                hasNext: false,
                results: [
                    {
                        id: 'log_rows',
                        eventType: 'group.member.remove'
                    }
                ],
                totalCount: 1
            }),
            raw: {}
        });

        await expect(
            groupProfileRepository.getGroupLogs({
                groupId: 'grp_123',
                eventTypes: ['group.member.remove']
            })
        ).resolves.toEqual([
            {
                id: 'log_rows',
                eventType: 'group.member.remove'
            }
        ]);

        expect(tauriMock.commands.appVrchatGroupLogsGet).toHaveBeenCalledWith({
            groupId: 'grp_123',
            n: 100,
            offset: 0,
            eventTypes: 'group.member.remove',
            endpoint: ''
        });
    });
});
