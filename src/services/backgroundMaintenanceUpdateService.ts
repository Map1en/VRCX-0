import { toast } from 'sonner';

import { commands } from '@/platform/tauri/bindings';
import type { RegistryBackupMaintenanceResult } from '@/platform/tauri/bindings';
import configRepository from '@/repositories/configRepository';
import { isHostCapabilityAvailable } from '@/services/hostCapabilityService';
import i18n from '@/services/i18nService';
import {
    UPDATE_AVAILABLE_TOAST_ID,
    installUpdateRelease
} from '@/services/updateInstallService';
import {
    canInstallUpdatesOnPlatform,
    checkInstallableUpdate,
    defaultBranchForVersion,
    discardPendingUpdate,
    downloadUpdate,
    fetchLatestBranchRelease,
    formatReleaseDisplayVersion,
    handlePreviewStableReleaseUpdateCheck,
    hasUpdateForBranch,
    sanitizeBranch,
    type InstallableUpdateRelease,
    type NormalizedRelease
} from '@/services/updateService';
import { useModalStore } from '@/state/modalStore';
import { useNotificationStore } from '@/state/notificationStore';
import { useRuntimeStore } from '@/state/runtimeStore';

import { UPDATE_READY_TOAST_DURATION_MS } from './backgroundMaintenanceTiming';
import { runRuntimeTelemetryJob } from './runtimeJobTelemetryService';

type AutoDownloadHostContext = {
    hostArch: string;
    hostPlatform: string;
    linuxPackageKind: string;
};

type QueuedAutoDownload = {
    update: InstallableUpdateRelease;
    hostContext: AutoDownloadHostContext;
};

let queuedAutoDownload: QueuedAutoDownload | null = null;
let autoDownloadInFlight: {
    version: string;
    promise: Promise<void>;
} | null = null;

type AppUpdateCheckOptions = {
    includeRegistryBackup?: boolean;
    autoInstallOnStartup?: boolean;
    suppressAvailableNotification?: boolean;
    autoDownloadHandledVersion?: string;
};
type UpdaterReleaseSnapshotSource =
    | NormalizedRelease
    | InstallableUpdateRelease
    | null;

function toUpdaterReleaseSnapshot(release: UpdaterReleaseSnapshotSource) {
    if (!release) {
        return null;
    }
    return {
        title: release.displayName || release.tagName || '',
        currentVersion:
            // oxlint-disable-next-line no-undef
            formatReleaseDisplayVersion(VERSION || '') || String(VERSION || ''),
        latestVersion:
            release.displayVersion ||
            formatReleaseDisplayVersion(release.canonicalVersion) ||
            String(release.tagName || ''),
        publishedAt:
            release.publishedAt ||
            ('date' in release && release.date ? release.date : ''),
        manifestUrl: release.manifestUrl || '',
        target: release.target || '',
        canonicalVersion: release.canonicalVersion || '',
        displayVersion: release.displayVersion || '',
        htmlUrl: release.htmlUrl || '',
        tagName: release.tagName || '',
        displayName: release.displayName || '',
        updaterType: release.updaterType || 'manual'
    };
}

function setUpdaterCheckResult(
    hasAvailableUpdate: boolean,
    detail: string = '',
    release: UpdaterReleaseSnapshotSource = null
) {
    useRuntimeStore.getState().setUpdateLoopState({
        hasAvailableUpdate: Boolean(hasAvailableUpdate),
        lastUpdaterCheckAt: new Date().toISOString(),
        lastUpdaterCheckDetail: detail,
        latestUpdaterRelease: hasAvailableUpdate
            ? toUpdaterReleaseSnapshot(release)
            : null
    });
}

function isTauriInstallableRelease(
    release: UpdaterReleaseSnapshotSource
): release is InstallableUpdateRelease {
    return Boolean(
        release &&
        release.updaterType === 'tauri' &&
        release.canonicalVersion &&
        release.manifestUrl &&
        release.target
    );
}

function resetAutoDownloadLoopState() {
    useRuntimeStore.getState().setUpdateLoopState({
        autoDownloadState: 'idle',
        downloadedVersion: null,
        downloadProgress: 0
    });
}

function setAutoDownloadProgressState(
    version: string,
    progress: number,
    state: 'downloading' | 'downloaded' = 'downloading'
) {
    useRuntimeStore.getState().setUpdateLoopState({
        autoDownloadState: state,
        downloadedVersion: version,
        downloadProgress: progress
    });
}

function isAutoBackgroundDownloadEnabled() {
    return configRepository.getBool('autoBackgroundDownloadUpdates', false);
}

async function clearAutoDownloadedUpdateState(clearQueue = true) {
    if (clearQueue) {
        queuedAutoDownload = null;
    }
    await discardPendingUpdate().catch((error: unknown) => {
        console.warn('Failed to discard pending VRCX-0 update:', error);
    });
    resetAutoDownloadLoopState();
}

