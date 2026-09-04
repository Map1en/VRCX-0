import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getFileAnalysis = vi.hoisted(() => vi.fn());

vi.mock('@/repositories/vrchatAuthRepository', () => ({
    default: { getFileAnalysis }
}));

import { clearEntityQueryCache, queryKeys } from './entityQueryCache';
import { getFileAnalysisForUnityPackages } from './fileAnalysis';
import { queryClient } from './queryClient';

const unityPackage = {
    assetUrl: 'https://api.vrchat.cloud/api/1/file/file_example/2/file',
    platform: 'standalonewindows'
};

describe('file analysis cache', () => {
    beforeEach(() => getFileAnalysis.mockReset());
    afterEach(() => clearEntityQueryCache());

    it('caches only the display size and shares a request across platforms and callers', async () => {
        getFileAnalysis.mockResolvedValue({
            json: {
                success: true,
                fileSize: 1_572_864,
                encryptionKey: 'not-needed-by-the-view',
                avatarStats: { textures: [{ name: 'unused', size: 123 }] }
            }
        });
        const options = {
            unityPackages: [
                unityPackage,
                { ...unityPackage, platform: 'android' }
            ],
            endpoint: 'https://api.vrchat.cloud/api/1'
        };
        const [first, second] = await Promise.all([
            getFileAnalysisForUnityPackages(options),
            getFileAnalysisForUnityPackages(options)
        ]);
        expect(first).toEqual({
            standalonewindows: { _fileSize: '1.50 MB' },
            android: { _fileSize: '1.50 MB' }
        });
        expect(second).toEqual(first);
        expect(getFileAnalysis).toHaveBeenCalledTimes(1);
        expect(
            queryClient.getQueryData(
                queryKeys.fileAnalysis(
                    { fileId: 'file_example', version: 2, variant: 'security' },
                    options.endpoint
                )
            )
        ).toBe('1.50 MB');
        expect(await getFileAnalysisForUnityPackages(options)).toEqual(first);
        expect(getFileAnalysis).toHaveBeenCalledTimes(1);
    });

    it('keeps unsuccessful analysis cached without retaining the response body', async () => {
        getFileAnalysis.mockResolvedValue({
            json: { success: false, details: ['unused'] }
        });
        const options = { unityPackages: [unityPackage] };
        expect(await getFileAnalysisForUnityPackages(options)).toEqual({});
        expect(await getFileAnalysisForUnityPackages(options)).toEqual({});
        expect(getFileAnalysis).toHaveBeenCalledTimes(1);
        expect(queryClient.getQueryCache().getAll()[0]?.state.data).toBeNull();
    });

    it.each([
        [{ success: true, fileSize: 0 }, '0.00 MB'],
        [{ success: true, fileSize: '1048576' }, '1.00 MB'],
        [{ success: true }, ''],
        [{ success: true, fileSize: 'invalid' }, '']
    ])('preserves size formatting for %j', async (json, expected) => {
        getFileAnalysis.mockResolvedValue({ json });
        expect(
            await getFileAnalysisForUnityPackages({
                unityPackages: [unityPackage]
            })
        ).toEqual({
            standalonewindows: { _fileSize: expected }
        });
    });

    it('keeps endpoints and file versions isolated', async () => {
        getFileAnalysis.mockResolvedValue({
            json: { success: true, fileSize: 1_048_576 }
        });
        await getFileAnalysisForUnityPackages({
            unityPackages: [unityPackage],
            endpoint: 'https://one.example/api/1'
        });
        await getFileAnalysisForUnityPackages({
            unityPackages: [unityPackage],
            endpoint: 'https://two.example/api/1'
        });
        await getFileAnalysisForUnityPackages({
            unityPackages: [
                {
                    ...unityPackage,
                    assetUrl: unityPackage.assetUrl.replace('/2/', '/3/')
                }
            ],
            endpoint: 'https://one.example/api/1'
        });
        expect(getFileAnalysis).toHaveBeenCalledTimes(3);
    });
});
