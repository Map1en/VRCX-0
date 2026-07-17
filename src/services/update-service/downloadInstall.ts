import { commands } from '@/platform/tauri/bindings';
import type {
    AppUpdateDownloadStatusSnapshot,
    UpdaterMetadata
} from '@/platform/tauri/bindings';

import type {
    AppUpdateDownloadProgressPayload,
    AppUpdateInstalledPayload
} from '../runtime-event-bridge/types';

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
