import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getConfigString: vi.fn(),
    setConfigString: vi.fn(),
    isHostCapabilityAvailable: vi.fn(),
    formatReleaseDisplayVersion: vi.fn(),
    toNormalizedReleaseFromSnapshot: vi.fn(),
    runRuntimeTelemetryJob: vi.fn(),
    recordRuntimeJobTelemetry: vi.fn(),
    appRegistryBackupMaintenanceRun: vi.fn(),
    pushNotification: vi.fn()
}));

vi.mock('@/repositories/configRepository', () => ({
    default: {
        getString: mocks.getConfigString,
        setString: mocks.setConfigString
    }
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appRegistryBackupMaintenanceRun: mocks.appRegistryBackupMaintenanceRun
    }
}));

vi.mock('./hostCapabilityService', () => ({
    isHostCapabilityAvailable: mocks.isHostCapabilityAvailable
}));

vi.mock('./runtimeJobTelemetryService', () => ({
    recordRuntimeJobTelemetry: mocks.recordRuntimeJobTelemetry,
    runRuntimeTelemetryJob: mocks.runRuntimeTelemetryJob
}));

vi.mock('./updateService', () => ({
    formatReleaseDisplayVersion: mocks.formatReleaseDisplayVersion,
    toNormalizedReleaseFromSnapshot: mocks.toNormalizedReleaseFromSnapshot
}));

vi.mock('./i18nService', () => ({
    default: {
        t: (key: string, values?: Record<string, unknown>) =>
            values ? `${key}:${JSON.stringify(values)}` : key
    }
}));

vi.mock('@/state/notificationStore', () => ({
    useNotificationStore: {
        getState: () => ({ pushNotification: mocks.pushNotification })
    }
}));

import { useRuntimeStore } from '@/state/runtimeStore';

import {
    handleAppUpdateStatusEvent,
    runForegroundUpdateRegistryBackupMaintenance,
    runStartupMaintenance
} from './backgroundMaintenanceService';

type ReleaseSnapshotFixture = {
    displayName: string;
    tagName: string;
    htmlUrl: string;
    publishedAt: string;
    body: string;
    canonicalVersion: string;
    displayVersion: string;
    manifestUrl: string;
    target: string;
    updaterType: string;
};

const TAURI_RELEASE_SNAPSHOT: ReleaseSnapshotFixture = {
    displayName: 'VRCX-0 2.7.0',
    tagName: 'v2.7.0',
    htmlUrl: 'https://example.test/release',
    publishedAt: '2026-06-18T00:00:00Z',
    body: '',
    canonicalVersion: '2.7.0',
    displayVersion: '2.7.0',
    manifestUrl:
        'https://github.com/Map1en/VRCX-0/releases/latest/download/latest_windows.json',
    target: 'windows-x86_64-stable',
    updaterType: 'tauri'
};

function toNormalizedRelease(release: ReleaseSnapshotFixture | null) {
    if (!release) {
        return null;
    }
    return {
        manifestUrl: release.manifestUrl || undefined,
        target: release.target || undefined,
        canonicalVersion: release.canonicalVersion,
        channel: 'Stable' as const,
        displayVersion: release.displayVersion,
        htmlUrl: release.htmlUrl,
        tagName: release.tagName,
        displayName: release.displayName,
        prerelease: false,
        publishedAt: release.publishedAt,
        body: release.body,
        updaterType: release.updaterType === 'tauri' ? 'tauri' : 'manual'
    };
}

function statusSnapshot(
    release: ReleaseSnapshotFixture | null,
    shouldNotify = false
) {
    return {
        hasAvailableUpdate: Boolean(release),
        checkedAt: '2026-06-18T00:00:00.000Z',
        detail: '',
        error: null,
        release,
        shouldNotify
    };
}

