import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./webRepository.js', () => ({
    default: {
        execute: vi.fn()
    }
}));

import webRepository from './webRepository.js';
import worldProfileRepository from './worldProfileRepository.js';

describe('WorldProfileRepository', () => {
    beforeEach(() => {
        vi.mocked(webRepository.execute).mockReset();
    });

    it('normalizes raw world API data into the shape dialogs and lists consume', () => {
        expect(worldProfileRepository.normalize({
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
        })).toMatchObject({
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

    it('builds GET URLs with endpoint, scalar params, repeated array params, and skipped nulls', async () => {
        vi.mocked(webRepository.execute).mockResolvedValue({
            status: 200,
            data: '{"ok":true}',
            raw: { source: 'web' }
        });

        const response = await worldProfileRepository.executeGet(
            'worlds',
            {
                tag: ['featured', null, 'labs'],
                n: 50,
                ignored: undefined
            },
            {
                endpoint: 'https://api.example.test/custom/'
            }
        );

        expect(response).toMatchObject({
            json: { ok: true },
            status: 200,
            raw: { source: 'web' }
        });
        const request = vi.mocked(webRepository.execute).mock.calls[0][0];
        const url = new URL(request.url);
        expect(request.method).toBe('GET');
        expect(`${url.origin}${url.pathname}`).toBe('https://api.example.test/custom/worlds');
        expect(url.searchParams.getAll('tag')).toEqual(['featured', 'labs']);
        expect(url.searchParams.get('n')).toBe('50');
        expect(url.searchParams.has('ignored')).toBe(false);
    });

    it('throws request errors with status, endpoint, and parsed payload details', async () => {
        vi.mocked(webRepository.execute).mockResolvedValue({
            status: 404,
            data: JSON.stringify({
                error: {
                    message: 'World not found'
                }
            }),
            raw: {}
        });

        await expect(worldProfileRepository.executeGet('worlds/wrld_missing')).rejects.toMatchObject({
            message: 'World not found',
            status: 404,
            endpoint: 'worlds/wrld_missing',
            payload: {
                error: {
                    message: 'World not found'
                }
            }
        });
    });
});
