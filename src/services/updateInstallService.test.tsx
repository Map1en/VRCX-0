import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    confirmInstall: vi.fn(),
    openExternalLink: vi.fn(),
    restartApplication: vi.fn(),
    toastError: vi.fn(),
    toastLoading: vi.fn(),
    toastSuccess: vi.fn()
}));

vi.mock('@/services/updateService', () => ({
    confirmInstall: mocks.confirmInstall,
    formatReleaseDisplayVersion: (value: unknown) => String(value || '')
}));

vi.mock('@/services/entityMediaService', () => ({
    openExternalLink: mocks.openExternalLink
}));

vi.mock('@/services/shellIntegrationService', () => ({
    restartApplication: mocks.restartApplication
}));

vi.mock('@/services/i18nService', () => ({
    default: {
        t: (key: string, values?: Record<string, unknown>) =>
            values ? `${key}:${JSON.stringify(values)}` : key
    }
}));

vi.mock('sonner', () => ({
    toast: {
        error: mocks.toastError,
        loading: mocks.toastLoading,
        success: mocks.toastSuccess
    }
}));

import { useRuntimeStore } from '@/state/runtimeStore';

import {
    handleAppUpdateDownloadProgressEvent,
    handleAppUpdateInstalledEvent,
    installUpdateRelease,
    openOrInstallLatestAvailableUpdate
} from './updateInstallService';

function tauriRelease() {
    return {
        updaterType: 'tauri' as const,
        manifestUrl:
            'https://github.com/Map1en/VRCX-0/releases/latest/download/latest_windows.json',
        target: 'windows-x86_64-stable',
        channel: 'Stable' as const,
        htmlUrl: 'https://github.com/Map1en/VRCX-0/releases/tag/v2.7.0',
        canonicalVersion: '2.7.0',
        displayVersion: '2.7.0',
        tagName: 'v2.7.0',
        displayName: 'VRCX-0 2.7.0',
        prerelease: false,
        publishedAt: '2026-06-22T00:00:00Z',
        body: ''
    };
}

describe('openOrInstallLatestAvailableUpdate', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useRuntimeStore.getState().resetRuntimeState();
        useRuntimeStore.getState().setHostCapabilities({
            platform: 'windows',
            arch: 'x86_64',
            linuxPackageKind: ''
        });
    });

    it('opens GitHub for a manual preview update release', async () => {
        useRuntimeStore.getState().setUpdateLoopState({
            latestUpdaterRelease: {
                updaterType: 'manual',
                htmlUrl: 'https://github.com/Map1en/VRCX-0/releases/tag/v2.7.0',
                canonicalVersion: '2.7.0',
                displayVersion: '2.7.0',
                tagName: 'v2.7.0',
                displayName: 'VRCX-0 2.7.0'
            }
        });

        await openOrInstallLatestAvailableUpdate();

        expect(mocks.openExternalLink).toHaveBeenCalledWith(
            'https://github.com/Map1en/VRCX-0/releases/tag/v2.7.0'
        );
        expect(mocks.confirmInstall).not.toHaveBeenCalled();
        expect(mocks.toastError).not.toHaveBeenCalled();
    });

    it('keeps installing when the latest update has Tauri updater metadata', async () => {
        useRuntimeStore.getState().setUpdateLoopState({
            latestUpdaterRelease: {
                updaterType: 'tauri',
                manifestUrl:
                    'https://github.com/Map1en/VRCX-0/releases/latest/download/latest_windows.json',
                target: 'windows-x86_64-stable',
                htmlUrl: 'https://github.com/Map1en/VRCX-0/releases/tag/v2.7.0',
                canonicalVersion: '2.7.0',
                displayVersion: '2.7.0',
                tagName: 'v2.7.0',
                displayName: 'VRCX-0 2.7.0'
            }
        });
        mocks.confirmInstall.mockResolvedValue({});

        await openOrInstallLatestAvailableUpdate();

        expect(mocks.confirmInstall).toHaveBeenCalledWith('2.7.0');
        expect(mocks.openExternalLink).not.toHaveBeenCalled();
    });

    it('installs a passed Tauri update release', async () => {
        mocks.confirmInstall.mockResolvedValue({});

        const installed = await installUpdateRelease(tauriRelease());

        expect(installed).toBe(true);
        expect(mocks.confirmInstall).toHaveBeenCalledWith('2.7.0');
        expect(mocks.toastLoading).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({ duration: Infinity })
        );
        expect(mocks.restartApplication).not.toHaveBeenCalled();
    });

    it('shows an error toast and resets download state when install fails', async () => {
        useRuntimeStore.getState().setUpdateLoopState({
            autoDownloadState: 'downloaded',
            downloadedVersion: '2.7.0',
            downloadProgress: 100
        });
        mocks.confirmInstall.mockRejectedValue(new Error('access denied'));

        const installed = await installUpdateRelease(tauriRelease());

        expect(installed).toBe(false);
        expect(useRuntimeStore.getState().updateLoop.autoDownloadState).toBe(
            'idle'
        );
        expect(useRuntimeStore.getState().updateLoop.downloadedVersion).toBe(
            null
        );
        expect(mocks.toastError).toHaveBeenCalled();
        expect(mocks.restartApplication).not.toHaveBeenCalled();
    });

    it('rejects a passed manual update release without installing', async () => {
        const installed = await installUpdateRelease({
            updaterType: 'manual',
            channel: 'Stable',
            htmlUrl: 'https://github.com/Map1en/VRCX-0/releases/tag/v2.7.0',
            canonicalVersion: '2.7.0',
            displayVersion: '2.7.0',
            tagName: 'v2.7.0',
            displayName: 'VRCX-0 2.7.0',
            prerelease: false,
            publishedAt: '2026-06-22T00:00:00Z',
            body: ''
        });

        expect(installed).toBe(false);
        expect(mocks.confirmInstall).not.toHaveBeenCalled();
        expect(mocks.restartApplication).not.toHaveBeenCalled();
        expect(mocks.toastError).toHaveBeenCalledWith(
            'message.vrcx_updater.no_downloadable_releases_found',
            expect.objectContaining({
                position: 'bottom-right'
            })
        );
    });
});

