import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    fetchGithubReleases: vi.fn(),
    checkTauriUpdate: vi.fn(),
    discardPendingTauriUpdate: vi.fn(),
    downloadTauriUpdate: vi.fn(),
    downloadAndInstallTauriUpdate: vi.fn(),
    installPendingTauriUpdate: vi.fn(),
    getStorageString: vi.fn()
}));

vi.mock('@/repositories/externalApiRepository', () => ({
    default: {
        fetchGithubReleases: mocks.fetchGithubReleases
    }
}));

vi.mock('@/repositories/storageRepository', () => ({
    default: {
        getString: mocks.getStorageString
    }
}));

vi.mock('@/platform/tauri/updater', () => ({
    checkTauriUpdate: mocks.checkTauriUpdate,
    discardPendingTauriUpdate: mocks.discardPendingTauriUpdate,
    downloadTauriUpdate: mocks.downloadTauriUpdate,
    downloadAndInstallTauriUpdate: mocks.downloadAndInstallTauriUpdate,
    installPendingTauriUpdate: mocks.installPendingTauriUpdate
}));

import {
    discardPendingUpdate,
    downloadUpdate,
    getPreviewStableReleaseUpdateMode,
    handlePreviewStableReleaseUpdateCheck,
    installPendingUpdate
} from './updateService';

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

function installableRelease() {
    return {
        canonicalVersion: '2.7.0',
        displayVersion: '2.7.0',
        htmlUrl: 'https://github.com/Map1en/VRCX-0/releases/tag/v2.7.0',
        tagName: 'v2.7.0',
        displayName: 'VRCX-0 2.7.0',
        prerelease: false,
        publishedAt: '2026-06-22T00:00:00Z',
        body: '',
        channel: 'Stable' as const,
        updaterType: 'tauri' as const,
        manifestUrl:
            'https://github.com/Map1en/VRCX-0/releases/latest/download/latest_windows.json',
        target: 'windows-x86_64-stable'
    };
}

describe('updateService preview stable update checks', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal('VRCX_0_BUILD_LABEL', 'preview');
        vi.stubGlobal('VRCX_0_BUILD_BADGE', 'Preview 20260621-1530');
        mocks.fetchGithubReleases.mockResolvedValue({
            status: 200,
            data: [release({ publishedAt: '2026-06-21T07:00:00Z' })]
        });
        mocks.getStorageString.mockResolvedValue('');
    });

    it('returns the latest stable release when it was published after the preview build timestamp', async () => {
        const update = await handlePreviewStableReleaseUpdateCheck({
            hostPlatform: 'windows',
            hostArch: 'x86_64',
            linuxPackageKind: ''
        });

        expect(update.handled).toBe(true);
        expect(update.release?.tagName).toBe('v2.7.0');
        expect(update.release?.updaterType).toBe('manual');
    });

    it('does not return a stable release published before the preview build timestamp', async () => {
        mocks.fetchGithubReleases.mockResolvedValue({
            status: 200,
            data: [release({ publishedAt: '2026-06-21T06:29:59Z' })]
        });

        await expect(
            handlePreviewStableReleaseUpdateCheck({
                hostPlatform: 'windows',
                hostArch: 'x86_64',
                linuxPackageKind: ''
            })
        ).resolves.toEqual({
            handled: true,
            release: null
        });
    });

    it('does not check GitHub when the build is not a timestamped preview build', async () => {
        vi.stubGlobal('VRCX_0_BUILD_LABEL', 'devkit');
        vi.stubGlobal('VRCX_0_BUILD_BADGE', 'Dev Kit 20260621-1530');

        await expect(
            handlePreviewStableReleaseUpdateCheck({
                hostPlatform: 'windows',
                hostArch: 'x86_64',
                linuxPackageKind: ''
            })
        ).resolves.toEqual({
            handled: false,
            release: null
        });
        expect(mocks.fetchGithubReleases).not.toHaveBeenCalled();
    });

    it('does not check GitHub when the preview badge timestamp cannot be parsed', async () => {
        vi.stubGlobal('VRCX_0_BUILD_BADGE', 'Preview latest');

        expect(getPreviewStableReleaseUpdateMode().enabled).toBe(true);
        await expect(
            handlePreviewStableReleaseUpdateCheck({
                hostPlatform: 'windows',
                hostArch: 'x86_64',
                linuxPackageKind: ''
            })
        ).resolves.toEqual({
            handled: true,
            release: null
        });
        expect(mocks.fetchGithubReleases).not.toHaveBeenCalled();
    });
});

