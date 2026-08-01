import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

const tauriMock = vi.hoisted(() => ({
    commands: {
        appVrchatUserProfileGet: vi.fn(),
        appVrchatUserMutualFriendsGet: vi.fn()
    }
}));

vi.mock('@/platform/tauri/bindings', () => ({ commands: tauriMock.commands }));

import userProfileRepository from './userProfileRepository';

describe('UserProfileRepository', () => {
    beforeEach(() => {
        vi.mocked(tauriMock.commands.appVrchatUserProfileGet).mockReset();
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

    it('preserves optional, nullable, and nested profile fields from dialog data', () => {
        const profile = userProfileRepository.normalize({
            id: 'usr_redacted',
            ageVerificationStatus: 'hidden',
            ageVerified: false,
            accountDeletionDate: null,
            badges: [
                {
                    badgeId: 'bdg_redacted',
                    badgeName: 'Badge',
                    assignedAt: '2026-01-01T00:00:00.000Z',
                    hidden: false,
                    showcased: true
                }
            ],
            last_mobile: null,
            platform_history: [
                {
                    isMobile: false,
                    platform: 'standalonewindows',
                    recorded: '2026-01-01T00:00:00.000Z'
                }
            ],
            tags: ['system_trust_known'],
            $travelingToLocation: {
                worldId: 'wrld_redacted',
                instanceId: 'instance-redacted'
            }
        });

        expect(profile).toMatchObject({
            id: 'usr_redacted',
            ageVerificationStatus: 'hidden',
            ageVerified: false,
            accountDeletionDate: null,
            badges: [{ badgeId: 'bdg_redacted', showcased: true }],
            last_mobile: null,
            platform_history: [{ platform: 'standalonewindows' }],
            $travelingToLocation: { worldId: 'wrld_redacted' },
            $trustLevel: 'User'
        });
    });

    it('preserves typed profile appearance fields from current profile responses', () => {
        const profile = userProfileRepository.normalize({
            id: 'usr_redacted',
            backgroundGradientBottom: '',
            backgroundGradientTop: '',
            backgroundTemplateId: '',
            backgroundTextureId: '',
            backgroundType: 'default',
            bannerColor: '2cc968',
            bannerCustomUrl: 'https://example.test/banner.png',
            hasVrcPlus: true,
            iconFrame: 'invt_frame',
            iconType: '',
            nameplateEffect: 'invt_nameplate',
            profileEffect: 'invt_profile',
            themeId: 'default',
            themes: []
        });

        expect(profile).toMatchObject({
            backgroundType: 'default',
            bannerColor: '2cc968',
            iconFrame: 'invt_frame',
            nameplateEffect: 'invt_nameplate',
            profileEffect: 'invt_profile',
            themeId: 'default'
        });
        expectTypeOf(profile).toMatchTypeOf<{
            backgroundGradientBottom?: string;
            backgroundGradientTop?: string;
            backgroundTemplateId?: string;
            backgroundTextureId?: string;
            backgroundType?: string;
            bannerColor?: string;
            bannerCustomUrl?: string;
            hasVrcPlus?: boolean;
            iconFrame?: string;
            iconType?: string;
            nameplateEffect?: string;
            profileEffect?: string;
            themeId?: string;
            themes?: unknown[];
        }>();

        expect(
            userProfileRepository.normalize({
                iconFrame: '',
                nameplateEffect: '',
                profileEffect: ''
            })
        ).toMatchObject({
            iconFrame: '',
            nameplateEffect: '',
            profileEffect: ''
        });
    });

    it('reads public and self appearance profiles without normalizing their partial payloads', async () => {
        const publicProfile = {
            id: 'usr_target',
            backgroundType: 'default',
            iconFrame: '',
            profileEffect: 'invt_profile'
        };
        const selfProfile = {
            id: 'usr_target',
            backgroundGradientBottom: '',
            bannerColor: '2cc968',
            nameplateEffect: ''
        };
        vi.mocked(tauriMock.commands.appVrchatUserProfileGet)
            .mockResolvedValueOnce({
                status: 200,
                data: publicProfile
            })
            .mockResolvedValueOnce({
                status: 200,
                data: selfProfile
            });

        await expect(
            userProfileRepository.getUserAppearanceProfile({
                userId: ' usr_target '
            })
        ).resolves.toBe(publicProfile);
        await expect(
            userProfileRepository.getUserAppearanceProfile({
                userId: 'usr_target',
                asSelf: true
            })
        ).resolves.toBe(selfProfile);

        expect(
            tauriMock.commands.appVrchatUserProfileGet
        ).toHaveBeenNthCalledWith(1, {
            userId: 'usr_target',
            asSelf: false
        });
        expect(
            tauriMock.commands.appVrchatUserProfileGet
        ).toHaveBeenNthCalledWith(2, {
            userId: 'usr_target',
            asSelf: true
        });
        expect(publicProfile).toHaveProperty('iconFrame', '');
        expect(selfProfile).toHaveProperty('nameplateEffect', '');
        expect(publicProfile).not.toHaveProperty('$trustLevel');
    });

    it('rejects appearance profile reads without a user id', async () => {
        await expect(
            userProfileRepository.getUserAppearanceProfile({ userId: ' ' })
        ).rejects.toThrow(
            'UserProfileRepository.getUserAppearanceProfile requires a user id.'
        );
        expect(
            tauriMock.commands.appVrchatUserProfileGet
        ).not.toHaveBeenCalled();
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
                }))
            })
            .mockResolvedValueOnce({
                status: 200,
                data: [{ id: 'usr_last' }]
            });

        const rows = await userProfileRepository.getAllMutualFriends({
            userId: 'usr_target'
        });

        expect(
            tauriMock.commands.appVrchatUserMutualFriendsGet
        ).toHaveBeenNthCalledWith(1, {
            userId: 'usr_target',
            n: 100,
            offset: 0
        });
        expect(
            tauriMock.commands.appVrchatUserMutualFriendsGet
        ).toHaveBeenNthCalledWith(2, {
            userId: 'usr_target',
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
