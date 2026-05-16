import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../platform/tauri/index.js', () => ({
    backend: {
        web: {
            clearCookies: vi.fn(),
            getCookies: vi.fn(),
            setCookies: vi.fn()
        }
    }
}));

import { backend } from '../platform/tauri/index.js';
import webRepository from './webRepository.js';

describe('WebRepository', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it('keeps cookie management on the web bridge', async () => {
        vi.mocked(backend.web.getCookies).mockResolvedValue('cookie-data');

        await expect(webRepository.clearCookies()).resolves.toBeUndefined();
        await expect(webRepository.getCookies()).resolves.toBe('cookie-data');
        await expect(
            webRepository.setCookies('next-cookie-data')
        ).resolves.toBeUndefined();

        expect(backend.web.clearCookies).toHaveBeenCalledTimes(1);
        expect(backend.web.getCookies).toHaveBeenCalledTimes(1);
        expect(backend.web.setCookies).toHaveBeenCalledWith('next-cookie-data');
    });
});
