// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getAvatarGallery: vi.fn(),
    getFileAnalysisForUnityPackages: vi.fn(),
    hasFileAnalysisCandidates: vi.fn(),
    readAvatarCacheInfo: vi.fn()
}));

vi.mock('@/lib/fileAnalysis', () => ({
    getFileAnalysisForUnityPackages: mocks.getFileAnalysisForUnityPackages,
    hasFileAnalysisCandidates: mocks.hasFileAnalysisCandidates
}));
vi.mock('@/repositories/avatarProfileRepository', () => ({
    default: {
        getAvatarGallery: mocks.getAvatarGallery
    }
}));
vi.mock('./avatarCacheAdapter', () => ({
    readAvatarCacheInfo: mocks.readAvatarCacheInfo
}));

import { useAvatarDialogSideData } from './useAvatarDialogSideData';

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((complete) => {
        resolve = complete;
    });
    return { promise, resolve };
}

const avatar = {
    id: 'avtr_test',
    assetUrl: 'https://example.test/avatar.vrca',
    updated_at: '2026-08-19T00:00:00.000Z',
    unityPackages: [],
    version: 1
};

describe('useAvatarDialogSideData', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.hasFileAnalysisCandidates.mockReturnValue(true);
        mocks.getFileAnalysisForUnityPackages.mockResolvedValue({});
        mocks.readAvatarCacheInfo.mockResolvedValue({
            inCache: true,
            cacheSize: '12 MB',
            cacheLocked: false,
            cachePath: 'C:/cache/avatar'
        });
    });

    it('waits for Gallery activation before requesting gallery rows', async () => {
        mocks.getAvatarGallery.mockResolvedValue([
            { url: 'https://example.test/gallery.png' }
        ]);
        const { rerender, result } = renderHook(
            ({ galleryActive }) =>
                useAvatarDialogSideData({
                    avatar,
                    currentEndpoint: 'https://api.example.test',
                    galleryActive,
                    sdkUnityVersion: '2022.3.22f1'
                }),
            { initialProps: { galleryActive: false } }
        );

        await waitFor(() => {
            expect(mocks.readAvatarCacheInfo).toHaveBeenCalledOnce();
            expect(
                mocks.getFileAnalysisForUnityPackages
            ).toHaveBeenCalledOnce();
        });
        expect(mocks.getAvatarGallery).not.toHaveBeenCalled();
        expect(result.current.galleryStatus).toBe('idle');

        rerender({ galleryActive: true });

        await waitFor(() => {
            expect(mocks.getAvatarGallery).toHaveBeenCalledWith({
                avatarId: avatar.id
            });
            expect(result.current.galleryStatus).toBe('ready');
        });
        expect(result.current.avatarSideData.galleryImages).toEqual([
            'https://example.test/gallery.png'
        ]);
    });

    it('starts cache and file analysis without Gallery and settles them independently', async () => {
        const gallery = deferred<Array<{ url: string }>>();
        const fileAnalysis = deferred<Record<string, never>>();
        mocks.getAvatarGallery.mockReturnValue(gallery.promise);
        mocks.getFileAnalysisForUnityPackages.mockReturnValue(
            fileAnalysis.promise
        );
        const { result } = renderHook(() =>
            useAvatarDialogSideData({
                avatar,
                currentEndpoint: 'https://api.example.test',
                galleryActive: true,
                sdkUnityVersion: '2022.3.22f1'
            })
        );

        await waitFor(() => {
            expect(result.current.avatarSideData.cache.inCache).toBe(true);
            expect(result.current.fileAnalysisStatus).toBe('running');
            expect(result.current.galleryStatus).toBe('running');
        });
        expect(mocks.getFileAnalysisForUnityPackages).toHaveBeenCalledOnce();

        await act(async () => {
            gallery.resolve([{ url: 'https://example.test/gallery.png' }]);
            fileAnalysis.resolve({});
            await gallery.promise;
            await fileAnalysis.promise;
        });

        await waitFor(() => {
            expect(result.current.fileAnalysisStatus).toBe('error');
            expect(result.current.galleryStatus).toBe('ready');
        });
    });

    it('still reads cache when no file analysis package is available', async () => {
        mocks.hasFileAnalysisCandidates.mockReturnValue(false);

        const { result } = renderHook(() =>
            useAvatarDialogSideData({
                avatar,
                currentEndpoint: 'https://api.example.test',
                galleryActive: false,
                sdkUnityVersion: '2022.3.22f1'
            })
        );

        await waitFor(() => {
            expect(result.current.avatarSideData.cache.inCache).toBe(true);
        });
        expect(result.current.fileAnalysisStatus).toBe('idle');
        expect(mocks.getFileAnalysisForUnityPackages).not.toHaveBeenCalled();
    });
});
