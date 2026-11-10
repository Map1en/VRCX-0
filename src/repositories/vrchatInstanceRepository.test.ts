import { beforeEach, describe, expect, it, vi } from 'vitest';

const tauriApp = vi.hoisted(() => ({
    appVrchatInstanceClose: vi.fn(),
    appVrchatInstanceCreate: vi.fn(),
    appVrchatInstanceCreateOptionsGet: vi.fn(),
    appVrchatInstanceGet: vi.fn()
}));

const tauriMock = vi.hoisted(() => ({
    commands: tauriApp
}));

vi.mock('@/platform/tauri/bindings', () => ({ commands: tauriMock.commands }));

import { clearEntityQueryCache } from '@/lib/entityQueryCache';

import vrchatInstanceRepository from './vrchatInstanceRepository';

describe('InstanceRepository', () => {
    beforeEach(async () => {
        await clearEntityQueryCache();
        for (const command of Object.values(tauriApp)) {
            command.mockReset();
            command.mockResolvedValue({
                status: 200,
                data: '{"ok":true}'
            });
        }
    });

    it('reuses the instance category and vibe options across dialogs', async () => {
        const options = {
            categories: [{ id: 'icat_hangout', name: 'Hangout' }],
            vibes: [{ id: 'ivib_chill', name: 'Chill' }]
        };
        tauriApp.appVrchatInstanceCreateOptionsGet.mockResolvedValue(options);

        await expect(
            vrchatInstanceRepository.getInstanceCreateOptions()
        ).resolves.toEqual(options);
        await expect(
            vrchatInstanceRepository.getInstanceCreateOptions()
        ).resolves.toEqual(options);
        expect(
            tauriApp.appVrchatInstanceCreateOptionsGet
        ).toHaveBeenCalledOnce();
    });

    it('coalesces concurrent instance reads without reusing completed results', async () => {
        const first = vrchatInstanceRepository.getInstance({
            worldId: 'wrld_test',
            instanceId: '12345'
        });
        const second = vrchatInstanceRepository.getInstance({
            worldId: 'wrld_test',
            instanceId: '12345'
        });
        await Promise.all([first, second]);

        await vrchatInstanceRepository.getInstance({
            worldId: 'wrld_test',
            instanceId: '12345'
        });

        expect(tauriApp.appVrchatInstanceGet).toHaveBeenCalledTimes(2);
    });

    it('reads fresh instance state after closing an instance', async () => {
        tauriApp.appVrchatInstanceGet
            .mockResolvedValueOnce({
                status: 200,
                data: JSON.stringify({
                    id: 'wrld_test:12345',
                    closedAt: null
                })
            })
            .mockResolvedValueOnce({
                status: 200,
                data: JSON.stringify({
                    id: 'wrld_test:12345',
                    closedAt: '2026-08-11T00:00:00.000Z'
                })
            });
        tauriApp.appVrchatInstanceClose.mockResolvedValue({
            status: 200,
            data: JSON.stringify({
                id: 'wrld_test:12345',
                closedAt: '2026-08-11T00:00:00.000Z'
            })
        });

        await vrchatInstanceRepository.getInstance({
            worldId: 'wrld_test',
            instanceId: '12345'
        });
        await vrchatInstanceRepository.closeInstance({
            location: 'wrld_test:12345'
        });
        const afterClose = await vrchatInstanceRepository.getInstance({
            worldId: 'wrld_test',
            instanceId: '12345'
        });

        expect(afterClose.json).toMatchObject({
            closedAt: '2026-08-11T00:00:00.000Z'
        });
        expect(tauriApp.appVrchatInstanceGet).toHaveBeenCalledTimes(2);
    });

    it('maps invite+ instance options to the VRChat create-instance payload', async () => {
        await expect(
            vrchatInstanceRepository.createInstance({
                worldId: ' wrld_test ',
                ownerId: ' usr_owner ',
                accessType: 'invite+',
                region: 'Europe'
            })
        ).resolves.toMatchObject({
            json: { ok: true },
            status: 200
        });

        expect(tauriApp.appVrchatInstanceCreate).toHaveBeenCalledWith({
            params: {
                type: 'private',
                canRequestInvite: true,
                worldId: 'wrld_test',
                ownerId: 'usr_owner',
                region: 'eu'
            }
        });
    });

    it('omits the legacy owner id from public instance requests', async () => {
        await vrchatInstanceRepository.createInstance({
            worldId: 'wrld_public',
            ownerId: 'usr_owner',
            accessType: 'public'
        });

        expect(tauriApp.appVrchatInstanceCreate).toHaveBeenCalledWith({
            params: {
                type: 'public',
                canRequestInvite: false,
                worldId: 'wrld_public',
                region: 'us'
            }
        });
    });

    it('maps group-only options without leaking role ids to non-member instances', async () => {
        await vrchatInstanceRepository.createInstance({
            worldId: 'wrld_group',
            accessType: 'group',
            groupId: ' grp_team ',
            groupAccessType: 'plus',
            minimumAvatarPerformance: 'Medium',
            queueEnabled: false,
            roleIds: ['grol_hidden'],
            ageGate: true,
            displayName: 'Raid Night',
            region: 'Japan'
        });

        expect(
            tauriApp.appVrchatInstanceCreate.mock.calls[0][0].params
        ).toEqual({
            type: 'group',
            canRequestInvite: false,
            worldId: 'wrld_group',
            ownerId: 'grp_team',
            region: 'jp',
            groupAccessType: 'plus',
            minimumAvatarPerformance: 'Medium',
            queueEnabled: false,
            ageGate: true,
            displayName: 'Raid Night'
        });
    });

    it('sends discovery details only when they are filled in', async () => {
        await vrchatInstanceRepository.createInstance({
            worldId: 'wrld_public',
            description: 'Bring snacks',
            categoryId: 'icat_watch',
            vibeIds: ['ivib_chill', 'ivib_cozy'],
            languages: ['jpn', 'eng']
        });
        await vrchatInstanceRepository.createInstance({
            worldId: 'wrld_public',
            description: '',
            categoryId: '',
            vibeIds: [],
            languages: []
        });

        expect(
            tauriApp.appVrchatInstanceCreate.mock.calls[0][0].params
        ).toMatchObject({
            description: 'Bring snacks',
            categoryId: 'icat_watch',
            vibeIds: ['ivib_chill', 'ivib_cozy'],
            languages: ['jpn', 'eng']
        });
        expect(
            tauriApp.appVrchatInstanceCreate.mock.calls[1][0].params
        ).toEqual({
            type: 'public',
            canRequestInvite: false,
            worldId: 'wrld_public',
            region: 'us'
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
            tauriApp.appVrchatInstanceCreate.mock.calls[0][0].params
        ).toMatchObject({
            groupAccessType: 'members',
            roleIds: ['grol_a', 'grol_b']
        });
        expect(
            tauriApp.appVrchatInstanceCreate.mock.calls[0][0].params
        ).not.toHaveProperty('minimumAvatarPerformance');
    });

    it('rejects private instance creation before sending an ownerless request', async () => {
        await expect(
            vrchatInstanceRepository.createInstance({
                worldId: 'wrld_test',
                accessType: 'friends'
            })
        ).rejects.toThrow('requires an owner id');

        expect(tauriApp.appVrchatInstanceCreate).not.toHaveBeenCalled();
    });

    it('throws request errors with status, endpoint, and parsed payload details', async () => {
        tauriApp.appVrchatInstanceCreate.mockResolvedValue({
            status: 403,
            data: JSON.stringify({
                error: {
                    message: 'Instance create forbidden'
                }
            })
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