describe('updateService pending update downloads', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getStorageString.mockResolvedValue('');
    });

    it('downloads a Tauri update into the pending slot and reports progress', async () => {
        const progress = vi.fn();
        mocks.downloadTauriUpdate.mockImplementation(
            async (_version: string, _request: unknown, onEvent: any) => {
                onEvent({
                    event: 'Started',
                    data: { contentLength: 100 }
                });
                onEvent({
                    event: 'Progress',
                    data: { chunkLength: 25 }
                });
                return {
                    currentVersion: '2.6.0',
                    version: '2.7.0',
                    date: null,
                    body: null,
                    rawJson: {}
                };
            }
        );

        await downloadUpdate(installableRelease(), {
            hostPlatform: 'windows',
            hostArch: 'x86_64',
            linuxPackageKind: '',
            onDownloadProgress: progress
        });

        expect(mocks.downloadTauriUpdate).toHaveBeenCalledWith(
            '2.7.0',
            expect.objectContaining({
                manifestUrl:
                    'https://github.com/Map1en/VRCX-0/releases/latest/download/latest_windows.json',
                target: 'windows-x86_64-stable'
            }),
            expect.any(Function)
        );
        expect(progress).toHaveBeenCalledWith({
            downloadedBytes: 25,
            totalBytes: 100,
            percent: 25
        });
    });

    it('reuses the same pending download promise for the same version', async () => {
        let resolveDownload: (value: any) => void = () => {};
        let markDownloadStarted: () => void = () => {};
        const downloadStarted = new Promise<void>((resolve) => {
            markDownloadStarted = resolve;
        });
        mocks.downloadTauriUpdate.mockImplementation(() => {
            markDownloadStarted();
            return new Promise((resolve) => {
                resolveDownload = resolve;
            });
        });

        const first = downloadUpdate(installableRelease(), {
            hostPlatform: 'windows',
            hostArch: 'x86_64',
            linuxPackageKind: ''
        });
        const second = downloadUpdate(installableRelease(), {
            hostPlatform: 'windows',
            hostArch: 'x86_64',
            linuxPackageKind: ''
        });

        await downloadStarted;
        expect(mocks.downloadTauriUpdate).toHaveBeenCalledTimes(1);
        resolveDownload({
            currentVersion: '2.6.0',
            version: '2.7.0',
            date: null,
            body: null,
            rawJson: {}
        });
        await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    });

    it('forwards in-flight download progress to same-version callers', async () => {
        const firstProgress = vi.fn();
        const secondProgress = vi.fn();
        let resolveDownload: (value: any) => void = () => {};
        let markDownloadStarted: () => void = () => {};
        let emitDownloadEvent: (event: any) => void = () => {};
        const downloadStarted = new Promise<void>((resolve) => {
            markDownloadStarted = resolve;
        });
        mocks.downloadTauriUpdate.mockImplementation(
            (_version: string, _request: unknown, onEvent: any) => {
                emitDownloadEvent = onEvent;
                markDownloadStarted();
                return new Promise((resolve) => {
                    resolveDownload = resolve;
                });
            }
        );

        const first = downloadUpdate(installableRelease(), {
            hostPlatform: 'windows',
            hostArch: 'x86_64',
            linuxPackageKind: '',
            onDownloadProgress: firstProgress
        });
        await downloadStarted;
        emitDownloadEvent({
            event: 'Started',
            data: { contentLength: 100 }
        });
        emitDownloadEvent({
            event: 'Progress',
            data: { chunkLength: 25 }
        });

        const second = downloadUpdate(installableRelease(), {
            hostPlatform: 'windows',
            hostArch: 'x86_64',
            linuxPackageKind: '',
            onDownloadProgress: secondProgress
        });

        expect(secondProgress).toHaveBeenLastCalledWith({
            downloadedBytes: 25,
            totalBytes: 100,
            percent: 25
        });

        emitDownloadEvent({
            event: 'Progress',
            data: { chunkLength: 25 }
        });
        expect(firstProgress).toHaveBeenLastCalledWith({
            downloadedBytes: 50,
            totalBytes: 100,
            percent: 50
        });
        expect(secondProgress).toHaveBeenLastCalledWith({
            downloadedBytes: 50,
            totalBytes: 100,
            percent: 50
        });

        resolveDownload({
            currentVersion: '2.6.0',
            version: '2.7.0',
            date: null,
            body: null,
            rawJson: {}
        });
        await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    });

    it('wraps pending install and discard commands', async () => {
        mocks.installPendingTauriUpdate.mockResolvedValue({
            currentVersion: '2.6.0',
            version: '2.7.0',
            date: null,
            body: null,
            rawJson: {}
        });
        mocks.discardPendingTauriUpdate.mockResolvedValue(undefined);

        await installPendingUpdate('2.7.0');
        await discardPendingUpdate();

        expect(mocks.installPendingTauriUpdate).toHaveBeenCalledWith('2.7.0');
        expect(mocks.discardPendingTauriUpdate).toHaveBeenCalled();
    });
});
