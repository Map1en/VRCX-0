import { beforeEach, describe, expect, it, vi } from 'vitest';

const tauriMock = vi.hoisted(() => ({
    commands: {
        appWorldGet: vi.fn(),
        appVrchatWorldPersistentDataExists: vi.fn(),
        appVrchatWorldRatingGet: vi.fn(),
        appVrchatWorldRatingSet: vi.fn(),
        appWorldOpenRegister: vi.fn()
    }
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: tauriMock.commands
}));

import { clearEntityQueryCache } from '@/lib/entityQueryCache';
import { queryClient } from '@/lib/queryClient';

import worldProfileRepository, {
    worldRatingQueryOptions
} from './worldProfileRepository';

describe('WorldProfileRepository', () => {
    beforeEach(async () => {
        await clearEntityQueryCache();
        for (const command of Object.values(tauriMock.commands)) {
            command.mockReset();
            command.mockResolvedValue({
                status: 200,
                data: '{"ok":true}'
            });
        }
        tauriMock.commands.appWorldGet.mockResolvedValue({
            status: 404,
            data: '{"error":{"message":"World not found"}}'
        });
        tauriMock.commands.appWorldOpenRegister.mockResolvedValue(null);
    });

    it('normalizes raw world API data into the shape dialogs and lists consume', () => {
        expect(
            worldProfileRepository.normalize({
                id: ' wrld_123 ',
                name: ' Test World ',
                description: '  A world  ',
                authorId: ' usr_author ',
                authorName: '',
                releaseStatus: '',
                thumbnailImageUrl: ' thumb.png ',
                imageUrl: ' image.png ',
                occupants: '12',
                capacity: '40',
                recommendedCapacity: '24',
                favorites: '100',
                visits: '2000',
                popularity: '7',
                heat: '5',
                tags: [' system_labs ', '', null],
                created_at: '2026-01-01',
                updated_at: '2026-01-02',
                platforms: ['standalonewindows', 'quest'],
                unityPackages: [
                    { platform: 'android' },
                    { platformName: 'ios' },
                    { assetVersion: { platform: 'windows' } }
                ]
            })
        ).toMatchObject({
            id: 'wrld_123',
            name: 'Test World',
            description: 'A world',
            authorId: 'usr_author',
            authorName: 'usr_author',
            releaseStatus: 'unknown',
            thumbnailImageUrl: 'thumb.png',
            imageUrl: 'image.png',
            occupants: 12,
            capacity: 40,
            recommendedCapacity: 24,
            favorites: 100,
            visits: 2000,
            popularity: 7,
            heat: 5,
            tags: ['system_labs'],
            isLabs: true,
            createdAt: '2026-01-01',
            updatedAt: '2026-01-02',
            platforms: ['PC', 'Quest', 'iOS']
        });
    });

    it('preserves nullable publication metadata and platform file details', () => {
        const world = worldProfileRepository.normalize({
            id: 'wrld_redacted',
            name: 'World',
            publicationDate: null,
            previewYoutubeId: null,
            unityPackages: [
                {
                    id: 'unp_redacted',
                    platform: 'standalonewindows',
                    scanStatus: 'passed',
                    variant: 'security'
                }
            ],
            fileAnalysis: {
                standalonewindows: {
                    fileSize: 1024,
                    success: true,
                    _fileSize: '1 KB'
                }
            }
        });

        expect(world).toMatchObject({
            id: 'wrld_redacted',
            publicationDate: null,
            previewYoutubeId: null,
            unityPackages: [{ scanStatus: 'passed', variant: 'security' }],
            fileAnalysis: {
                standalonewindows: { fileSize: 1024, success: true }
            }
        });
    });

    it('requests and returns the full world payload for full reads', async () => {
        tauriMock.commands.appWorldGet.mockResolvedValue({
            status: 200,
            data: JSON.stringify({
                id: 'wrld_full',
                name: 'Full World',
                description: 'Remote details',
                authorId: 'usr_author',
                releaseStatus: 'public',
                imageUrl: 'image.png',
                capacity: 40,
                tags: ['system_labs'],
                unityPackages: [
                    { platform: 'standalonewindows', assetUrl: 'bundle.url' }
                ],
                instances: [['123', 4]],
                unknownLargeField: { nested: true }
            })
        });

        const world = await worldProfileRepository.getWorldProfile({
            worldId: 'wrld_full',
            full: true
        });
        expect(world).toMatchObject({
            id: 'wrld_full',
            name: 'Full World',
            unityPackages: [
                { platform: 'standalonewindows', assetUrl: 'bundle.url' }
            ],
            instances: [['123', 4]]
        });
        expect(tauriMock.commands.appWorldGet).toHaveBeenCalledWith({
            worldId: 'wrld_full',
            force: false,
            full: true
        });
    });

    it('delegates ordinary world reads to Rust', async () => {
        tauriMock.commands.appWorldGet.mockResolvedValue({
            status: 200,
            data: JSON.stringify({
                id: 'wrld_mirror',
                name: 'Rust World',
                authorId: 'usr_author',
                imageUrl: 'image.png'
            })
        });

        const world = await worldProfileRepository.getWorldProfile({
            worldId: 'wrld_mirror'
        });

        expect(world.name).toBe('Rust World');
        expect(tauriMock.commands.appWorldGet).toHaveBeenCalledWith({
            worldId: 'wrld_mirror',
            force: false,
            full: false
        });
    });

    it('requests the full world payload for dialog reads', async () => {
        tauriMock.commands.appWorldGet.mockResolvedValue({
            status: 200,
            data: JSON.stringify({
                id: 'wrld_dialog',
                name: 'Remote Dialog World',
                tags: ['system_labs']
            })
        });

        const world = await worldProfileRepository.getWorldProfile({
            worldId: 'wrld_dialog',
            dialog: true
        });

        expect(world.name).toBe('Remote Dialog World');
        expect(world.isLabs).toBe(true);
        expect(tauriMock.commands.appWorldGet).toHaveBeenCalledWith({
            worldId: 'wrld_dialog',
            force: false,
            full: true
        });
    });

    it('treats a missing persistent-data record as not present', async () => {
        tauriMock.commands.appVrchatWorldPersistentDataExists.mockResolvedValueOnce(
            {
                status: 404,
                data: JSON.stringify({ error: { message: 'Not Found' } })
            }
        );

        await expect(
            worldProfileRepository.hasWorldPersistentData({
                userId: 'usr_1',
                worldId: 'wrld_1',
                force: true
            })
        ).resolves.toBe(false);
    });

    it('reads the current rating and keeps the cache in sync when it changes', async () => {
        tauriMock.commands.appVrchatWorldRatingGet.mockResolvedValueOnce({
            status: 200,
            data: '{"value":null}'
        });
        const options = worldRatingQueryOptions('usr_1', 'wrld_1');

        await expect(queryClient.fetchQuery(options)).resolves.toBeNull();

        tauriMock.commands.appVrchatWorldRatingSet.mockResolvedValueOnce({
            status: 200,
            data: '{"value":"like"}'
        });
        await expect(
            worldProfileRepository.setWorldRating({
                userId: 'usr_1',
                worldId: 'wrld_1',
                value: 'like'
            })
        ).resolves.toBe('like');
        expect(tauriMock.commands.appVrchatWorldRatingSet).toHaveBeenCalledWith(
            { worldId: 'wrld_1', value: 'like' }
        );
        expect(queryClient.getQueryData(options.queryKey)).toBe('like');

        tauriMock.commands.appVrchatWorldRatingSet.mockResolvedValueOnce({
            status: 200,
            data: '{"value":null}'
        });
        await worldProfileRepository.setWorldRating({
            userId: 'usr_1',
            worldId: 'wrld_1',
            value: null
        });
        expect(queryClient.getQueryData(options.queryKey)).toBeNull();
    });

    it('throws request errors with status, endpoint, and parsed payload details', async () => {
        tauriMock.commands.appWorldGet.mockResolvedValue({
            status: 404,
            data: JSON.stringify({
                error: {
                    message: 'World not found'
                }
            })
        });

        await expect(
            worldProfileRepository.getWorldProfile({
                worldId: 'wrld_missing',
                force: true
            })
        ).rejects.toMatchObject({
            message: 'World not found',
            status: 404,
            endpoint: 'worlds/wrld_missing',
            payload: {
                error: {
                    message: 'World not found'
                }
            }
        });
        expect(tauriMock.commands.appWorldGet).toHaveBeenCalledWith({
            worldId: 'wrld_missing',
            force: true,
            full: false
        });
    });

    it('fires a best-effort open register call for a valid world id', () => {
        worldProfileRepository.registerWorldOpenShare('wrld_open');

        expect(tauriMock.commands.appWorldOpenRegister).toHaveBeenCalledWith(
            'wrld_open'
        );
    });

    it('skips the open register call for an empty world id', () => {
        worldProfileRepository.registerWorldOpenShare('');

        expect(tauriMock.commands.appWorldOpenRegister).not.toHaveBeenCalled();
    });

    it('swallows open register command failures', async () => {
        tauriMock.commands.appWorldOpenRegister.mockRejectedValueOnce(
            new Error('network down')
        );

        expect(() =>
            worldProfileRepository.registerWorldOpenShare('wrld_open')
        ).not.toThrow();
        await Promise.resolve();
    });
});
