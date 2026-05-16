import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/platform/tauri/index.js', () => ({
    callBackendCommand: vi.fn()
}));

import { callBackendCommand } from '@/platform/tauri/index.js';

import {
    executeGet,
    executePost,
    normalize
} from './groupProfileRepository.js';

describe('GroupProfileRepository', () => {
    beforeEach(() => {
        vi.mocked(callBackendCommand).mockReset();
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

    it('sends JSON bodies for POST requests without leaking params into the URL', async () => {
        vi.mocked(callBackendCommand).mockResolvedValue({
            status: 200,
            data: '{"ok":true}',
            raw: {}
        });

        await executePost(
            'groups/grp_123/invites',
            { userId: 'usr_123' },
            { endpoint: 'https://api.example.test' }
        );

        expect(vi.mocked(callBackendCommand)).toHaveBeenCalledWith(
            'app',
            'VrchatGroupExecute',
            [
                {
                    input: expect.objectContaining({
                        path: 'groups/grp_123/invites',
                        endpoint: 'https://api.example.test',
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json;charset=utf-8'
                        },
                        body: { userId: 'usr_123' },
                        jsonBody: true
                    })
                }
            ]
        );
    });

    it('unwraps string error bodies from failed group requests', async () => {
        vi.mocked(callBackendCommand).mockResolvedValue({
            status: 403,
            data: '"Forbidden"',
            raw: {}
        });

        await expect(executeGet('groups/grp_123')).rejects.toMatchObject({
            message: 'Forbidden',
            status: 403,
            endpoint: 'groups/grp_123',
            payload: 'Forbidden'
        });
    });
});
