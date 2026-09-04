import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    confirmInstall: vi.fn(),
    openExternalLink: vi.fn(),
    restartApplication: vi.fn(),
    toastDismiss: vi.fn(),
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
        dismiss: mocks.toastDismiss,
        error: mocks.toastError,
        loading: mocks.toastLoading,
        success: mocks.toastSuccess
    }
}));

import { MINUTE_MS } from '@/shared/constants/time';
import { useRuntimeStore } from '@/state/runtimeStore';

import {
    handleAppUpdateDownloadProgressEvent,
    handleAppUpdateDownloadStatusSnapshot,
    handleAppUpdateInstalledEvent,
    installUpdateRelease,
    openOrInstallLatestAvailableUpdate,
    resetAutoDownloadUiDelay,
    shouldShowUpdateUi
} from './updateInstallService';

const AUTO_DOWNLOAD_UI_DELAY_MS = 30 * MINUTE_MS;

function tauriRelease() {
    return {
        updaterType: 'tauri' as const,
        manifestUrl:
            'https://github.com/Map1en/VRCX-0/releases/latest/download/latest_windows.json',
        target: 'windows-x86_64-stable',
        channel: 'stable' as const,
        htmlUrl: 'https://github.com/Map1en/VRCX-0/releases/tag/v2.7.0',
        canonicalVersion: '2.7.0',
        displayVersion: '2.7.0',
        tagName: 'v2.7.0',
        displayName: 'VRCX-0 2.7.0',
        title: 'VRCX-0 2.7.0',
        currentVersion: '2.6.0',
        latestVersion: '2.7.0',
        publishedAt: '2026-06-22T00:00:00Z',
        body: ''
    };
}

afterEach(() => {
    resetAutoDownloadUiDelay();
    vi.useRealTimers();
});

