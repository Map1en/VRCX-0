import { commands } from '@/platform/tauri/bindings';
import type {
    AppUpdateDownloadProgressPayload,
    AppUpdateDownloadStatusSnapshot,
    AppUpdateInstalledPayload,
    UpdaterMetadata
} from '@/platform/tauri/bindings';

export type {
    AppUpdateDownloadProgressPayload,
    AppUpdateDownloadStatusSnapshot,
    AppUpdateInstalledPayload,
    UpdaterMetadata
};

export async function getDownloadStatus(): Promise<AppUpdateDownloadStatusSnapshot> {
    return commands.appAppUpdateDownloadStatusGet();
}

export async function confirmInstall(
    version: string
): Promise<UpdaterMetadata> {
    return commands.appAppUpdateInstallConfirm(version);
}
