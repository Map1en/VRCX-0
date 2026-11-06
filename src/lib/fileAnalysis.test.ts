import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getFileAnalysis = vi.hoisted(() => vi.fn());

vi.mock('@/repositories/vrchatAuthRepository', () => ({
    default: { getFileAnalysis }
}));

import { queryKeys } from './entityQueryCache';
import {
    getFileAnalysisForUnityPackages,
    hasFileAnalysisCandidates,
    isPendingFileAnalysisError
} from './fileAnalysis';
import { queryClient } from './queryClient';

const unityPackage = {
    assetUrl: 'https://api.vrchat.cloud/api/1/file/file_example/2/file',
    platform: 'standalonewindows'
};

describe('getFileAnalysisForUnityPackages', () => {
    beforeEach(() => getFileAnalysis.mockReset());
    afterEach(() => queryClient.clear());

    it('preserves avatar stats and formats analysis byte sizes', async () => {
        getFileAnalysis.mockResolvedValue({
            json: {
                success: true,
                performanceRating: 'Poor',
                fileSize: 10485760,
                uncompressedSize: 26214400,
                avatarStats: {
                    totalPolygons: 123456,
                    totalTextureUsage: 5242880,
                    physBoneComponentCount: 12,
                    raycastCount: 4
                }
            }
        });

        const result = await getFileAnalysisForUnityPackages({
            unityPackages: [
                {
                    platform: 'standalonewindows',
                    assetUrl:
                        'https://api.vrchat.cloud/api/1/file/file_12345678-1234-1234-1234-1234567890ab/2/file'
                }
            ],
            endpoint: 'https://api.vrchat.cloud/api/1'
        });

        expect(getFileAnalysis).toHaveBeenCalledWith({
            fileId: 'file_12345678-1234-1234-1234-1234567890ab',
            version: 2,
            variant: 'security'
        });
        expect(result.standalonewindows).toMatchObject({
            performanceRating: 'Poor',
            _fileSize: '10.00 MB',
            _uncompressedSize: '25.00 MB',
            _totalTextureUsage: '5.00 MB',
            avatarStats: {
                totalPolygons: 123456,
                totalTextureUsage: 5242880,
                physBoneComponentCount: 12,
                raycastCount: 4
            }
        });
    });

    it('analyzes the newest compatible package per platform', async () => {
        getFileAnalysis.mockResolvedValue({
            json: { success: true, fileSize: 1024 }
        });

        await getFileAnalysisForUnityPackages({
            unityPackages: [
                {
                    ...unityPackage,
                    assetUrl:
                        'https://api.vrchat.cloud/api/1/file/file_example/1/file',
                    unitySortNumber: '20190431000'
                },
                {
                    ...unityPackage,
                    assetUrl:
                        'https://api.vrchat.cloud/api/1/file/file_example/3/file',
                    unitySortNumber: '20220322000'
                },
                {
                    ...unityPackage,
                    assetUrl:
                        'https://api.vrchat.cloud/api/1/file/file_example/4/file',
                    unitySortNumber: '60000067000'
                }
            ],
            sdkUnityVersion: '2022.3.22f1',
            endpoint: 'https://api.vrchat.cloud/api/1'
        });

        expect(getFileAnalysis).toHaveBeenCalledTimes(1);
        expect(getFileAnalysis).toHaveBeenCalledWith({
            fileId: 'file_example',
            version: 3,
            variant: 'security'
        });
    });

    it('identifies analysis responses that are not ready yet', () => {
        const pendingError = Object.assign(
            new Error('Analysis not yet available'),
            {
                status: 202,
                endpoint:
                    'analysis/file_12345678-1234-1234-1234-1234567890ab/2/security',
                payload: {
                    error: {
                        message: 'Analysis not yet available',
                        status_code: 202
                    }
                }
            }
        );

        expect(isPendingFileAnalysisError(pendingError)).toBe(true);
        expect(isPendingFileAnalysisError(new Error('Network error'))).toBe(
            false
        );
    });

    it('identifies Unity packages that can request file analysis', () => {
        expect(
            hasFileAnalysisCandidates({
                unityPackages: [
                    {
                        platform: 'standalonewindows',
                        assetUrl:
                            'https://api.vrchat.cloud/api/1/file/file_12345678-1234-1234-1234-1234567890ab/2/file'
                    }
                ]
            })
        ).toBe(true);
    });

    it('rejects packages without a usable file reference', () => {
        expect(
            hasFileAnalysisCandidates({
                unityPackages: [
                    {
                        platform: 'standalonewindows',
                        assetUrl: '',
                        variant: 'standard'
                    },
                    {
                        platform: 'android',
                        assetUrl:
                            'https://api.vrchat.cloud/api/1/file/file_12345678-1234-1234-1234-1234567890ab/2/file',
                        variant: 'impostor'
                    }
                ]
            })
        ).toBe(false);
    });

    it('caches only display-safe analysis and shares a request across callers', async () => {
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
        ).toEqual({ _fileSize: '1.50 MB' });
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
