import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/shared/events/preferenceEvents', () => ({
    publishPreferenceChanged: vi.fn()
}));

vi.mock('./configRepository', () => ({
    default: {
        getBool: vi.fn(),
        getString: vi.fn(),
        setString: vi.fn(),
        setBool: vi.fn(),
        has: vi.fn(),
        remove: vi.fn()
    }
}));

vi.mock('./externalApiRepository', () => ({
    default: {
        searchAvatarProvider: vi.fn()
    }
}));

vi.mock('./avatarProfileRepository', () => ({
    default: {
        normalize: vi.fn()
    }
}));

import { publishPreferenceChanged } from '@/shared/events/preferenceEvents';

import avatarProfileRepository from './avatarProfileRepository';
import avatarSearchProviderRepository from './avatarSearchProviderRepository';
import configRepository from './configRepository';
import externalApiRepository from './externalApiRepository';

const DEFAULT_PROVIDER = 'https://api.avtrdb.com/v3/avatar/search/vrcx';
type ConfigFallback = string | number | boolean | null;
type NormalizedAvatar = { id: string };

describe('AvatarSearchProviderRepository', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        vi.mocked(configRepository.getBool).mockResolvedValue(true);
        vi.mocked(configRepository.getString).mockImplementation(
            (_key: string, fallback: ConfigFallback = '') =>
                Promise.resolve(String(fallback ?? ''))
        );
        vi.mocked(configRepository.setString).mockResolvedValue(undefined);
        vi.mocked(configRepository.setBool).mockResolvedValue(undefined);
        vi.mocked(configRepository.has).mockResolvedValue(true);
        vi.mocked(configRepository.remove).mockResolvedValue(undefined);
        vi.mocked(externalApiRepository.searchAvatarProvider).mockResolvedValue(
            {
                status: 200,
                data: '[]',
                raw: []
            }
        );
        vi.mocked(avatarProfileRepository.normalize).mockImplementation(
            (avatarInput: unknown) => {
                const avatar = (avatarInput ?? {}) as Record<string, unknown>;
                return {
                    ...avatar,
                    id: String(avatar.id ?? ''),
                    name: String(avatar.name ?? ''),
                    description: '',
                    authorId: String(avatar.authorId ?? ''),
                    authorName: String(avatar.authorName ?? ''),
                    releaseStatus: String(avatar.releaseStatus ?? 'public'),
                    thumbnailImageUrl: String(avatar.thumbnailImageUrl ?? ''),
                    imageUrl: String(avatar.imageUrl ?? ''),
                    created_at: avatar.created_at ?? '',
                    updated_at: avatar.updated_at ?? '',
                    version: 0,
                    tags: [],
                    unityPackages: [],
                    $tags: [],
                    $timeSpent: 0,
                    $memo: '',
                    $isCached: false,
                    normalized: true
                };
            }
        );
    });

    it('normalizes legacy provider lists and preserves a selected custom provider', async () => {
        const customProvider = 'https://avatars.example.test/search';
        const selectedProvider = 'https://selected.example.test/search';
        vi.mocked(configRepository.getString).mockImplementation(
            (key: string, fallback: ConfigFallback = '') => {
                if (key === 'VRCX_avatarRemoteDatabaseProviderList') {
                    return Promise.resolve(
                        JSON.stringify([
                            'https://api.avtrdb.com/v1/avatar/search/vrcx',
                            customProvider,
                            'https://avtr.just-h.party/vrcx_search.php',
                            customProvider
                        ])
                    );
                }
                if (key === 'VRCX_avatarRemoteDatabaseProvider') {
                    return Promise.resolve(selectedProvider);
                }
                return Promise.resolve(String(fallback ?? ''));
            }
        );

        await expect(
            avatarSearchProviderRepository.getConfig()
        ).resolves.toEqual({
            enabled: true,
            providerList: [DEFAULT_PROVIDER, customProvider, selectedProvider],
            selectedProvider
        });

        expect(configRepository.setString).toHaveBeenCalledWith(
            'VRCX_avatarRemoteDatabaseProviderList',
            JSON.stringify([DEFAULT_PROVIDER, customProvider, selectedProvider])
        );
        expect(configRepository.remove).toHaveBeenCalledWith(
            'avatarRemoteDatabaseProvider'
        );
    });

    it('builds provider search requests and deduplicates normalized avatar ids', async () => {
        vi.mocked(configRepository.getString).mockImplementation(
            (key: string, fallback: ConfigFallback = '') => {
                if (key === 'id') {
                    return Promise.resolve('client-id');
                }
                return Promise.resolve(String(fallback ?? ''));
            }
        );
        vi.mocked(externalApiRepository.searchAvatarProvider).mockResolvedValue(
            {
                status: 200,
                data: JSON.stringify([
                    {
                        Id: 'avtr_alpha',
                        Name: 'Alpha',
                        AuthorName: 'Creator A',
                        image_url: 'https://cdn.example.test/alpha.png'
                    },
                    {
                        _id: 'avtr_alpha',
                        Name: 'Duplicate Alpha'
                    },
                    {
                        avatarId: 'avtr_beta',
                        author_id: 'usr_beta',
                        CreatedAt: '2024-01-01T00:00:00Z',
                        updatedAt: '2024-01-02T00:00:00Z'
                    }
                ]),
                raw: { provider: true }
            }
        );

        const result = await avatarSearchProviderRepository.search({
            provider: ' https://avatars.example.test/search ',
            query: ' alpha '
        });

        const request = vi.mocked(externalApiRepository.searchAvatarProvider)
            .mock.calls[0][0];
        const url = new URL(request.url);
        expect(`${url.origin}${url.pathname}`).toBe(
            'https://avatars.example.test/search'
        );
        expect(url.searchParams.get('search')).toBe('alpha');
        expect(url.searchParams.get('n')).toBe('5000');
        expect(request).toMatchObject({
            vrcxId: 'client-id'
        });
        expect(avatarProfileRepository.normalize).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({
                id: 'avtr_alpha',
                name: 'Alpha',
                authorName: 'Creator A',
                imageUrl: 'https://cdn.example.test/alpha.png',
                releaseStatus: 'public'
            })
        );
        expect(result).toMatchObject({
            provider: 'https://avatars.example.test/search',
            query: 'alpha',
            status: 200,
            raw: { provider: true }
        });
        expect(
            (result.avatars as NormalizedAvatar[]).map((avatar) => avatar.id)
        ).toEqual(['avtr_alpha', 'avtr_beta']);
    });

    it('persists the default provider list when no provider list is configured', async () => {
        vi.mocked(configRepository.has).mockResolvedValue(false);

        await expect(
            avatarSearchProviderRepository.getConfig()
        ).resolves.toMatchObject({
            enabled: true,
            providerList: [DEFAULT_PROVIDER],
            selectedProvider: DEFAULT_PROVIDER
        });

        expect(configRepository.setString).toHaveBeenCalledWith(
            'VRCX_avatarRemoteDatabaseProviderList',
            JSON.stringify([DEFAULT_PROVIDER])
        );
    });

    it('validates provider and English-equivalent query length', async () => {
        await expect(
            avatarSearchProviderRepository.search({
                provider: '',
                query: 'avatar'
            })
        ).rejects.toThrow('Avatar provider is not configured');
        await expect(
            avatarSearchProviderRepository.search({
                provider: DEFAULT_PROVIDER,
                query: 'ab'
            })
        ).rejects.toThrow('3 English characters');
        await expect(
            avatarSearchProviderRepository.search({
                provider: DEFAULT_PROVIDER,
                query: '你好'
            })
        ).resolves.toMatchObject({
            query: '你好',
            status: 200
        });

        expect(
            externalApiRepository.searchAvatarProvider
        ).toHaveBeenCalledTimes(1);
    });

    it('publishes normalized config after saving provider preferences', async () => {
        await expect(
            avatarSearchProviderRepository.saveConfig({
                enabled: true,
                providerList: [
                    'https://api.avtrdb.com/v2/avatar/search/vrcx',
                    'https://custom.example.test/search',
                    'https://custom.example.test/search'
                ],
                selectedProvider: ''
            })
        ).resolves.toEqual({
            enabled: true,
            providerList: [
                DEFAULT_PROVIDER,
                'https://custom.example.test/search'
            ],
            selectedProvider: DEFAULT_PROVIDER
        });

        expect(configRepository.setString).toHaveBeenCalledWith(
            'VRCX_avatarRemoteDatabaseProviderList',
            JSON.stringify([
                DEFAULT_PROVIDER,
                'https://custom.example.test/search'
            ])
        );
        expect(configRepository.setBool).toHaveBeenCalledWith(
            'VRCX_avatarRemoteDatabase',
            true
        );
        expect(configRepository.setString).toHaveBeenCalledWith(
            'VRCX_avatarRemoteDatabaseProvider',
            DEFAULT_PROVIDER
        );
        expect(publishPreferenceChanged).toHaveBeenCalledWith(
            'VRCX_avatarRemoteDatabaseProviderList',
            {
                enabled: true,
                providerList: [
                    DEFAULT_PROVIDER,
                    'https://custom.example.test/search'
                ],
                selectedProvider: DEFAULT_PROVIDER
            }
        );
    });
});
