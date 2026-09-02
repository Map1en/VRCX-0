import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getFileAnalysis: vi.fn()
}));

vi.mock('@/lib/entityQueryCache', () => ({
    entityQueryPolicies: { fileAnalysis: {} },
    queryKeys: { fileAnalysis: vi.fn(() => ['file-analysis']) },
    fetchCachedData: ({ queryFn }: { queryFn(): Promise<unknown> }) => queryFn()
}));

vi.mock('@/repositories/vrchatAuthRepository', () => ({
    default: { getFileAnalysis: mocks.getFileAnalysis }
}));

import { getFileAnalysisForUnityPackages } from './fileAnalysis';

describe('getFileAnalysisForUnityPackages', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('preserves avatar stats and formats analysis byte sizes', async () => {
        mocks.getFileAnalysis.mockResolvedValue({
            json: {
                success: true,
                performanceRating: 'Poor',
                fileSize: 10485760,
                uncompressedSize: 26214400,
                avatarStats: {
                    totalPolygons: 123456,
                    totalTextureUsage: 5242880,
                    physBoneComponentCount: 12
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

        expect(mocks.getFileAnalysis).toHaveBeenCalledWith({
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
                physBoneComponentCount: 12
            }
        });
    });
});