describe('handleAppUpdateDownloadProgressEvent', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useRuntimeStore.getState().resetRuntimeState();
    });

    it('mirrors progress into the runtimeStore updateLoop', () => {
        handleAppUpdateDownloadProgressEvent({
            version: '2.7.0',
            phase: 'downloading',
            downloadedBytes: 50,
            totalBytes: 100,
            percent: 50
        });

        const updateLoop = useRuntimeStore.getState().updateLoop;
        expect(updateLoop.autoDownloadState).toBe('downloading');
        expect(updateLoop.downloadedVersion).toBe('2.7.0');
        expect(updateLoop.downloadProgress).toBe(50);
    });

    it('only renders the progress toast while a direct install is in flight', () => {
        handleAppUpdateDownloadProgressEvent({
            version: '2.7.0',
            phase: 'downloading',
            downloadedBytes: 50,
            totalBytes: 100,
            percent: 50
        });

        expect(mocks.toastLoading).not.toHaveBeenCalled();
    });

    it('renders the progress toast for a direct install in flight', async () => {
        mocks.confirmInstall.mockImplementation(() => new Promise(() => {}));

        const installPromise = installUpdateRelease(tauriRelease());
        mocks.toastLoading.mockClear();

        handleAppUpdateDownloadProgressEvent({
            version: '2.7.0',
            phase: 'downloading',
            downloadedBytes: 50,
            totalBytes: 100,
            percent: 50
        });

        expect(mocks.toastLoading).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({ description: expect.anything() })
        );

        void installPromise;
    });
});

describe('handleAppUpdateInstalledEvent', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useRuntimeStore.getState().resetRuntimeState();
        useRuntimeStore.getState().setUpdateLoopState({
            hasAvailableUpdate: true,
            latestUpdaterRelease: tauriRelease(),
            autoDownloadState: 'downloaded',
            downloadedVersion: '2.7.0',
            downloadProgress: 100
        });
    });

    it('resets update loop state, shows the ready toast, and restarts', () => {
        handleAppUpdateInstalledEvent({
            version: '2.7.0',
            metadata: {
                currentVersion: '2.6.0',
                version: '2.7.0',
                date: null,
                body: null
            }
        });

        const updateLoop = useRuntimeStore.getState().updateLoop;
        expect(updateLoop.hasAvailableUpdate).toBe(false);
        expect(updateLoop.latestUpdaterRelease).toBe(null);
        expect(updateLoop.autoDownloadState).toBe('idle');
        expect(mocks.toastSuccess).toHaveBeenCalled();
        expect(mocks.restartApplication).toHaveBeenCalled();
    });
});
