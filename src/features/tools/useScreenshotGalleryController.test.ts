// @vitest-environment jsdom

import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    startScan: vi.fn(),
    getFolderTree: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appGetScreenshotFolderTree: mocks.getFolderTree,
        appGetScreenshotFolderImages: vi.fn().mockResolvedValue([])
    }
}));

vi.mock('@/repositories/configRepository', () => ({
    default: {
        getString: vi.fn().mockResolvedValue(''),
        getObject: vi.fn().mockResolvedValue({}),
        setString: vi.fn().mockResolvedValue(undefined),
        setObject: vi.fn().mockResolvedValue(undefined)
    }
}));

vi.mock('@/services/screenshotLibraryScanService', () => ({
    getCurrentScreenshotLibraryScanStatus: vi.fn().mockResolvedValue({
        running: false,
        scanned: 0,
        indexed: 0,
        changed: 0,
        skipped: 0,
        deleted: 0,
        error: null,
        lastScanAt: null
    }),
    startScreenshotLibraryScan: mocks.startScan,
    subscribeScreenshotLibraryScanStatus: () => () => {}
}));

vi.mock('@/services/toastService', () => ({
    toast: { add: vi.fn() }
}));

import { useScreenshotGalleryController } from './useScreenshotGalleryController';

describe('useScreenshotGalleryController', () => {
    it('scans the library once when the page opens, not again for every folder picked', async () => {
        mocks.startScan.mockResolvedValue({ running: false, error: null });
        mocks.getFolderTree.mockResolvedValue({
            rootPath: 'C:/Shots',
            folders: []
        });
        const setSearchParams = vi.fn();
        const { rerender } = renderHook(
            ({ routeFolder }) =>
                useScreenshotGalleryController({
                    isGalleryMode: true,
                    routeFolder,
                    screenshotCacheStatus: {
                        supported: true,
                        enabled: true,
                        available: true,
                        reason: ''
                    },
                    setSearchParams
                }),
            { initialProps: { routeFolder: '' } }
        );
        await waitFor(() => expect(mocks.startScan).toHaveBeenCalledTimes(1));

        rerender({ routeFolder: 'C:/Shots/2026-10' });
        rerender({ routeFolder: 'C:/Shots/2026-11' });
        await new Promise((resolve) => setTimeout(resolve, 20));

        expect(mocks.startScan).toHaveBeenCalledTimes(1);
    });
});
