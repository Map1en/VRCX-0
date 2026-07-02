import { toast } from 'sonner';

import { clearEntityQueryCache } from '@/lib/entityQueryCache';
import { commands } from '@/platform/tauri/bindings';
import authRepository, {
    type SavedAuthSnapshot,
    type SavedCredentialRecord
} from '@/repositories/authRepository';
import avatarProfileRepository from '@/repositories/avatarProfileRepository';
import vrchatAuthRepository from '@/repositories/vrchatAuthRepository';
import {
    isVrchatInvalidCredentialsError,
    isVrchatSessionRecoveryError
} from '@/repositories/vrchatRequest';
import webRepository from '@/repositories/webRepository';
import { useDialogStore } from '@/state/dialogStore';
import { useFavoriteStore } from '@/state/favoriteStore';
import { useFeedLiveStore } from '@/state/feedLiveStore';
import { useFriendRosterStore } from '@/state/friendRosterStore';
import { useModalStore } from '@/state/modalStore';
import { useNotificationStore } from '@/state/notificationStore';
import {
    createGroupInstancesState,
    useRuntimeStore
} from '@/state/runtimeStore';
import { useSessionStore } from '@/state/sessionStore';
import { useVrcNotificationStore } from '@/state/vrcNotificationStore';

import { resetActivityCacheState } from './activityCacheService';
import { resetReactAutoLoginThrottle } from './authAutoLoginState';
import { runWithRuntimeAuthFailureRecoverySuppressed } from './authSessionRecoveryService';
import {
    applySavedAuthSnapshot,
    refreshSavedAuthSnapshot
} from './authSnapshotService';
import { buildAvatarWearSnapshotUpdate } from './avatarWearTimeService';
import {
    recordCurrentUserSnapshot,
    resetDomainFacts
} from './domainIngestionService';
import i18n from './i18nService';
import { stopRealtimeTransport } from './realtimeTransportService';
import { bootstrapAuthenticatedSession } from './sessionBootstrapService';

type AuthExecutionError = Error & {
    code?: string;
    authSnapshot?: unknown;
};

type AuthUserRecord = Record<string, unknown> & {
    id?: string;
    displayName?: string;
    username?: string;
};
type LoginParams = {
    username: string;
    password: string;
    endpoint: string;
    websocket: string;
};
type TwoFactorMode = 'emailOtp' | 'otp' | 'totp';
type TwoFactorRestartChallenge = () => Promise<{ json: unknown }>;
type AuthResponse =
    | {
          type: 'twoFactor';
          methods: string[];
      }
    | {
          type: 'authenticated';
          user: AuthUserRecord;
      };

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object');
}

