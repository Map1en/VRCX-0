import { commands } from '@/platform/tauri/bindings';
import { normalizePlatformError } from '@/platform/tauri/errors';

export type GenericRecord = Record<string, unknown>;
export type SavedCredentialRecord = GenericRecord & {
    user?: GenericRecord | null;
    loginParams?: GenericRecord | null;
    hasLoginCredentials?: boolean;
};
export type SavedCredentialsMap = Record<string, SavedCredentialRecord>;

export type SavedAuthSnapshot = Record<string, unknown> & {
    lastUserLoggedIn: unknown;
    savedCredentialCount: unknown;
    autoLoginStatus: string;
    autoLoginReason: string;
    autoLoginDelayEnabled: unknown;
    autoLoginDelaySeconds: unknown;
};

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

async function getSavedAuthSnapshot(): Promise<SavedAuthSnapshot> {
    return runAuthSavedCommand(
        () =>
            commands.appVrchatAuthSavedSnapshotGet() as Promise<SavedAuthSnapshot>,
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

async function deleteSavedCredential(
    userId: string
): Promise<SavedAuthSnapshot> {
    return runAuthSavedCommand(
        () =>
            commands.appVrchatAuthSavedCredentialDelete({
                userId:
                    typeof userId === 'string' ? userId : String(userId ?? '')
            }) as Promise<SavedAuthSnapshot>,
        'Saved credential delete failed'
    );
}

async function recordLoginSuccess({
    user,
    loginParams = {},
    storedLoginParams = null,
    saveCredentials = false
}: RecordLoginSuccessInput): Promise<SavedAuthSnapshot> {
    return runAuthSavedCommand(
        () =>
            commands.appVrchatAuthLoginSuccessRecord({
                user,
                loginParams,
                storedLoginParams,
                saveCredentials
            }) as Promise<SavedAuthSnapshot>,
        'Login success record failed'
    );
}

async function recordLogout(
    userOrUserId: GenericRecord | string | null,
    options: RecordLogoutOptions = {}
): Promise<SavedAuthSnapshot> {
    return runAuthSavedCommand(
        () =>
            commands.appVrchatAuthLogoutRecord({
                userOrUserId,
                clearLastUserLoggedIn:
                    options.clearLastUserLoggedIn === undefined
                        ? undefined
                        : Boolean(options.clearLastUserLoggedIn),
                cookies: options.cookies
            }) as Promise<SavedAuthSnapshot>,
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
