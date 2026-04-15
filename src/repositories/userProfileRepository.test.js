import { describe, expect, it } from 'vitest';

import { UserProfileRepository } from './userProfileRepository.js';

describe('UserProfileRepository', () => {
    it('normalizes user profile defaults, trust metadata, moderator flags, and platform fallback', () => {
        const repository = new UserProfileRepository();

        expect(repository.normalize({
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
        const repository = new UserProfileRepository();

        expect(repository.normalize({
            tags: ['system_trust_basic', 'system_probable_troll']
        })).toMatchObject({
            $trustLevel: 'New User',
            $isTroll: false,
            $isProbableTroll: true,
            $trustSortNum: 2.1
        });

        expect(repository.normalize({
            tags: ['system_trust_known', 'system_troll', 'system_probable_troll']
        })).toMatchObject({
            $trustLevel: 'User',
            $isTroll: true,
            $isProbableTroll: false,
            $trustSortNum: 3.1
        });
    });

    it('collects mutual friends until the first short page', async () => {
        const repository = new UserProfileRepository();
        const calls = [];
        repository.getMutualFriends = async ({ userId, n, offset }) => {
            calls.push({ userId, n, offset });
            if (offset === 0) {
                return Array.from({ length: 100 }, (_, index) => ({ id: `usr_page_1_${index}` }));
            }
            return [{ id: 'usr_last' }];
        };

        const rows = await repository.getAllMutualFriends({
            userId: 'usr_target',
            endpoint: 'https://api.example.test'
        });

        expect(calls).toEqual([
            { userId: 'usr_target', n: 100, offset: 0 },
            { userId: 'usr_target', n: 100, offset: 100 }
        ]);
        expect(rows).toHaveLength(101);
        expect(rows.at(-1)).toEqual({ id: 'usr_last' });
    });
});