function normalizeText(value: unknown): string {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function normalizeLoginParams(
    loginParams: Record<string, unknown> = {}
): LoginParams {
    return {
        username:
            typeof loginParams.username === 'string'
                ? loginParams.username.trim()
                : '',
        password:
            typeof loginParams.password === 'string'
                ? loginParams.password
                : '',
        endpoint: '',
        websocket: ''
    };
}

function createAuthExecutionError(
    message: string,
    code: string
): AuthExecutionError {
    const error: AuthExecutionError = new Error(message);
    error.code = code;
    return error;
}

function parseAuthResponse(json: unknown): AuthResponse {
    if (!isRecord(json)) {
        throw createAuthExecutionError(
            'The auth request returned an invalid response.',
            'AUTH_INVALID_RESPONSE'
        );
    }

    if (
        Array.isArray(json.requiresTwoFactorAuth) &&
        json.requiresTwoFactorAuth.length > 0
    ) {
        return {
            type: 'twoFactor',
            methods: json.requiresTwoFactorAuth.filter(
                (method): method is string => typeof method === 'string'
            )
        };
    }

    if (!json.id) {
        throw createAuthExecutionError(
            'The auth request did not return a current user payload.',
            'AUTH_INVALID_RESPONSE'
        );
    }

    return {
        type: 'authenticated',
        user: json as AuthUserRecord
    };
}

function isMissingCredentialsError(error: unknown) {
    return Boolean(
        isRecord(error) &&
        error.status === 401 &&
        typeof error.message === 'string' &&
        error.message.includes('Missing Credentials')
    );
}

function getCurrentUserDisplayName(user: AuthUserRecord | null) {
    return (
        normalizeText(user?.displayName) ||
        normalizeText(user?.username) ||
        normalizeText(user?.id)
    );
}

function setRuntimeAuthScope(userId: unknown = '', endpoint: unknown = '') {
    return commands
        .appRuntimeAuthScopeSet({
            userId: typeof userId === 'string' ? userId : String(userId ?? ''),
            endpoint:
                typeof endpoint === 'string' ? endpoint : String(endpoint ?? '')
        })
        .catch((error: unknown): null => {
            console.warn('Failed to sync runtime auth scope:', error);
            return null;
        });
}

export function setSignedOutSessionState() {
    useSessionStore.getState().setSessionState({
        isLoggedIn: false,
        isFriendsLoaded: false,
        isFavoritesLoaded: false,
        sessionPhase: 'signed_out'
    });
}

function setAuthenticatingSessionState() {
    useSessionStore.getState().setSessionState({
        isLoggedIn: false,
        isFriendsLoaded: false,
        isFavoritesLoaded: false,
        sessionPhase: 'authenticating'
    });
}

export function resetCurrentUserRuntimeAuth() {
    stopRealtimeTransport();
    clearEntityQueryCache();
    avatarProfileRepository.clearAvatarNameCache();
    useFriendRosterStore.getState().resetRoster();
    useFavoriteStore.getState().resetFavorites();
    useFeedLiveStore.getState().resetFeedLive();
    resetDomainFacts();
    resetActivityCacheState();
    useRuntimeStore
        .getState()
        .setGroupInstancesState(createGroupInstancesState());
    useRuntimeStore.getState().setAuthBootstrap({
        currentUserId: null,
        currentUserDisplayName: '',
        currentUserEndpoint: '',
        currentUserWebsocket: '',
        currentUserSnapshot: null
    });
    return setRuntimeAuthScope();
}

function setCurrentUserRuntimeAuth(
    user: AuthUserRecord | null,
    { endpoint = '', websocket = '' }: Record<string, string> = {}
) {
    stopRealtimeTransport({ updateStatus: false });
    clearEntityQueryCache();
    avatarProfileRepository.clearAvatarNameCache();
    useFriendRosterStore.getState().resetRoster();
    useFavoriteStore.getState().resetFavorites();
    useFeedLiveStore.getState().resetFeedLive();
    resetDomainFacts();
    const runtimeStore = useRuntimeStore.getState();
    runtimeStore.setGroupInstancesState(createGroupInstancesState());
    const { snapshot } = buildAvatarWearSnapshotUpdate({
        previousSnapshot: runtimeStore.auth.currentUserSnapshot,
        nextSnapshot: user,
        isGameRunning: runtimeStore.gameState.isGameRunning
    });
    const nextSnapshot = isRecord(snapshot)
        ? (snapshot as AuthUserRecord)
        : null;
    const currentUserId = normalizeText(nextSnapshot?.id);

    useRuntimeStore.getState().setAuthBootstrap({
        currentUserId: currentUserId || null,
        currentUserDisplayName: getCurrentUserDisplayName(nextSnapshot),
        currentUserEndpoint: endpoint,
        currentUserWebsocket: websocket,
        currentUserSnapshot: nextSnapshot ?? null
    });
    void setRuntimeAuthScope(currentUserId, endpoint);
    recordCurrentUserSnapshot(nextSnapshot ?? null, { endpoint });
}

async function getLocalizedAuthPrompt(mode: TwoFactorMode): Promise<{
    mode: TwoFactorMode;
    title: string;
    description: string;
    confirmText: string;
    cancelText: string;
}> {
    switch (mode) {
        case 'emailOtp': {
            const [title, description, confirmText, cancelText] =
                await Promise.all([
                    i18n.t('prompt.email_otp.header'),
                    i18n.t('prompt.email_otp.description'),
                    i18n.t('prompt.email_otp.verify'),
                    i18n.t('prompt.email_otp.resend')
                ]);

            return {
                mode,
                title,
                description,
                confirmText,
                cancelText
            };
        }
        case 'otp': {
            const [title, description, confirmText, cancelText] =
                await Promise.all([
                    i18n.t('prompt.otp.header'),
                    i18n.t('prompt.otp.description'),
                    i18n.t('prompt.otp.verify'),
                    i18n.t('prompt.otp.use_totp')
                ]);

            return {
                mode,
                title,
                description,
                confirmText,
                cancelText
            };
        }
        default: {
            const [title, description, confirmText, cancelText] =
                await Promise.all([
                    i18n.t('prompt.totp.header'),
                    i18n.t('prompt.totp.description'),
                    i18n.t('prompt.totp.verify'),
                    i18n.t('prompt.totp.use_otp')
                ]);

            return {
                mode: 'totp',
                title,
                description,
                confirmText,
                cancelText
            };
        }
    }
}

async function promptForTwoFactorCode(mode: TwoFactorMode) {
    const prompt = await getLocalizedAuthPrompt(mode);
    return useModalStore.getState().otpPrompt(prompt);
}

async function getTwoFactorInputErrorMessage(mode: TwoFactorMode) {
    switch (mode) {
        case 'emailOtp':
            return i18n.t('prompt.email_otp.input_error');
        case 'otp':
            return i18n.t('prompt.otp.input_error');
        default:
            return i18n.t('prompt.totp.input_error');
    }
}

async function completeTwoFactorChallenge({
    endpoint,
    initialMethods,
    restartChallenge
}: {
    endpoint: string;
    initialMethods: string[];
    restartChallenge?: TwoFactorRestartChallenge;
}) {
    let methods = Array.isArray(initialMethods) ? [...initialMethods] : [];
    let mode: TwoFactorMode = methods.includes('emailOtp')
        ? 'emailOtp'
        : 'totp';

    while (methods.length > 0) {
        const result = await promptForTwoFactorCode(mode);
        if (!result.ok) {
            if (
                mode === 'emailOtp' &&
                result.reason === 'cancel' &&
                typeof restartChallenge === 'function'
            ) {
                const restartedResponse = await restartChallenge();
                const restartedAuth = parseAuthResponse(restartedResponse.json);
                if (restartedAuth.type === 'authenticated') {
                    return restartedAuth.user;
                }

                methods = restartedAuth.methods;
                mode = methods.includes('emailOtp') ? 'emailOtp' : 'totp';
                continue;
            }

            if (result.reason === 'cancel') {
                mode = mode === 'totp' ? 'otp' : 'totp';
                continue;
            }

            throw createAuthExecutionError(
                'Two-factor verification was cancelled.',
                'AUTH_2FA_CANCELLED'
            );
        }

        try {
            if (mode === 'emailOtp') {
                await vrchatAuthRepository.verifyEmailOTP({
                    code: result.value,
                    endpoint
                });
            } else if (mode === 'otp') {
                await vrchatAuthRepository.verifyOTP({
                    code: result.value,
                    endpoint
                });
            } else {
                await vrchatAuthRepository.verifyTOTP({
                    code: result.value,
                    endpoint
                });
            }
        } catch (error) {
            const fallbackMessage = await getTwoFactorInputErrorMessage(mode);
            toast.error(
                error instanceof Error && error.message
                    ? error.message
                    : fallbackMessage
            );
            continue;
        }

        const currentUserResponse = await vrchatAuthRepository.getCurrentUser({
            endpoint
        });
        const currentAuth = parseAuthResponse(currentUserResponse.json);
        if (currentAuth.type === 'authenticated') {
            return currentAuth.user;
        }

        methods = currentAuth.methods;
        mode = methods.includes('emailOtp') ? 'emailOtp' : mode;
    }

    throw createAuthExecutionError(
        'The auth challenge did not return a usable current user payload.',
        'AUTH_INVALID_RESPONSE'
    );
}

async function finalizeSuccessfulLogin(
    snapshot: SavedAuthSnapshot,
    detail: string,
    user: AuthUserRecord,
    authContext: Record<string, string> = {}
) {
    applySavedAuthSnapshot(snapshot);
    setCurrentUserRuntimeAuth(user, authContext);
    useSessionStore.getState().setSessionState({
        isLoggedIn: false,
        isFriendsLoaded: false,
        isFavoritesLoaded: false,
        sessionPhase: 'bootstrapping'
    });
    useRuntimeStore.getState().setStartupTask('auth', 'completed', detail);
    try {
        await bootstrapAuthenticatedSession(user);
    } catch (error) {
        const normalizedError: AuthExecutionError =
            error instanceof Error ? error : new Error(String(error));
        normalizedError.authSnapshot = snapshot;
        throw normalizedError;
    }
    return snapshot;
}

async function restoreAuthSnapshotOnFailure(
    error: AuthExecutionError,
    { credentialSubmission = false }: { credentialSubmission?: boolean } = {}
) {
    const shouldClearAutoLoginTarget = Boolean(
        isVrchatSessionRecoveryError(error)
    );
    const failedUserId = String(
        useRuntimeStore.getState().auth.currentUserId ||
            useRuntimeStore.getState().auth.lastUserLoggedIn ||
            ''
    );

    const isInvalidCredentials = isVrchatInvalidCredentialsError(error, {
        credentialSubmission
    });

    try {
        if (isInvalidCredentials) {
            await webRepository.clearCookies();
        } else {
            await webRepository.clearAuthCookies();
        }
    } catch {
        // no-op
    }

    await resetCurrentUserRuntimeAuth();
    setSignedOutSessionState();

    try {
        if (shouldClearAutoLoginTarget) {
            error.authSnapshot = applySavedAuthSnapshot(
                await authRepository.recordLogout(failedUserId, {
                    clearLastUserLoggedIn: true,
                    cookies: null
                })
            );
        } else {
            error.authSnapshot = await refreshSavedAuthSnapshot();
        }
    } catch {
        error.authSnapshot = null;
    }

    throw error;
}

export async function logoutFromReactShell() {
    const [title, description, confirmText, cancelText] = await Promise.all([
        i18n.t('common.actions.confirm'),
        i18n.t('confirm.logout'),
        i18n.t('dialog.alertdialog.confirm'),
        i18n.t('dialog.alertdialog.cancel')
    ]);
    const result = await useModalStore.getState().confirm({
        title,
        description,
        confirmText,
        cancelText
    });

    if (!result.ok) {
        return false;
    }

    const runtimeStore = useRuntimeStore.getState();
    const currentUserId = runtimeStore.auth.currentUserId;
    const currentUserDisplayName = runtimeStore.auth.currentUserDisplayName;

    useDialogStore.getState().clearDialogState();
    useModalStore.getState().resetModalState();
    useNotificationStore.getState().resetNotificationState();
    useVrcNotificationStore.getState().resetVrcNotificationState();

    if (!currentUserId) {
        await resetCurrentUserRuntimeAuth();
        useSessionStore.getState().setSessionState({
            isLoggedIn: false,
            isFriendsLoaded: false,
            isFavoritesLoaded: false,
            sessionPhase: 'signed_out'
        });
        runtimeStore.setStartupTask(
            'auth',
            'completed',
            'Reset VRCX-0 without changing persisted auth state.'
        );
        return true;
    }

    await runWithRuntimeAuthFailureRecoverySuppressed(async () => {
        const snapshot = await authRepository.recordLogout(currentUserId, {
            clearLastUserLoggedIn: true
        });
        await webRepository.clearCookies();
        resetReactAutoLoginThrottle();

        await resetCurrentUserRuntimeAuth();

        useSessionStore.getState().setSessionState({
            isLoggedIn: false,
            isFriendsLoaded: false,
            isFavoritesLoaded: false,
            sessionPhase: 'signed_out'
        });
        applySavedAuthSnapshot(snapshot);
        runtimeStore.setStartupTask(
            'auth',
            'completed',
            'Signed out from VRCX-0.'
        );
    });

    if (currentUserDisplayName) {
        toast.success(
            await i18n.t('message.auth.logout_greeting', {
                name: currentUserDisplayName
            })
        );
    }

    return true;
}

export async function executeCookieSessionRestore({
    endpoint = ''
}: { endpoint?: string } = {}) {
    const runtimeStore = useRuntimeStore.getState();
    setAuthenticatingSessionState();
    runtimeStore.setStartupTask(
        'auth',
        'running',
        endpoint
            ? `Restoring an existing browser session from ${endpoint}.`
            : 'Restoring an existing browser session.'
    );

    let currentUser: AuthUserRecord | null = null;
    let snapshot: SavedAuthSnapshot | null = null;

    try {
        const response = await vrchatAuthRepository.restoreCookieSession({
            endpoint
        });
        const authResponse = parseAuthResponse(response.json);

        if (authResponse.type !== 'authenticated') {
            throw createAuthExecutionError(
                'The stored browser session still requires interactive verification.',
                'AUTH_RESTORE_INTERACTIVE_REQUIRED'
            );
        }

        currentUser = authResponse.user;
        snapshot = await refreshSavedAuthSnapshot();
    } catch (error) {
        const normalizedError: AuthExecutionError =
            error instanceof Error ? error : new Error(String(error));
        if (isMissingCredentialsError(normalizedError)) {
            throw normalizedError;
        }

        return restoreAuthSnapshotOnFailure(normalizedError);
    }

    return finalizeSuccessfulLogin(
        snapshot,
        'Restored an existing browser session.',
        currentUser,
        {
            endpoint
        }
    );
}

export async function executeManualLogin({
    username,
    password,
    saveCredentials = false
}: {
    username?: unknown;
    password?: unknown;
    saveCredentials?: boolean;
}) {
    const runtimeStore = useRuntimeStore.getState();
    const loginParams = normalizeLoginParams({
        username,
        password
    });

    if (!loginParams.username || !loginParams.password) {
        throw createAuthExecutionError(
            'Username and password are required.',
            'AUTH_FORM_INVALID'
        );
    }

    runtimeStore.setStartupTask(
        'auth',
        'running',
        `Authenticating ${loginParams.username}.`
    );
    setAuthenticatingSessionState();

    let currentUser: AuthUserRecord | null = null;
    let snapshot: SavedAuthSnapshot | null = null;

    try {
        await webRepository.clearAuthCookies();
        const response =
            await vrchatAuthRepository.loginWithBasicAuth(loginParams);
        const authResponse = parseAuthResponse(response.json);
        currentUser =
            authResponse.type === 'authenticated'
                ? authResponse.user
                : await completeTwoFactorChallenge({
                      endpoint: loginParams.endpoint,
                      initialMethods: authResponse.methods,
                      async restartChallenge() {
                          await webRepository.clearAuthCookies();
                          return vrchatAuthRepository.loginWithBasicAuth(
                              loginParams
                          );
                      }
                  });
        snapshot = await authRepository.recordLoginSuccess({
            user: currentUser,
            loginParams,
            saveCredentials
        });
    } catch (error) {
        return restoreAuthSnapshotOnFailure(
            error instanceof Error ? error : new Error(String(error)),
            { credentialSubmission: true }
        );
    }

    return finalizeSuccessfulLogin(
        snapshot,
        saveCredentials
            ? 'Authenticated and refreshed saved credentials.'
            : 'Authenticated.',
        currentUser,
        {
            endpoint: loginParams.endpoint,
            websocket: loginParams.websocket
        }
    );
}

export async function executeSavedCredentialLogin(
    savedCredential: SavedCredentialRecord
) {
    const runtimeStore = useRuntimeStore.getState();
    const userId = normalizeText(savedCredential?.user?.id);
    const displayName =
        normalizeText(savedCredential?.user?.displayName) ||
        normalizeText(savedCredential?.user?.username) ||
        userId ||
        'saved account';

    const loginParams = normalizeLoginParams(
        savedCredential?.loginParams ?? {}
    );
    if (!userId || !savedCredential?.hasLoginCredentials) {
        throw createAuthExecutionError(
            'The saved account is missing username or password data.',
            'AUTH_SAVED_CREDENTIALS_INVALID'
        );
    }

    runtimeStore.setStartupTask(
        'auth',
        'running',
        `Authenticating ${displayName}.`
    );
    setAuthenticatingSessionState();

    let currentUser: AuthUserRecord | null = null;
    let snapshot: SavedAuthSnapshot | null = null;

    try {
        const response = await vrchatAuthRepository.loginWithSavedCredential({
            userId,
            endpoint: loginParams.endpoint
        });
        const authResponse = parseAuthResponse(response.json);
        currentUser =
            authResponse.type === 'authenticated'
                ? authResponse.user
                : await completeTwoFactorChallenge({
                      endpoint: loginParams.endpoint,
                      initialMethods: authResponse.methods,
                      async restartChallenge() {
                          return vrchatAuthRepository.loginWithSavedCredential({
                              userId,
                              endpoint: loginParams.endpoint
                          });
                      }
                  });
        snapshot = await authRepository.recordLoginSuccess({
            user: currentUser,
            saveCredentials: false
        });
    } catch (error) {
        const normalizedError: AuthExecutionError =
            error instanceof Error ? error : new Error(String(error));
        if (userId && isVrchatInvalidCredentialsError(normalizedError)) {
            await webRepository.clearCookies();
            await resetCurrentUserRuntimeAuth();
            setSignedOutSessionState();
            const snapshot = await authRepository.deleteSavedCredential(userId);
            applySavedAuthSnapshot(snapshot);
            const invalidSavedCredentialsError = createAuthExecutionError(
                'Saved credentials are no longer valid. The saved account has been removed.',
                'AUTH_SAVED_CREDENTIALS_INVALID'
            );
            invalidSavedCredentialsError.authSnapshot = snapshot;
            throw invalidSavedCredentialsError;
        }

        return restoreAuthSnapshotOnFailure(normalizedError);
    }

    return finalizeSuccessfulLogin(
        snapshot,
        'Authenticated with a saved account.',
        currentUser,
        {
            endpoint: loginParams.endpoint,
            websocket: loginParams.websocket
        }
    );
}
