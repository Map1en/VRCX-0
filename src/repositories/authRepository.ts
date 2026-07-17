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
    savedCredentials?: SavedCredentialsMap;
    autoLoginStatus: string;
    autoLoginReason: string;
    autoLoginDelayEnabled: unknown;
    autoLoginDelaySeconds: unknown;
};

interface RecordLogoutOptions {
    clearLastUserLoggedIn?: unknown;
    cookies?: unknown;
}

function isRecord(value: unknown): value is GenericRecord {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function normalizeSavedCredentialRecord(
    value: unknown
): SavedCredentialRecord | null {
    if (!isRecord(value)) {
        return null;
    }
    return {
        ...value,
        user: isRecord(value.user) ? value.user : null,
        loginParams: isRecord(value.loginParams) ? value.loginParams : null,
        hasLoginCredentials: value.hasLoginCredentials === true
    };
}

function normalizeSavedCredentialsMap(value: unknown): SavedCredentialsMap {
    if (!isRecord(value)) {
        return {};
    }
    const result: SavedCredentialsMap = {};
    for (const [userId, credential] of Object.entries(value)) {
        const normalized = normalizeSavedCredentialRecord(credential);
        if (normalized) {
            result[userId] = normalized;
        }
    }
    return result;
}

function normalizeSavedAuthSnapshot(value: unknown): SavedAuthSnapshot {
    const record = isRecord(value) ? value : {};
    return {
        ...record,
        lastUserLoggedIn: record.lastUserLoggedIn ?? null,
        savedCredentialCount: record.savedCredentialCount ?? 0,
        autoLoginStatus:
            typeof record.autoLoginStatus === 'string'
                ? record.autoLoginStatus
                : '',
        autoLoginReason:
            typeof record.autoLoginReason === 'string'
                ? record.autoLoginReason
                : '',
        autoLoginDelayEnabled: record.autoLoginDelayEnabled ?? false,
        autoLoginDelaySeconds: record.autoLoginDelaySeconds ?? 0,
        savedCredentials: normalizeSavedCredentialsMap(record.savedCredentials)
    };
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
        async () =>
            normalizeSavedAuthSnapshot(
                await commands.appVrchatAuthSavedSnapshotGet()
            ),
        'Auth saved snapshot failed'
    );
}

async function getSavedCredentialsMap(): Promise<SavedCredentialsMap> {
    const snapshot = await getSavedAuthSnapshot();
    return normalizeSavedCredentialsMap(snapshot.savedCredentials);
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
        async () =>
            normalizeSavedAuthSnapshot(
                await commands.appVrchatAuthSavedCredentialDelete({
                    userId:
                        typeof userId === 'string'
                            ? userId
                            : String(userId ?? '')
                })
            ),
        'Saved credential delete failed'
    );
}

async function recordLogout(
    userOrUserId: GenericRecord | string | null,
    options: RecordLogoutOptions = {}
): Promise<SavedAuthSnapshot> {
    return runAuthSavedCommand(
        async () =>
            normalizeSavedAuthSnapshot(
                await commands.appVrchatAuthLogoutRecord({
                    userOrUserId,
                    clearLastUserLoggedIn:
                        options.clearLastUserLoggedIn === undefined
                            ? undefined
                            : Boolean(options.clearLastUserLoggedIn),
                    cookies: options.cookies
                })
            ),
        'Logout record failed'
    );
}

const authRepository = Object.freeze({
    getSavedCredentialsMap,
    getSavedCredential,
    deleteSavedCredential,
    recordLogout,
    getSavedAuthSnapshot
});

export {
    getSavedCredentialsMap,
    getSavedCredential,
    deleteSavedCredential,
    recordLogout,
    getSavedAuthSnapshot
};
export default authRepository;
