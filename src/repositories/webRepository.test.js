import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../platform/tauri/index.js', () => ({
    backend: {
        web: {
            clearCookies: vi.fn(),
            getCookies: vi.fn(),
            setCookies: vi.fn(),
            execute: vi.fn()
        }
    }
}));

import { backend } from '../platform/tauri/index.js';
import { WebRepository } from './webRepository.js';

describe('WebRepository', () => {
    beforeEach(() => {
        vi.mocked(backend.web.execute).mockReset();
    });

    it('adapts Rust tuple-style web responses', async () => {
        const repository = new WebRepository();
        vi.mocked(backend.web.execute).mockResolvedValue({
            Item1: 201,
            Item2: '{"ok":true}'
        });

        await expect(repository.execute({ url: 'https://example.test', method: 'GET' })).resolves.toEqual({
            status: 201,
            data: '{"ok":true}',
            raw: {
                Item1: 201,
                Item2: '{"ok":true}'
            }
        });
    });

    it('adapts object-style responses and raw primitive responses', async () => {
        const repository = new WebRepository();
        vi.mocked(backend.web.execute)
            .mockResolvedValueOnce({
                status: 204,
                data: ''
            })
            .mockResolvedValueOnce('plain text');

        await expect(repository.execute({ url: 'https://example.test/empty' })).resolves.toMatchObject({
            status: 204,
            data: ''
        });
        await expect(repository.execute({ url: 'https://example.test/text' })).resolves.toEqual({
            status: 0,
            data: 'plain text',
            raw: 'plain text'
        });
    });

    it('turns tuple-style failure responses into contextual errors', async () => {
        const repository = new WebRepository();
        vi.mocked(backend.web.execute).mockResolvedValue({
            Item1: -1,
            Item2: 'network denied'
        });

        await expect(repository.execute({ url: 'https://example.test' })).rejects.toMatchObject({
            message: 'Web API execution failed: network denied'
        });
    });

    it('requires an options object before invoking the backend', async () => {
        const repository = new WebRepository();

        await expect(repository.execute()).rejects.toThrow('WebRepository.execute requires an options object');
        expect(backend.web.execute).not.toHaveBeenCalled();
    });
});