describe('backgroundMaintenanceService update checks', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal('VERSION', '2.6.0');
        useRuntimeStore.getState().resetRuntimeState();
        mocks.getConfigString.mockResolvedValue('Stable');
        mocks.setConfigString.mockResolvedValue(undefined);
        mocks.isHostCapabilityAvailable.mockReturnValue(false);
        mocks.formatReleaseDisplayVersion.mockImplementation((value: unknown) =>
            String(value || '')
        );
        mocks.toNormalizedReleaseFromSnapshot.mockImplementation(
            toNormalizedRelease
        );
        mocks.runRuntimeTelemetryJob.mockImplementation(
            async (_metadata: unknown, task: () => Promise<unknown>) => task()
        );
    });

    it('runStartupMaintenance only runs registry backup maintenance', async () => {
        mocks.isHostCapabilityAvailable.mockReturnValue(true);
        mocks.appRegistryBackupMaintenanceRun.mockResolvedValue({
            restorePromptNeeded: false
        });

        await runStartupMaintenance();

        expect(mocks.appRegistryBackupMaintenanceRun).toHaveBeenCalledWith(
            'foreground-startup'
        );
    });

    it('runForegroundUpdateRegistryBackupMaintenance runs registry backup maintenance independently of the update check', async () => {
        mocks.isHostCapabilityAvailable.mockReturnValue(true);
        mocks.appRegistryBackupMaintenanceRun.mockResolvedValue({
            restorePromptNeeded: false
        });

        await runForegroundUpdateRegistryBackupMaintenance();

        expect(mocks.appRegistryBackupMaintenanceRun).toHaveBeenCalledWith(
            'foreground-update'
        );
    });

    it('notifies when the backend marks the delivered release as should-notify', async () => {
        await handleAppUpdateStatusEvent(
            statusSnapshot(TAURI_RELEASE_SNAPSHOT, true)
        );

        expect(useRuntimeStore.getState().updateLoop.hasAvailableUpdate).toBe(
            true
        );
        expect(mocks.pushNotification).toHaveBeenCalledTimes(1);
    });

    it('does not notify when the backend does not mark the delivered release as should-notify', async () => {
        await handleAppUpdateStatusEvent(
            statusSnapshot(TAURI_RELEASE_SNAPSHOT, true)
        );
        await handleAppUpdateStatusEvent(
            statusSnapshot(TAURI_RELEASE_SNAPSHOT, false)
        );

        expect(mocks.pushNotification).toHaveBeenCalledTimes(1);
        expect(useRuntimeStore.getState().updateLoop.hasAvailableUpdate).toBe(
            true
        );
    });

    it('notifies again when the backend marks a newer release as should-notify', async () => {
        await handleAppUpdateStatusEvent(
            statusSnapshot(TAURI_RELEASE_SNAPSHOT, true)
        );
        await handleAppUpdateStatusEvent(
            statusSnapshot(
                { ...TAURI_RELEASE_SNAPSHOT, canonicalVersion: '2.8.0' },
                true
            )
        );

        expect(mocks.pushNotification).toHaveBeenCalledTimes(2);
    });

    it('clears the update loop state when no release is available', async () => {
        await handleAppUpdateStatusEvent(
            statusSnapshot(TAURI_RELEASE_SNAPSHOT, true)
        );
        await handleAppUpdateStatusEvent(statusSnapshot(null));

        expect(useRuntimeStore.getState().updateLoop.hasAvailableUpdate).toBe(
            false
        );
        expect(useRuntimeStore.getState().updateLoop.latestUpdaterRelease).toBe(
            null
        );
    });

    it('records the check detail without notifying when the check errored', async () => {
        await handleAppUpdateStatusEvent({
            hasAvailableUpdate: false,
            checkedAt: '2026-06-18T00:00:00.000Z',
            detail: '',
            error: 'network failed',
            release: null,
            shouldNotify: false
        });

        expect(mocks.pushNotification).not.toHaveBeenCalled();
        expect(
            useRuntimeStore.getState().updateLoop.lastUpdaterCheckDetail
        ).toBe('network failed');
    });
});
