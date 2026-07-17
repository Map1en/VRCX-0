import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    fetchGithubReleases: vi.fn(),
    appAppUpdateDownloadStatusGet: vi.fn(),
    appAppUpdateInstallConfirm: vi.fn()
}));

vi.mock('@/repositories/externalApiRepository', () => ({
    default: {
        fetchGithubReleases: mocks.fetchGithubReleases
    }
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appAppUpdateDownloadStatusGet: mocks.appAppUpdateDownloadStatusGet,
        appAppUpdateInstallConfirm: mocks.appAppUpdateInstallConfirm
    }
}));

import { confirmInstall, getDownloadStatus } from './updateService';
import * as updateService from './updateService';

function release({ publishedAt }: { publishedAt: string }) {
    return {
        tag_name: 'v2.7.0',
        assets: Array<unknown>(),
        html_url: 'https://github.com/Map1en/VRCX-0/releases/tag/v2.7.0',
        name: 'VRCX-0 2.7.0',
        prerelease: false,
        published_at: publishedAt,
        body: ''
    };
}

describe('updateService facade', () => {
    it('preserves the public runtime exports', () => {
        expect(Object.keys(updateService).sort()).toEqual([
            'canInstallUpdatesOnPlatform',
            'confirmInstall',
            'fetchBranchReleases',
            'fetchLatestBranchRelease',
            'formatReleaseDisplayVersion',
            'getDownloadStatus',
            'getPreviewStableReleaseUpdateMode',
            'sanitizeBranch',
            'toNormalizedReleaseFromSnapshot'
        ]);
    });
});

describe('updateService branch release fetching', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('fetches and normalizes releases for the Stable branch', async () => {
        mocks.fetchGithubReleases.mockResolvedValue({
            status: 200,
            data: [release({ publishedAt: '2026-06-21T07:00:00Z' })]
        });

        const releases = await updateService.fetchBranchReleases('Stable', {
            requireInstallerAsset: false
        });

        expect(releases).toHaveLength(1);
        expect(releases[0].canonicalVersion).toBe('2.7.0');
    });

    it('throws when the GitHub release request fails', async () => {
        mocks.fetchGithubReleases.mockResolvedValue({
            status: 500,
            data: []
        });

        await expect(
            updateService.fetchLatestBranchRelease('Stable')
        ).rejects.toThrow('GitHub release request failed (500).');
    });
});

describe('updateService backend-owned download/install commands', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('delegates download status and install to the thin backend commands', async () => {
        mocks.appAppUpdateDownloadStatusGet.mockResolvedValue({
            phase: 'idle',
            version: null,
            downloadedBytes: 0,
            totalBytes: 0,
            percent: 0,
            error: null
        });
        mocks.appAppUpdateInstallConfirm.mockResolvedValue({
            currentVersion: '2.6.0',
            version: '2.7.0',
            date: null,
            body: null
        });

        await getDownloadStatus();
        await confirmInstall('2.7.0');

        expect(mocks.appAppUpdateDownloadStatusGet).toHaveBeenCalled();
        expect(mocks.appAppUpdateInstallConfirm).toHaveBeenCalledWith('2.7.0');
    });
});
