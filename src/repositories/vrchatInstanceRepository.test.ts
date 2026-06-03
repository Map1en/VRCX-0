import { beforeEach, describe, expect, it, vi } from 'vitest';

const tauriApp = vi.hoisted(() => ({
    VrchatInstanceCreate: vi.fn()
}));

const tauriMock = vi.hoisted(() => ({
    app: tauriApp
}));

vi.mock('@/platform/tauri/client', () => ({
    tauriClient: tauriMock,
    default: tauriMock
}));

import vrchatInstanceRepository from './vrchatInstanceRepository';

describe('InstanceRepository', () => {
    beforeEach(() => {
        for (const command of Object.values(tauriApp)) {
            command.mockReset();
            command.mockResolvedValue({
                status: 200,
                data: '{"ok":true}',
                raw: { ok: true }
            });
        }
    });

    it('maps invite+ instance options to the VRChat create-instance payload', async () => {
        await expect(
            vrchatInstanceRepository.createInstance({
                worldId: ' wrld_test ',
                ownerId: ' usr_owner ',
                accessType: 'invite+',
                region: 'Europe',
                endpoint: 'https://api.example.test/api/1'
            })
        ).resolves.toMatchObject({
            json: { ok: true },
            status: 200
        });

        expect(tauriApp.VrchatInstanceCreate).toHaveBeenCalledWith({
            endpoint: 'https://api.example.test/api/1',
            params: {
                type: 'private',
                canRequestInvite: true,
                worldId: 'wrld_test',
                ownerId: 'usr_owner',
                region: 'eu'
            }
        });
    });

    it('maps group-only options without leaking role ids to non-member instances', async () => {
        await vrchatInstanceRepository.createInstance({
            worldId: 'wrld_group',
            accessType: 'group',
            groupId: ' grp_team ',
            groupAccessType: 'plus',
            queueEnabled: 0,
            roleIds: ['grol_hidden'],
            ageGate: true,
            displayName: 'Raid Night',
            region: 'Japan'
        });

        expect(tauriApp.VrchatInstanceCreate.mock.calls[0][0].params).toEqual({
            type: 'group',
            canRequestInvite: false,
            worldId: 'wrld_group',
            ownerId: 'grp_team',
            region: 'jp',
            groupAccessType: 'plus',
            queueEnabled: false,
            ageGate: true,
            displayName: 'Raid Night'
        });
    });

    it('includes group role ids only for members access instances', async () => {
        await vrchatInstanceRepository.createInstance({
            worldId: 'wrld_group',
            accessType: 'group',
            groupId: 'grp_team',
            groupAccessType: 'members',
            roleIds: ['grol_a', 'grol_b']
        });

        expect(
            tauriApp.VrchatInstanceCreate.mock.calls[0][0].params
        ).toMatchObject(
            {
                groupAccessType: 'members',
                roleIds: ['grol_a', 'grol_b']
            }
        );
    });

    it('rejects private instance creation before sending an ownerless request', async () => {
        await expect(
            vrchatInstanceRepository.createInstance({
                worldId: 'wrld_test',
                accessType: 'friends'
            })
        ).rejects.toThrow('requires an owner id');

        expect(tauriApp.VrchatInstanceCreate).not.toHaveBeenCalled();
    });

    it('throws request errors with status, endpoint, and parsed payload details', async () => {
        tauriApp.VrchatInstanceCreate.mockResolvedValue({
            status: 403,
            data: JSON.stringify({
                error: {
                    message: 'Instance create forbidden'
                }
            }),
            raw: {}
        });

        await expect(
            vrchatInstanceRepository.createInstance({
                worldId: 'wrld_test',
                ownerId: 'usr_owner',
                accessType: 'friends'
            })
        ).rejects.toMatchObject({
            message: 'Instance create forbidden',
            status: 403,
            endpoint: 'instances',
            payload: {
                error: {
                    message: 'Instance create forbidden'
                }
            }
        });
    });
});
