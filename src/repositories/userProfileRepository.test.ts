import { beforeEach, describe, expect, it, vi } from 'vitest';

const tauriMock = vi.hoisted(() => ({
    commands: {
        appVrchatUserMutualFriendsGet: vi.fn()
    }
}));

vi.mock('@/platform/tauri/bindings', () => ({ commands: tauriMock.commands }));

import userProfileRepository from './userProfileRepository';

describe('UserProfileRepository', () => {
    beforeEach(() => {
        vi.mocked(tauriMock.commands.appVrchatUserMutualFriendsGet).mockReset();
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

    it('strips the default robot avatar image so it resolves as unknown, not "Robot"', () => {
        const robotImage =
            'https://api.vrchat.cloud/api/1/file/file_0e8c4e32-7444-44ea-ade4-313c010d4bae/1/file';
        expect(
            userProfileRepository.normalize({
                id: 'usr_robot',
                currentAvatarImageUrl: robotImage,
                currentAvatarThumbnailImageUrl: robotImage
            })
        ).toMatchObject({
            currentAvatarImageUrl: '',
            currentAvatarThumbnailImageUrl: ''
        });

        const realImage =
            'https://api.vrchat.cloud/api/1/file/file_real-avatar/1/file';
        expect(
            userProfileRepository.normalize({
                id: 'usr_real',
                currentAvatarImageUrl: realImage,
                currentAvatarThumbnailImageUrl: realImage
            })
        ).toMatchObject({
            currentAvatarImageUrl: realImage,
            currentAvatarThumbnailImageUrl: realImage
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
        vi.mocked(tauriMock.commands.appVrchatUserMutualFriendsGet)
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
            tauriMock.commands.appVrchatUserMutualFriendsGet
        ).toHaveBeenNthCalledWith(1, {
            userId: 'usr_target',
            endpoint: 'https://api.example.test',
            n: 100,
            offset: 0
        });
        expect(
            tauriMock.commands.appVrchatUserMutualFriendsGet
        ).toHaveBeenNthCalledWith(2, {
            userId: 'usr_target',
            endpoint: 'https://api.example.test',
            n: 100,
            offset: 100
        });
        expect(
            tauriMock.commands.appVrchatUserMutualFriendsGet
        ).toHaveBeenCalledTimes(2);
        expect(rows).toHaveLength(101);
        expect(rows.at(-1)).toEqual({ id: 'usr_last' });
    });
});
