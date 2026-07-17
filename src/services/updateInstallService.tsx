import { toast } from 'sonner';

import { userFacingErrorMessage } from '@/lib/errorDisplay';
import { openExternalLink } from '@/services/entityMediaService';
import i18n from '@/services/i18nService';
import { restartApplication } from '@/services/shellIntegrationService';
import {
    confirmInstall,
    formatReleaseDisplayVersion,
    type AppUpdateDownloadProgressPayload,
    type AppUpdateInstalledPayload,
    type NormalizedRelease,
    type UpdateDownloadProgress
} from '@/services/updateService';
import { links } from '@/shared/constants/link';
import { useRuntimeStore } from '@/state/runtimeStore';

import { UPDATE_READY_TOAST_DURATION_MS } from './backgroundMaintenanceTiming';

export const UPDATE_AVAILABLE_TOAST_ID = 'vrcx-update-available';

type DirectUpdateInstallOptions = {
    toastId?: string | number;
};

type DownloadToastContentProps = {
    detail: string;
    progress: UpdateDownloadProgress;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object');
}

function getString(value: unknown) {
    return typeof value === 'string' ? value : String(value || '');
}

function formatMegabytes(bytes: number) {
    if (!Number.isFinite(bytes) || bytes <= 0) {
        return '0.00 MB';
    }
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatProgressDetail(progress: UpdateDownloadProgress) {
    const percentText = `${progress.percent}%`;
    const downloadedText = formatMegabytes(progress.downloadedBytes);
    if (progress.totalBytes > 0) {
        return `${percentText} · ${downloadedText} / ${formatMegabytes(
            progress.totalBytes
        )}`;
    }
    return `${percentText} · ${downloadedText}`;
}

function DownloadToastContent({ detail, progress }: DownloadToastContentProps) {
    const percent = Math.max(0, Math.min(100, progress.percent || 0));

    return (
        <div className="mt-1 flex w-full flex-col gap-2">
            <div className="text-muted-foreground text-xs tabular-nums">
                {detail}
            </div>
            <div className="bg-muted h-2 overflow-hidden rounded-full">
                <div
                    className="bg-primary h-full transition-[width]"
                    style={{ width: `${percent}%` }}
                />
            </div>
        </div>
    );
}

function readLatestUpdateRelease(): NormalizedRelease | null {
    const release = useRuntimeStore.getState().updateLoop.latestUpdaterRelease;
    if (!isRecord(release)) {
        return null;
    }

    return {
        manifestUrl: getString(release.manifestUrl).trim() || undefined,
        target: getString(release.target).trim() || undefined,
        canonicalVersion: getString(release.canonicalVersion),
        channel: 'Stable',
        displayVersion: getString(release.displayVersion),
        htmlUrl: getString(release.htmlUrl),
        tagName: getString(release.tagName),
        displayName: getString(release.displayName || release.title),
        prerelease: false,
        publishedAt: getString(release.publishedAt),
        body: '',
        updaterType:
            getString(release.updaterType) === 'tauri' ? 'tauri' : 'manual'
    };
}

function canInstallUpdateRelease(
    release: NormalizedRelease | null
): release is NormalizedRelease & {
    manifestUrl: string;
    target: string;
} {
    return Boolean(
        release &&
        release.updaterType === 'tauri' &&
        release.manifestUrl &&
        release.target
    );
}

function resetUpdateLoopState() {
    useRuntimeStore.getState().setUpdateLoopState({
        hasAvailableUpdate: false,
        latestUpdaterRelease: null,
        autoDownloadState: 'idle',
        downloadedVersion: null,
        downloadProgress: 0
    });
}

function resetAutoDownloadInstallState() {
    useRuntimeStore.getState().setUpdateLoopState({
        autoDownloadState: 'idle',
        downloadedVersion: null,
        downloadProgress: 0
    });
}

let directInstallInFlight: Promise<boolean> | null = null;

export function installUpdateRelease(
    release: NormalizedRelease | null,
    { toastId = UPDATE_AVAILABLE_TOAST_ID }: DirectUpdateInstallOptions = {}
) {
    if (directInstallInFlight) {
        return directInstallInFlight;
    }

    if (!canInstallUpdateRelease(release)) {
        toast.error(
            i18n.t('message.vrcx_updater.no_downloadable_releases_found'),
            {
                id: toastId,
                position: 'bottom-right',
                closeButton: true
            }
        );
        return Promise.resolve(false);
    }

    const displayVersion =
        release.displayVersion ||
        formatReleaseDisplayVersion(release.canonicalVersion) ||
        release.tagName ||
        '-';
    toast.loading(
        i18n.t('host.system_dialogs.dynamic.downloading_value', {
            value: displayVersion
        }),
        {
            id: toastId,
            duration: Infinity,
            position: 'bottom-right',
            dismissible: false
        }
    );

    directInstallInFlight = (async () => {
        try {
            await confirmInstall(release.canonicalVersion);
            return true;
        } catch (error) {
            resetAutoDownloadInstallState();
            toast.error(
                userFacingErrorMessage(
                    error,
                    i18n.t('message.vrcx_updater.failed_install')
                ),
                {
                    id: toastId,
                    duration: Infinity,
                    position: 'bottom-right',
                    closeButton: true
                }
            );
            return false;
        } finally {
            directInstallInFlight = null;
        }
    })();

    return directInstallInFlight;
}

export function installLatestAvailableUpdate(
    options: DirectUpdateInstallOptions = {}
) {
    return installUpdateRelease(readLatestUpdateRelease(), options);
}

export async function openOrInstallLatestAvailableUpdate(
    options: DirectUpdateInstallOptions = {}
) {
    const release = readLatestUpdateRelease();
    if (canInstallUpdateRelease(release)) {
        return installUpdateRelease(release, options);
    }

    await openExternalLink(release?.htmlUrl || links.releases);
    return false;
}

export function handleAppUpdateDownloadProgressEvent(
    payload: AppUpdateDownloadProgressPayload
) {
    useRuntimeStore.getState().setUpdateLoopState({
        autoDownloadState: payload.phase,
        downloadedVersion: payload.version,
        downloadProgress: payload.percent
    });

    if (!directInstallInFlight) {
        return;
    }

    if (payload.phase === 'downloaded') {
        toast.loading(i18n.t('message.vrcx_updater.installing_update'), {
            id: UPDATE_AVAILABLE_TOAST_ID,
            duration: Infinity,
            position: 'bottom-right',
            dismissible: false
        });
        return;
    }
    if (payload.phase !== 'downloading') {
        return;
    }

    const progress: UpdateDownloadProgress = {
        downloadedBytes: payload.downloadedBytes,
        totalBytes: payload.totalBytes,
        percent: payload.percent
    };
    const displayVersion =
        formatReleaseDisplayVersion(payload.version) || payload.version;
    toast.loading(
        i18n.t('host.system_dialogs.dynamic.downloading_value', {
            value: displayVersion
        }),
        {
            id: UPDATE_AVAILABLE_TOAST_ID,
            description: (
                <DownloadToastContent
                    detail={formatProgressDetail(progress)}
                    progress={progress}
                />
            ),
            duration: Infinity,
            position: 'bottom-right',
            dismissible: false
        }
    );
}

export function handleAppUpdateInstalledEvent(
    payload: AppUpdateInstalledPayload
) {
    resetUpdateLoopState();
    const displayVersion =
        formatReleaseDisplayVersion(payload.version) || payload.version;
    toast.success(
        i18n.t('dialog.vrcx_updater.ready_for_update', {
            value: displayVersion
        }),
        {
            id: UPDATE_AVAILABLE_TOAST_ID,
            duration: UPDATE_READY_TOAST_DURATION_MS,
            position: 'bottom-right'
        }
    );
    void restartApplication();
}