function runQueuedAutoDownloadIfNeeded(completedVersion: string) {
    const queued = queuedAutoDownload;
    if (!queued || queued.update.canonicalVersion === completedVersion) {
        queuedAutoDownload = null;
        return;
    }
    queuedAutoDownload = null;
    void ensureAutoBackgroundDownloadedUpdate(
        queued.update,
        queued.hostContext,
        true
    );
}

async function ensureAutoBackgroundDownloadedUpdate(
    update: InstallableUpdateRelease,
    hostContext: AutoDownloadHostContext,
    checkAfterDownload = true
) {
    if (!(await isAutoBackgroundDownloadEnabled())) {
        return;
    }
    if (!isTauriInstallableRelease(update)) {
        return;
    }

    const version = update.canonicalVersion;
    const updateLoop = useRuntimeStore.getState().updateLoop;
    if (
        updateLoop.autoDownloadState === 'downloaded' &&
        updateLoop.downloadedVersion === version
    ) {
        return;
    }
    if (autoDownloadInFlight) {
        if (autoDownloadInFlight.version === version) {
            await autoDownloadInFlight.promise;
            return;
        }
        queuedAutoDownload = {
            update,
            hostContext
        };
        return;
    }
    if (
        updateLoop.autoDownloadState === 'downloaded' &&
        updateLoop.downloadedVersion &&
        updateLoop.downloadedVersion !== version
    ) {
        await clearAutoDownloadedUpdateState();
    }

    const promise = (async () => {
        setAutoDownloadProgressState(version, 0);

        try {
            await downloadUpdate(update, {
                hostArch: hostContext.hostArch,
                hostPlatform: hostContext.hostPlatform,
                linuxPackageKind: hostContext.linuxPackageKind,
                onDownloadProgress: (progress) => {
                    setAutoDownloadProgressState(version, progress.percent);
                }
            });

            if (!(await isAutoBackgroundDownloadEnabled())) {
                await clearAutoDownloadedUpdateState(false);
                return;
            }

            const queued = queuedAutoDownload;
            if (queued && queued.update.canonicalVersion !== version) {
                await clearAutoDownloadedUpdateState(false);
                return;
            }

            setAutoDownloadProgressState(version, 100, 'downloaded');
            toast.success(
                i18n.t('dialog.vrcx_updater.ready_for_update', {
                    value:
                        update.displayVersion ||
                        formatReleaseDisplayVersion(version) ||
                        version
                }),
                {
                    id: UPDATE_AVAILABLE_TOAST_ID,
                    duration: UPDATE_READY_TOAST_DURATION_MS,
                    position: 'bottom-right'
                }
            );

            if (checkAfterDownload) {
                await checkForAppUpdate({
                    includeRegistryBackup: false,
                    autoInstallOnStartup: false,
                    suppressAvailableNotification: true,
                    autoDownloadHandledVersion: version
                });
            }
        } catch (error) {
            console.warn('Failed to background-download VRCX-0 update:', error);
            useRuntimeStore.getState().setUpdateLoopState({
                autoDownloadState: 'error',
                downloadedVersion: version,
                lastUpdaterCheckDetail:
                    error instanceof Error ? error.message : String(error)
            });
        }
    })();

    autoDownloadInFlight = { version, promise };
    try {
        await promise;
    } finally {
        if (autoDownloadInFlight?.promise === promise) {
            autoDownloadInFlight = null;
        }
        runQueuedAutoDownloadIfNeeded(version);
    }
}

function notifyAvailableUpdate(
    branch: string,
    release: UpdaterReleaseSnapshotSource,
    version: string,
    { notify = true }: { notify?: boolean } = {}
) {
    const displayVersion = formatReleaseDisplayVersion(version);
    const message = i18n.t(
        'service.background_maintenance_service.dynamic.version_value_is_available_on_the_value_branch',
        { value: displayVersion, value2: branch }
    );
    if (notify) {
        useNotificationStore.getState().pushNotification({
            level: 'info',
            title: i18n.t(
                'service.background_maintenance.label.vrcx_update_available'
            ),
            message
        });
    }
    setUpdaterCheckResult(true, message, release);
}

async function runRegistryBackupMaintenance(reason: string) {
    if (!isHostCapabilityAvailable('registryPrefs')) {
        return;
    }

    let result: RegistryBackupMaintenanceResult;
    try {
        result = await commands.appRegistryBackupMaintenanceRun(reason);
    } catch (error) {
        console.warn(
            'Failed to run VRChat registry backup maintenance:',
            error
        );
        return;
    }

    if (!result?.restorePromptNeeded) {
        return;
    }

    await commands
        .appEnsureMainWindow()
        .catch(() => commands.appFocusWindow().catch(() => {}));
    await useModalStore.getState().alert({
        title: i18n.t(
            'service.background_maintenance.label.vrchat_registry_backup'
        ),
        description: i18n.t(
            'service.background_maintenance.description.registry_backup_restore_description'
        )
    });
    useRuntimeStore.getState().setSystemHostOpen('registryBackupOpen', true);
    await commands.appFocusWindow().catch(() => {});
    if (result.restorePromptBackupDate) {
        await configRepository.setString(
            'VRChatRegistryLastRestoreCheck',
            result.restorePromptBackupDate
        );
    }
}

