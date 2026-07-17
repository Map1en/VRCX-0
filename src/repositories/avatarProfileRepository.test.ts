import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    appVrchatAvatarFileGet: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appVrchatAvatarFileGet: mocks.appVrchatAvatarFileGet
    }
}));

import avatarProfileRepository, {
    clearAvatarNameCache,
    getAvatarNameCacheSize,
    getAvatarNameFromImageUrl
} from './avatarProfileRepository';
import * as avatarProfileExports from './avatarProfileRepository';

beforeEach(() => {
    mocks.appVrchatAvatarFileGet.mockReset();
    clearAvatarNameCache();
});

describe('AvatarProfileRepository', () => {
    it('normalizes the stable avatar fields while preserving nullable metadata', () => {
        const avatar = avatarProfileRepository.normalize({
            id: 'avtr_redacted',
            name: 'Avatar',
            acknowledgements: null,
            attribution: null,
            authorId: 'usr_redacted',
            authorName: 'Author',
            created_at: '2026-01-01T00:00:00.000Z',
            listingDate: null,
            styles: { primary: 'classic', secondary: 'expressive' },
            unityPackages: [
                {
                    id: 'unp_redacted',
                    platform: 'standalonewindows',
                    variant: 'security'
                }
            ],
            updated_at: '2026-01-02T00:00:00.000Z'
        });

        expect(avatar).toMatchObject({
            id: 'avtr_redacted',
            acknowledgements: null,
            attribution: null,
            listingDate: null,
            styles: { primary: 'classic', secondary: 'expressive' },
            unityPackages: [
                { platform: 'standalonewindows', variant: 'security' }
            ],
            $tags: [],
            $timeSpent: 0,
            $memo: '',
            $isCached: false
        });
    });

    it('applies local snapshot metadata through the named normalization export', () => {
        const avatar = avatarProfileExports.normalize(
            {
                id: ' avtr_local ',
                authorId: ' usr_author '
            },
            {
                cachedAvatar: { id: 'avtr_local' },
                localTags: [
                    { tag: ' favorite ', color: ' #123456 ' },
                    { tag: '', color: 'ignored' }
                ],
                timeSpent: '42',
                memo: ' local memo '
            }
        );

        expect(avatar).toMatchObject({
            id: 'avtr_local',
            authorId: 'usr_author',
            authorName: 'usr_author',
            $tags: [{ tag: 'favorite', color: '#123456' }],
            $timeSpent: 42,
            $memo: ' local memo ',
            $isCached: true
        });
    });

    it('keeps the frozen facade wired to every named function export', () => {
        const repositoryFunctionNames: Array<
            keyof typeof avatarProfileRepository
        > = [
            'normalize',
            'clearAvatarNameCache',
            'getAvatarNameCacheSize',
            'getLocalSnapshot',
            'getAvatarProfile',
            'getAvatarGallery',
            'getAvatarsByUser',
            'getAllAvatarsByUser',
            'selectAvatar',
            'selectFallbackAvatar',
            'saveAvatar',
            'getAvatarStyles',
            'deleteAvatar',
            'createImposter',
            'deleteImposter',
            'getAvatarModerations',
            'sendAvatarModeration',
            'deleteAvatarModeration',
            'getAvatarNameFromImageUrl'
        ];

        expect(Object.isFrozen(avatarProfileRepository)).toBe(true);
        expect(Object.keys(avatarProfileRepository)).toEqual(
            repositoryFunctionNames
        );
        for (const name of repositoryFunctionNames) {
            expect(avatarProfileRepository[name]).toBe(
                avatarProfileExports[name]
            );
        }
    });

    it('shares one endpoint-scoped avatar name cache across facade and named exports', async () => {
        mocks.appVrchatAvatarFileGet.mockResolvedValue({
            status: 200,
            data: JSON.stringify({
                name: 'Avatar - Shared cache - Image - 1',
                ownerId: 'usr_owner',
                versions: [{ created_at: '2026-01-03T00:00:00.000Z' }]
            }),
            raw: ''
        });

        const imageUrl =
            'https://api.vrchat.cloud/api/1/file/file_avatar_profile/1/file';
        const first = await getAvatarNameFromImageUrl(imageUrl, {
            endpoint: 'https://api.vrchat.cloud/api/1'
        });
        const second = await avatarProfileRepository.getAvatarNameFromImageUrl(
            imageUrl,
            {
                endpoint: 'https://api.vrchat.cloud/api/1/'
            }
        );

        expect(first).toEqual({
            ownerId: 'usr_owner',
            avatarName: 'Shared cache',
            fileCreatedAt: '2026-01-03T00:00:00.000Z'
        });
        expect(second).toBe(first);
        expect(mocks.appVrchatAvatarFileGet).toHaveBeenCalledTimes(1);
        expect(avatarProfileRepository.getAvatarNameCacheSize()).toBe(1);
        expect(clearAvatarNameCache()).toBe(1);
        expect(getAvatarNameCacheSize()).toBe(0);
    });
});
