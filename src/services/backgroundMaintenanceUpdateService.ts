import { commands } from '@/platform/tauri/bindings';
import i18n from '@/services/i18nService';
import {
    formatReleaseDisplayVersion,
    toNormalizedReleaseFromSnapshot,
    type AppUpdateStatusSnapshot,
    type NormalizedRelease
} from '@/services/updateService';
import { useNotificationStore } from '@/state/notificationStore';
import { useRuntimeStore } from '@/state/runtimeStore';

type UpdaterReleaseSnapshotSource = NormalizedRelease | null;

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
        publishedAt: release.publishedAt || '',
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

function notifyAvailableUpdate(release: NormalizedRelease, version: string) {
    const displayVersion = formatReleaseDisplayVersion(version);
    const message = i18n.t(
        'service.background_maintenance_service.dynamic.version_value_is_available_on_the_value_branch',
        { value: displayVersion, value2: 'Stable' }
    );
    useNotificationStore.getState().pushNotification({
        level: 'info',
        title: i18n.t(
            'service.background_maintenance.label.vrcx_update_available'
        ),
        message
    });
    setUpdaterCheckResult(true, message, release);
}

async function applyAppUpdateCheckSnapshot(
    snapshot: AppUpdateStatusSnapshot
): Promise<void> {
    if (snapshot.error) {
        useRuntimeStore.getState().setUpdateLoopState({
            lastUpdaterCheckAt: new Date().toISOString(),
            lastUpdaterCheckDetail: snapshot.error
        });
        return;
    }

    const release = toNormalizedReleaseFromSnapshot(snapshot.release);
    if (!release || !snapshot.hasAvailableUpdate) {
        setUpdaterCheckResult(false, snapshot.detail);
        return;
    }

    if (!snapshot.shouldNotify) {
        setUpdaterCheckResult(true, snapshot.detail, release);
        return;
    }

    notifyAvailableUpdate(release, release.canonicalVersion);
}

export async function handleAppUpdateStatusEvent(
    snapshot: AppUpdateStatusSnapshot
): Promise<void> {
    await applyAppUpdateCheckSnapshot(snapshot);
}

export async function handleAutoBackgroundDownloadUpdatesPreferenceChange(
    enabled: boolean
) {
    await commands
        .appAppUpdateBackgroundDownloadPreferenceChanged(enabled)
        .catch((error: unknown) => {
            console.warn(
                'Failed to notify the backend of the background download preference change:',
                error
            );
        });
}