export async function checkForAppUpdate({
    includeRegistryBackup = true,
    autoInstallOnStartup = false,
    suppressAvailableNotification = false,
    autoDownloadHandledVersion = ''
}: AppUpdateCheckOptions = {}) {
    const hostCapabilities = useRuntimeStore.getState().hostCapabilities;
    const hostPlatform = hostCapabilities.platform;
    const hostArch = hostCapabilities.arch;
    const linuxPackageKind = hostCapabilities.linuxPackageKind;
    const canInstallUpdates = canInstallUpdatesOnPlatform(hostPlatform);

    try {
        const savedBranch = await configRepository.getString('branch', '');
        const defaultBranch = defaultBranchForVersion(VERSION || '');
        const sanitizedSavedBranch = sanitizeBranch(savedBranch);
        const branch =
            defaultBranch !== 'Stable'
                ? defaultBranch
                : savedBranch
                  ? sanitizedSavedBranch
                  : defaultBranch;
        if (branch !== savedBranch) {
            await configRepository.setString('branch', branch);
        }

        // Preview builds use a separate preview-to-Stable check so the normal
        // Tauri updater path stays isolated.
        const previewStableUpdate = await handlePreviewStableReleaseUpdateCheck(
            {
                hostArch,
                linuxPackageKind,
                hostPlatform
            }
        );
        if (previewStableUpdate.handled) {
            if (previewStableUpdate.release) {
                notifyAvailableUpdate(
                    branch,
                    previewStableUpdate.release,
                    previewStableUpdate.release.canonicalVersion,
                    { notify: !suppressAvailableNotification }
                );
            } else {
                setUpdaterCheckResult(false);
                await clearAutoDownloadedUpdateState();
            }
        } else if (canInstallUpdates) {
            const update = await checkInstallableUpdate(branch, {
                hostArch,
                linuxPackageKind,
                hostPlatform
            });
            if (update) {
                const shouldAutoInstall =
                    autoInstallOnStartup &&
                    (await configRepository.getBool(
                        'autoInstallUpdatesOnStartup',
                        true
                    ));
                if (shouldAutoInstall && (await installUpdateRelease(update))) {
                    return;
                }
                notifyAvailableUpdate(branch, update, update.version, {
                    notify: !suppressAvailableNotification
                });
                if (update.canonicalVersion !== autoDownloadHandledVersion) {
                    await ensureAutoBackgroundDownloadedUpdate(update, {
                        hostArch,
                        hostPlatform,
                        linuxPackageKind
                    });
                }
            } else {
                setUpdaterCheckResult(false);
                await clearAutoDownloadedUpdateState();
            }
        } else {
            const latestRelease = await fetchLatestBranchRelease(branch, {
                hostArch,
                linuxPackageKind,
                hostPlatform,
                requireInstallerAsset: false
            });
            const hasUpdate =
                latestRelease &&
                hasUpdateForBranch(
                    branch,
                    VERSION || '',
                    latestRelease.canonicalVersion
                );
            if (hasUpdate) {
                notifyAvailableUpdate(
                    branch,
                    latestRelease,
                    latestRelease.canonicalVersion,
                    { notify: !suppressAvailableNotification }
                );
            } else {
                setUpdaterCheckResult(false);
                await clearAutoDownloadedUpdateState();
            }
        }
    } catch (error) {
        console.warn('Failed to check for VRCX-0 updates:', error);
        useRuntimeStore.getState().setUpdateLoopState({
            lastUpdaterCheckAt: new Date().toISOString(),
            lastUpdaterCheckDetail:
                error instanceof Error ? error.message : String(error)
        });
    }

    if (includeRegistryBackup) {
        await runRegistryBackupMaintenance('foreground-update');
    }
}

export async function runStartupMaintenance() {
    await runRuntimeTelemetryJob(
        {
            name: 'startupMaintenance',
            detail: 'Running startup update and registry maintenance.'
        },
        () =>
            Promise.all([
                checkForAppUpdate({
                    includeRegistryBackup: false,
                    autoInstallOnStartup: true
                }),
                runRegistryBackupMaintenance('foreground-startup')
            ])
    );
}

export async function handleAutoBackgroundDownloadUpdatesPreferenceChange(
    enabled: boolean
) {
    if (!enabled) {
        await clearAutoDownloadedUpdateState();
        return;
    }

    await checkForAppUpdate({
        includeRegistryBackup: false,
        autoInstallOnStartup: false
    });
}
