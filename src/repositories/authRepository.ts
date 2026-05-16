import { backend } from '@/platform/index.js';
import { normalizePlatformError } from '@/platform/tauri/errors.js';

type GenericRecord = Record<string, any>;
type SavedCredentialsMap = Record<string, GenericRecord>;

interface RecordLoginSuccessInput {
    user?: GenericRecord;
    loginParams?: GenericRecord;
    storedLoginParams?: GenericRecord | null;
    saveCredentials?: boolean;
}

interface RecordLogoutOptions {
    clearLastUserLoggedIn?: unknown;
    cookies?: unknown;
}

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

async function getSavedAuthSnapshot() {
    return runAuthSavedCommand(
        () => backend.app.BackendAuthSavedSnapshotGet(),
        'Auth saved snapshot failed'
    );
}

async function getSavedCredentialsMap(): Promise<SavedCredentialsMap> {
    const snapshot = await getSavedAuthSnapshot();
    return snapshot?.savedCredentials &&
        typeof snapshot.savedCredentials === 'object'
        ? (snapshot.savedCredentials as SavedCredentialsMap)
        : {};
}

async function getSavedCredential(userId: string) {
    if (!userId) {
        return null;
    }

    const savedCredentials = await getSavedCredentialsMap();
    return savedCredentials[userId] ?? null;
}

async function deleteSavedCredential(userId: string) {
    return runAuthSavedCommand(
        () =>
            backend.app.BackendAuthSavedCredentialDelete({
                userId: typeof userId === 'string' ? userId : String(userId ?? '')
            }),
        'Saved credential delete failed'
    );
}

async function recordLoginSuccess({
    user,
    loginParams = {},
    storedLoginParams = null,
    saveCredentials = false
}: RecordLoginSuccessInput) {
    return runAuthSavedCommand(
        () =>
            backend.app.BackendAuthLoginSuccessRecord({
                user,
                loginParams,
                storedLoginParams,
                saveCredentials
            }),
        'Login success record failed'
    );
}

async function recordLogout(
    userOrUserId: GenericRecord | string | null,
    options: RecordLogoutOptions = {}
) {
    return runAuthSavedCommand(
        () =>
            backend.app.BackendAuthLogoutRecord({
                userOrUserId,
                clearLastUserLoggedIn:
                    options.clearLastUserLoggedIn === undefined
                        ? undefined
                        : Boolean(options.clearLastUserLoggedIn),
                cookies: options.cookies
            }),
        'Logout record failed'
    );
}

const authRepository = Object.freeze({
    getSavedCredentialsMap,
    getSavedCredential,
    deleteSavedCredential,
    recordLoginSuccess,
    recordLogout,
    getSavedAuthSnapshot
});

export {
    getSavedCredentialsMap,
    getSavedCredential,
    deleteSavedCredential,
    recordLoginSuccess,
    recordLogout,
    getSavedAuthSnapshot
};
export default authRepository;
