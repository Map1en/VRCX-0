import { commands } from '@/platform/tauri/bindings';
import type {
    ProfileRestoreRequestResult,
    ProfileRestoreState
} from '@/platform/tauri/bindings';

const PROFILE_RESTORE_FILE_FILTER = 'VRCX-0 Backup|*.vrcx0backup;*.zip';

export async function chooseProfileRestoreArchive(): Promise<string | null> {
    const selected = (
        await commands.appOpenFileSelectorDialog(
            null,
            null,
            PROFILE_RESTORE_FILE_FILTER
        )
    ).trim();
    return selected || null;
}

export function getProfileRestoreState(): Promise<ProfileRestoreState> {
    return commands.appProfileRestoreStateGet();
}

export function requestProfileRestore(
    archivePath: string
): Promise<ProfileRestoreRequestResult> {
    return commands.appProfileRestoreRequest(archivePath);
}

export function confirmProfileRestore(): Promise<ProfileRestoreState> {
    return commands.appProfileRestoreConfirm();
}

export function requestProfileRollback(): Promise<ProfileRestoreRequestResult> {
    return commands.appProfileRestoreRollbackRequest();
}

export function acknowledgeProfileRestoreResult(): Promise<ProfileRestoreState> {
    return commands.appProfileRestoreResultAcknowledge();
}
