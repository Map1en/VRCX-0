import {
    commands,
    type SavedAuthSnapshot,
    type SavedCredentialSnapshot,
    type SavedCredentialUser
} from '@/platform/tauri/bindings';
import { normalizePlatformError } from '@/platform/tauri/errors';

export type SavedCredentialRecord = SavedCredentialSnapshot;
export type { SavedAuthSnapshot, SavedCredentialUser };
type AuthSessionEndInput = Parameters<
    typeof commands.appVrchatAuthSessionEnd
>[0];

async function runAuthSavedCommand<T>(
    command: () => Promise<T>,
    fallbackMessage: string
): Promise<T> {
    try {
        return await command();
    } catch (error) {
        throw normalizePlatformError(error, fallbackMessage);
    }
}

async function getSavedAuthSnapshot(): Promise<SavedAuthSnapshot> {
    return runAuthSavedCommand(
        () => commands.appVrchatAuthSavedSnapshotGet(),
        'Auth saved snapshot failed'
    );
}

async function deleteSavedCredential(
    userId: string
): Promise<SavedAuthSnapshot> {
    return runAuthSavedCommand(
        () => commands.appVrchatAuthSavedCredentialDelete({ userId }),
        'Saved credential delete failed'
    );
}

async function endSession(
    input: AuthSessionEndInput
): Promise<SavedAuthSnapshot | null> {
    return runAuthSavedCommand(
        () => commands.appVrchatAuthSessionEnd(input),
        'Auth session end failed'
    );
}

const authRepository = Object.freeze({
    deleteSavedCredential,
    endSession,
    getSavedAuthSnapshot
});

export { deleteSavedCredential, endSession, getSavedAuthSnapshot };
export default authRepository;
