import { beforeEach, describe, expect, it, vi } from 'vitest';

const backendMock = vi.hoisted(() => ({
    app: {
        BackendUserMutualFriendsGet: vi.fn()
    }
}));

vi.mock('@/platform/tauri/index.js', () => ({
    backend: backendMock,
    default: backendMock
}));

import userProfileRepository from './userProfileRepository.js';

describe('UserProfileRepository', () => {
    beforeEach(() => {
        vi.mocked(backendMock.app.BackendUserMutualFriendsGet).mockReset();
    });

    it('normalizes user profile defaults, trust metadata, moderator flags, and platform fallback', () => {
        expect(
            userProfileRepository.normalize({
                id: 'usr_123',
                displayName: 'User',
                tags: ['system_trust_trusted', 'admin_moderator'],
                developerType: 'none',
                platform: 'web',
                last_platform: 'android'
            })
        ).toMatchObject({
            id: 'usr_123',
            displayName: 'User',
            badges: [],
            bioLinks: [],
            currentAvatarTags: [],
            $trustLevel: 'Known User',
            $trustClass: 'x-tag-trusted',
            $trustSortNum: 4.3,
            $isModerator: true,
            $isTroll: false,
            $isProbableTroll: false,
            $platform: 'android'
        });
    });

    it('treats troll and probable-troll tags as trust sorting modifiers', () => {
        expect(
            userProfileRepository.normalize({
                tags: ['system_trust_basic', 'system_probable_troll']
            })
        ).toMatchObject({
            $trustLevel: 'New User',
            $isTroll: false,
            $isProbableTroll: true,
            $trustSortNum: 2.1
        });

        expect(
            userProfileRepository.normalize({
                tags: [
                    'system_trust_known',
                    'system_troll',
                    'system_probable_troll'
                ]
            })
        ).toMatchObject({
            $trustLevel: 'User',
            $isTroll: true,
            $isProbableTroll: false,
            $trustSortNum: 3.1
        });
    });

    it('collects mutual friends until the first short page', async () => {
        vi.mocked(backendMock.app.BackendUserMutualFriendsGet)
            .mockResolvedValueOnce({
                status: 200,
                data: Array.from({ length: 100 }, (_, index) => ({
                    id: `usr_page_1_${index}`
                })),
                raw: {}
            })
            .mockResolvedValueOnce({
                status: 200,
                data: [{ id: 'usr_last' }],
                raw: {}
            });

        const rows = await userProfileRepository.getAllMutualFriends({
            userId: 'usr_target',
            endpoint: 'https://api.example.test'
        });

        expect(
            backendMock.app.BackendUserMutualFriendsGet
        ).toHaveBeenNthCalledWith(
            1,
            {
                userId: 'usr_target',
                endpoint: 'https://api.example.test',
                n: 100,
                offset: 0
            }
        );
        expect(
            backendMock.app.BackendUserMutualFriendsGet
        ).toHaveBeenNthCalledWith(
            2,
            {
                userId: 'usr_target',
                endpoint: 'https://api.example.test',
                n: 100,
                offset: 100
            }
        );
        expect(
            backendMock.app.BackendUserMutualFriendsGet
        ).toHaveBeenCalledTimes(2);
        expect(rows).toHaveLength(101);
        expect(rows.at(-1)).toEqual({ id: 'usr_last' });
    });
});
