import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./vrchatFriendRepository.js', () => ({
    default: {
        executeGet: vi.fn()
    }
}));

import vrchatFriendRepository from './vrchatFriendRepository.js';
import userProfileRepository from './userProfileRepository.js';

describe('UserProfileRepository', () => {
    beforeEach(() => {
        vi.mocked(vrchatFriendRepository.executeGet).mockReset();
    });

    it('normalizes user profile defaults, trust metadata, moderator flags, and platform fallback', () => {
        expect(userProfileRepository.normalize({
            id: 'usr_123',
            displayName: 'User',
            tags: ['system_trust_trusted', 'admin_moderator'],
            developerType: 'none',
            platform: 'web',
            last_platform: 'android'
        })).toMatchObject({
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
        expect(userProfileRepository.normalize({
            tags: ['system_trust_basic', 'system_probable_troll']
        })).toMatchObject({
            $trustLevel: 'New User',
            $isTroll: false,
            $isProbableTroll: true,
            $trustSortNum: 2.1
        });

        expect(userProfileRepository.normalize({
            tags: ['system_trust_known', 'system_troll', 'system_probable_troll']
        })).toMatchObject({
            $trustLevel: 'User',
            $isTroll: true,
            $isProbableTroll: false,
            $trustSortNum: 3.1
        });
    });

    it('collects mutual friends until the first short page', async () => {
        vi.mocked(vrchatFriendRepository.executeGet)
            .mockResolvedValueOnce({
                json: Array.from({ length: 100 }, (_, index) => ({ id: `usr_page_1_${index}` }))
            })
            .mockResolvedValueOnce({
                json: [{ id: 'usr_last' }]
            });

        const rows = await userProfileRepository.getAllMutualFriends({
            userId: 'usr_target',
            endpoint: 'https://api.example.test'
        });

        expect(vrchatFriendRepository.executeGet).toHaveBeenNthCalledWith(
            1,
            'users/usr_target/mutuals/friends',
            { n: 100, offset: 0 },
            { endpoint: 'https://api.example.test' }
        );
        expect(vrchatFriendRepository.executeGet).toHaveBeenNthCalledWith(
            2,
            'users/usr_target/mutuals/friends',
            { n: 100, offset: 100 },
            { endpoint: 'https://api.example.test' }
        );
        expect(vrchatFriendRepository.executeGet).toHaveBeenCalledTimes(2);
        expect(rows).toHaveLength(101);
        expect(rows.at(-1)).toEqual({ id: 'usr_last' });
    });
});