describe('openOrInstallLatestAvailableUpdate', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useRuntimeStore.getState().resetRuntimeState();
        useRuntimeStore.getState().setHostCapabilities({
            ...useRuntimeStore.getState().hostCapabilities,
            platform: 'windows',
            arch: 'x86_64',
            linuxPackageKind: 'unknown'
        });
    });

    it('opens GitHub for a manual preview update release', async () => {
        useRuntimeStore.getState().setUpdateLoopState({
            latestUpdaterRelease: {
                updaterType: 'manual',
                manifestUrl: '',
                target: '',
                htmlUrl: 'https://github.com/Map1en/VRCX-0/releases/tag/v2.7.0',
                canonicalVersion: '2.7.0',
                displayVersion: '2.7.0',
                channel: 'stable',
                tagName: 'v2.7.0',
                displayName: 'VRCX-0 2.7.0',
                publishedAt: '',
                body: '',
                title: 'VRCX-0 2.7.0',
                currentVersion: '2.6.0',
                latestVersion: '2.7.0'
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
                channel: 'stable',
                tagName: 'v2.7.0',
                displayName: 'VRCX-0 2.7.0',
                publishedAt: '',
                body: '',
                title: 'VRCX-0 2.7.0',
                currentVersion: '2.6.0',
                latestVersion: '2.7.0'
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
        expect(mocks.toastDismiss).toHaveBeenCalledWith(
            'vrcx-update-available'
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
            channel: 'stable',
            htmlUrl: 'https://github.com/Map1en/VRCX-0/releases/tag/v2.7.0',
            canonicalVersion: '2.7.0',
            displayVersion: '2.7.0',
            tagName: 'v2.7.0',
            displayName: 'VRCX-0 2.7.0',
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
            startedAt: new Date().toISOString(),
            downloadedBytes: 50,
            totalBytes: 100,
            percent: 50
        });

        const updateLoop = useRuntimeStore.getState().updateLoop;
        expect(updateLoop.autoDownloadState).toBe('downloading');
        expect(updateLoop.downloadedVersion).toBe('2.7.0');
        expect(updateLoop.downloadProgress).toBe(50);
        expect(updateLoop.downloadedBytes).toBe(50);
    });

    it('keeps a fast background download hidden until restart is ready', () => {
        vi.useFakeTimers();
        const startedAt = new Date().toISOString();
        useRuntimeStore.getState().setUpdateLoopState({
            hasAvailableUpdate: true,
            latestUpdaterRelease: tauriRelease()
        });

        handleAppUpdateDownloadProgressEvent({
            version: '2.7.0',
            phase: 'downloading',
            startedAt,
            downloadedBytes: 50,
            totalBytes: 100,
            percent: 50
        });

        let updateLoop = useRuntimeStore.getState().updateLoop;
        expect(updateLoop.autoDownloadStartedAt).toBe(startedAt);
        expect(shouldShowUpdateUi(updateLoop)).toBe(false);

        vi.advanceTimersByTime(AUTO_DOWNLOAD_UI_DELAY_MS - 1);
        expect(shouldShowUpdateUi(useRuntimeStore.getState().updateLoop)).toBe(
            false
        );

        handleAppUpdateDownloadProgressEvent({
            version: '2.7.0',
            phase: 'downloaded',
            startedAt,
            downloadedBytes: 100,
            totalBytes: 100,
            percent: 100
        });

        updateLoop = useRuntimeStore.getState().updateLoop;
        expect(updateLoop.autoDownloadStartedAt).toBe(null);
        expect(shouldShowUpdateUi(updateLoop)).toBe(true);
    });

    it('reveals update UI immediately when a silent background download fails', () => {
        vi.useFakeTimers();
        const startedAt = new Date().toISOString();
        useRuntimeStore.getState().setUpdateLoopState({
            hasAvailableUpdate: true,
            latestUpdaterRelease: tauriRelease()
        });

        handleAppUpdateDownloadProgressEvent({
            version: '2.7.0',
            phase: 'downloading',
            startedAt,
            downloadedBytes: 50,
            totalBytes: 100,
            percent: 50
        });
        vi.advanceTimersByTime(AUTO_DOWNLOAD_UI_DELAY_MS - 1);
        expect(shouldShowUpdateUi(useRuntimeStore.getState().updateLoop)).toBe(
            false
        );

        handleAppUpdateDownloadProgressEvent({
            version: '2.7.0',
            phase: 'error',
            startedAt,
            downloadedBytes: 50,
            totalBytes: 100,
            percent: 50
        });

        const updateLoop = useRuntimeStore.getState().updateLoop;
        expect(updateLoop.autoDownloadState).toBe('error');
        expect(updateLoop.autoDownloadStartedAt).toBe(null);
        expect(shouldShowUpdateUi(updateLoop)).toBe(true);
    });

    it('reveals update UI when a background download is still running after 30 minutes', () => {
        vi.useFakeTimers();
        const downloadStartedAt = new Date().toISOString();
        useRuntimeStore.getState().setUpdateLoopState({
            hasAvailableUpdate: true,
            latestUpdaterRelease: tauriRelease()
        });

        handleAppUpdateDownloadProgressEvent({
            version: '2.7.0',
            phase: 'downloading',
            startedAt: downloadStartedAt,
            downloadedBytes: 50,
            totalBytes: 100,
            percent: 50
        });
        const startedAt =
            useRuntimeStore.getState().updateLoop.autoDownloadStartedAt;
        vi.advanceTimersByTime(AUTO_DOWNLOAD_UI_DELAY_MS / 2);
        handleAppUpdateDownloadProgressEvent({
            version: '2.7.0',
            phase: 'downloading',
            startedAt: downloadStartedAt,
            downloadedBytes: 75,
            totalBytes: 100,
            percent: 75
        });
        expect(
            useRuntimeStore.getState().updateLoop.autoDownloadStartedAt
        ).toBe(startedAt);
        vi.advanceTimersByTime(AUTO_DOWNLOAD_UI_DELAY_MS / 2);

        expect(shouldShowUpdateUi(useRuntimeStore.getState().updateLoop)).toBe(
            true
        );
    });

    it('restores an overdue background download from the backend start time', () => {
        vi.useFakeTimers();
        vi.setSystemTime('2026-07-18T02:00:00.000Z');
        useRuntimeStore.getState().setUpdateLoopState({
            hasAvailableUpdate: true,
            latestUpdaterRelease: tauriRelease()
        });

        handleAppUpdateDownloadStatusSnapshot({
            version: '2.7.0',
            phase: 'downloading',
            startedAt: '2026-07-18T00:00:00.000Z',
            downloadedBytes: 75,
            totalBytes: 100,
            percent: 75,
            error: null
        });
        vi.advanceTimersByTime(0);

        const updateLoop = useRuntimeStore.getState().updateLoop;
        expect(updateLoop.downloadedBytes).toBe(75);
        expect(shouldShowUpdateUi(updateLoop)).toBe(true);
    });

    it('never shows a toast for the downloading phase, in or out of a direct install', async () => {
        const startedAt = new Date().toISOString();
        handleAppUpdateDownloadProgressEvent({
            version: '2.7.0',
            phase: 'downloading',
            startedAt,
            downloadedBytes: 50,
            totalBytes: 100,
            percent: 50
        });

        expect(mocks.toastLoading).not.toHaveBeenCalled();

        mocks.confirmInstall.mockImplementation(() => new Promise(() => {}));
        const installPromise = installUpdateRelease(tauriRelease());
        mocks.toastLoading.mockClear();

        handleAppUpdateDownloadProgressEvent({
            version: '2.7.0',
            phase: 'downloading',
            startedAt,
            downloadedBytes: 60,
            totalBytes: 100,
            percent: 60
        });

        expect(mocks.toastLoading).not.toHaveBeenCalled();

        void installPromise;
    });

    it('shows the installing toast once a direct install finishes downloading', () => {
        mocks.confirmInstall.mockImplementation(() => new Promise(() => {}));
        const installPromise = installUpdateRelease(tauriRelease());
        mocks.toastLoading.mockClear();

        handleAppUpdateDownloadProgressEvent({
            version: '2.7.0',
            phase: 'downloaded',
            startedAt: null,
            downloadedBytes: 100,
            totalBytes: 100,
            percent: 100
        });

        expect(mocks.toastLoading).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({ id: 'vrcx-update-available' })
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
