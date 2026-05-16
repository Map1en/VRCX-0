import { beforeEach, describe, expect, it, vi } from 'vitest';

const backendApp = vi.hoisted(() => ({
    BackendInstanceCreate: vi.fn(),
    BackendInstanceClose: vi.fn()
}));

const backendMock = vi.hoisted(() => ({
    app: backendApp
}));

vi.mock('@/platform/tauri/index.js', () => ({
    callBackendCommand: vi.fn(),
    backend: backendMock,
    default: backendMock
}));

import { callBackendCommand } from '@/platform/tauri/index.js';

import instanceRepository from './instanceRepository.js';

describe('InstanceRepository', () => {
    beforeEach(() => {
        vi.mocked(callBackendCommand).mockReset();
        for (const command of Object.values(backendApp)) {
            command.mockReset();
            command.mockResolvedValue({
                status: 200,
                data: '{"ok":true}',
                raw: { ok: true }
            });
        }
        vi.mocked(callBackendCommand).mockResolvedValue({
            status: 200,
            data: '{"ok":true}',
            raw: { ok: true }
        });
    });

    it('maps invite+ instance options to the VRChat create-instance payload', async () => {
        await expect(
            instanceRepository.createInstance({
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

        expect(backendApp.BackendInstanceCreate).toHaveBeenCalledWith({
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
        await instanceRepository.createInstance({
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

        expect(backendApp.BackendInstanceCreate.mock.calls[0][0].params).toEqual({
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
        await instanceRepository.createInstance({
            worldId: 'wrld_group',
            accessType: 'group',
            groupId: 'grp_team',
            groupAccessType: 'members',
            roleIds: ['grol_a', 'grol_b']
        });

        expect(
            backendApp.BackendInstanceCreate.mock.calls[0][0].params
        ).toMatchObject(
            {
                groupAccessType: 'members',
                roleIds: ['grol_a', 'grol_b']
            }
        );
    });

    it('rejects private instance creation before sending an ownerless request', async () => {
        await expect(
            instanceRepository.createInstance({
                worldId: 'wrld_test',
                accessType: 'friends'
            })
        ).rejects.toThrow('requires an owner id');

        expect(backendApp.BackendInstanceCreate).not.toHaveBeenCalled();
    });

    it('sends close-instance requests with the hard-close flag', async () => {
        await instanceRepository.closeInstance({
            location: 'wrld_test:12345',
            hardClose: true
        });

        expect(backendApp.BackendInstanceClose).toHaveBeenCalledWith({
            endpoint: '',
            location: 'wrld_test:12345',
            hardClose: true
        });
    });
});
