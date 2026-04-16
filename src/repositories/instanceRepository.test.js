import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./webRepository.js', () => ({
    default: {
        execute: vi.fn()
    }
}));

import webRepository from './webRepository.js';
import instanceRepository from './instanceRepository.js';

describe('InstanceRepository', () => {
    beforeEach(() => {
        vi.mocked(webRepository.execute).mockReset();
        vi.mocked(webRepository.execute).mockResolvedValue({
            status: 200,
            data: '{"ok":true}',
            raw: { ok: true }
        });
    });

    it('maps invite+ instance options to the VRChat create-instance payload', async () => {
        await expect(instanceRepository.createInstance({
            worldId: ' wrld_test ',
            ownerId: ' usr_owner ',
            accessType: 'invite+',
            region: 'Europe',
            endpoint: 'https://api.example.test/api/1'
        })).resolves.toMatchObject({
            json: { ok: true },
            status: 200
        });

        expect(webRepository.execute).toHaveBeenCalledWith({
            url: 'https://api.example.test/api/1/instances',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json;charset=utf-8'
            },
            body: JSON.stringify({
                type: 'private',
                canRequestInvite: true,
                worldId: 'wrld_test',
                ownerId: 'usr_owner',
                region: 'eu'
            })
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

        expect(JSON.parse(webRepository.execute.mock.calls[0][0].body)).toEqual({
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

        expect(JSON.parse(webRepository.execute.mock.calls[0][0].body)).toMatchObject({
            groupAccessType: 'members',
            roleIds: ['grol_a', 'grol_b']
        });
    });

    it('rejects private instance creation before sending an ownerless request', async () => {
        await expect(instanceRepository.createInstance({
            worldId: 'wrld_test',
            accessType: 'friends'
        })).rejects.toThrow('requires an owner id');

        expect(webRepository.execute).not.toHaveBeenCalled();
    });

    it('sends close-instance requests with the hard-close flag', async () => {
        await instanceRepository.closeInstance({
            location: 'wrld_test:12345',
            hardClose: true
        });

        expect(webRepository.execute).toHaveBeenCalledWith({
            url: 'https://api.vrchat.cloud/api/1/instances/wrld_test:12345',
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json;charset=utf-8'
            },
            body: JSON.stringify({
                hardClose: true
            })
        });
    });
});
