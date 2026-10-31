// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getFavoriteScreenshots: vi.fn(),
    setScreenshotFavorite: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appGetFavoriteScreenshots: mocks.getFavoriteScreenshots,
        appSetScreenshotFavorite: mocks.setScreenshotFavorite
    }
}));
vi.mock('@/services/toastService', () => ({ toast: { add: vi.fn() } }));

import { useScreenshotFavorites } from './useScreenshotFavorites';

function favoriteImage(path: string) {
    return {
        path,
        folderPath: 'C:\\VRChat',
        fileName: path,
        sizeBytes: 1,
        modifiedAt: 1,
        createdAt: null,
        width: null,
        height: null,
        worldId: null,
        worldName: null,
        capturedAt: null,
        capturedAtMs: 1,
        metadata: null,
        error: null
    };
}

afterEach(() => {
    cleanup();
    mocks.getFavoriteScreenshots.mockReset();
    mocks.setScreenshotFavorite.mockReset();
});

describe('useScreenshotFavorites', () => {
    it('keeps an unfavorited screenshot removed when an older reload finishes later', async () => {
        const path = 'C:\\VRChat\\sea.png';
        const favorites = {
            paths: [path],
            images: [favoriteImage(path)],
            missingCount: 0
        };
        mocks.getFavoriteScreenshots.mockResolvedValueOnce(favorites);
        mocks.setScreenshotFavorite.mockResolvedValue(null);
        const { result } = renderHook(() => useScreenshotFavorites(true));
        await waitFor(() => {
            expect(result.current.favoritePaths.has(path)).toBe(true);
        });

        let resolveStaleReload: (value: typeof favorites) => void = () =>
            undefined;
        mocks.getFavoriteScreenshots.mockReturnValueOnce(
            new Promise((resolve) => {
                resolveStaleReload = resolve;
            })
        );
        let staleReload: Promise<void> = Promise.resolve();
        act(() => {
            staleReload = result.current.reloadFavorites();
        });
        await act(async () => {
            await result.current.setFavorite(path, false);
        });
        await act(async () => {
            resolveStaleReload(favorites);
            await staleReload;
        });

        expect(result.current.favoritePaths.has(path)).toBe(false);
        expect(result.current.favoriteImages).toEqual([]);
        expect(result.current.isLoading).toBe(false);
    });
});
