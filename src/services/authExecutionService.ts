import { toast } from 'sonner';

import { clearEntityQueryCache } from '@/lib/entityQueryCache.js';
import { backend } from '@/platform/index.js';
import {
    authRepository,
    avatarProfileRepository,
    vrchatAuthRepository,
    webRepository
} from '@/repositories/index.js';
import { useDialogStore } from '@/state/dialogStore.js';
import { useFavoriteStore } from '@/state/favoriteStore.js';
import { useFriendRosterStore } from '@/state/friendRosterStore.js';
import { useModalStore } from '@/state/modalStore.js';
import { useNotificationStore } from '@/state/notificationStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { useSessionStore } from '@/state/sessionStore.js';
import { useVrcNotificationStore } from '@/state/vrcNotificationStore.js';

import { resetActivityCacheState } from './activityCacheService.js';
import { resetReactAutoLoginThrottle } from './authAutoLoginState.js';
import {
    applySavedAuthSnapshot,
    refreshSavedAuthSnapshot
} from './authSnapshotService.js';
import { buildAvatarWearSnapshotUpdate } from './avatarWearTimeService.js';
import i18n from './i18nService.js';
import {
    recordCurrentUserSnapshot,
    resetDomainFacts
} from './domainIngestionService.js';
import { stopRealtimeTransport } from './realtimeTransportService.js';
import { bootstrapAuthenticatedSession } from './sessionBootstrapService.js';

type AuthExecutionError = Error & {
    code?: string;
    authSnapshot?: unknown;
};

type AuthResponse =
    | {
          type: 'twoFactor';
          methods: string[];
      }
    | {
          type: 'authenticated';
          user: Record<string, any>;
      };

function normalizeLoginParams(loginParams: Record<string, any> = {}) {
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

function parseAuthResponse(json: any): AuthResponse {
    if (!json || typeof json !== 'object') {
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
            methods: json.requiresTwoFactorAuth
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
        user: json
    };
}

function isMissingCredentialsError(error: any) {
    return Boolean(
        error?.status === 401 &&
        typeof error?.message === 'string' &&
        error.message.includes('Missing Credentials')
    );
}

function getCurrentUserDisplayName(user: Record<string, any> | null) {
    return user?.displayName || user?.username || user?.id || '';
}

function setBackendAuthScope(userId = '', endpoint = '') {
    void backend.app
        .BackendAuthScopeSet({
            userId,
            endpoint
        })
        .catch((error) => {
            console.warn('Failed to sync backend auth scope:', error);
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
    void clearEntityQueryCache();
    avatarProfileRepository.clearAvatarNameCache();
    useFriendRosterStore.getState().resetRoster();
    useFavoriteStore.getState().resetFavorites();
    resetDomainFacts();
    resetActivityCacheState();
    useRuntimeStore.getState().setAuthBootstrap({
        currentUserId: null,
        currentUserDisplayName: '',
        currentUserEndpoint: '',
        currentUserWebsocket: '',
        currentUserSnapshot: null
    });
    setBackendAuthScope();
}

function setCurrentUserRuntimeAuth(
    user: Record<string, any> | null,
    { endpoint = '', websocket = '' }: Record<string, string> = {}
) {
    stopRealtimeTransport({ updateStatus: false });
    void clearEntityQueryCache();
    avatarProfileRepository.clearAvatarNameCache();
    useFriendRosterStore.getState().resetRoster();
    useFavoriteStore.getState().resetFavorites();
    resetDomainFacts();
    const runtimeStore = useRuntimeStore.getState();
    const { snapshot: nextSnapshot } = buildAvatarWearSnapshotUpdate({
        previousSnapshot: runtimeStore.auth.currentUserSnapshot,
        nextSnapshot: user,
        isGameRunning: runtimeStore.gameState.isGameRunning
    }) as any;

    useRuntimeStore.getState().setAuthBootstrap({
        currentUserId: nextSnapshot?.id ?? null,
        currentUserDisplayName: getCurrentUserDisplayName(nextSnapshot),
        currentUserEndpoint: endpoint,
        currentUserWebsocket: websocket,
        currentUserSnapshot: nextSnapshot ?? null
    });
    setBackendAuthScope(nextSnapshot?.id ?? '', endpoint);
    recordCurrentUserSnapshot(nextSnapshot ?? null, { endpoint });
}

async function getLocalizedAuthPrompt(mode: string) {
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

async function promptForTwoFactorCode(mode: string) {
    const prompt = await getLocalizedAuthPrompt(mode);
    return useModalStore.getState().otpPrompt(prompt as any);
}

async function getTwoFactorInputErrorMessage(mode: string) {
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
    restartChallenge?: () => Promise<{ json: any }>;
}) {
    let methods = Array.isArray(initialMethods) ? [...initialMethods] : [];
    let mode = methods.includes('emailOtp') ? 'emailOtp' : 'totp';

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
    snapshot: unknown,
    detail: string,
    user: Record<string, any>,
    authContext: Record<string, string> = {}
) {
    applySavedAuthSnapshot(snapshot as any);
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

async function restoreAuthSnapshotOnFailure(error: AuthExecutionError) {
    try {
        await webRepository.clearCookies();
    } catch {
        // ignore cleanup failure and still surface the original auth error
    }

    setSignedOutSessionState();
    resetCurrentUserRuntimeAuth();

    try {
        error.authSnapshot = await refreshSavedAuthSnapshot();
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
        useSessionStore.getState().setSessionState({
            isLoggedIn: false,
            isFriendsLoaded: false,
            isFavoritesLoaded: false,
            sessionPhase: 'signed_out'
        });
        resetCurrentUserRuntimeAuth();
        runtimeStore.setStartupTask(
            'auth',
            'completed',
            'Reset VRCX-0 without changing persisted auth state.'
        );
        return true;
    }

    let persistedCookies = null;
    try {
        persistedCookies = await webRepository.getCookies();
    } catch {
        persistedCookies = null;
    }

    await webRepository.clearCookies();
    const snapshot = await authRepository.recordLogout(currentUserId, {
        cookies: persistedCookies,
        clearLastUserLoggedIn: true
    });
    resetReactAutoLoginThrottle();

    useSessionStore.getState().setSessionState({
        isLoggedIn: false,
        isFriendsLoaded: false,
        isFavoritesLoaded: false,
        sessionPhase: 'signed_out'
    });
    resetCurrentUserRuntimeAuth();
    applySavedAuthSnapshot(snapshot);
    runtimeStore.setStartupTask('auth', 'completed', 'Signed out from VRCX-0.');

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

    let currentUser = null;
    let snapshot = null;

    try {
        await vrchatAuthRepository.getConfig({ endpoint });
        const response = await vrchatAuthRepository.getCurrentUser({
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
        const normalizedError =
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

    let currentUser = null;
    let snapshot = null;

    try {
        await webRepository.clearCookies();
        await vrchatAuthRepository.getConfig({
            endpoint: loginParams.endpoint
        });
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
                          await webRepository.clearCookies();
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
            error instanceof Error ? error : new Error(String(error))
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
    savedCredential: Record<string, any>
) {
    const runtimeStore = useRuntimeStore.getState();
    const userId = savedCredential?.user?.id ?? '';
    const displayName =
        savedCredential?.user?.displayName ||
        savedCredential?.user?.username ||
        userId ||
        'saved account';

    const loginParams = {
        ...normalizeLoginParams(savedCredential?.loginParams),
        endpoint: '',
        websocket: ''
    };
    if (!loginParams.username || !loginParams.password) {
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

    let currentUser = null;
    let snapshot = null;

    try {
        await webRepository.clearCookies();
        if (savedCredential?.cookies) {
            await webRepository.setCookies(savedCredential.cookies);
        }

        await vrchatAuthRepository.getConfig({
            endpoint: loginParams.endpoint
        });
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
                          await webRepository.clearCookies();
                          return vrchatAuthRepository.loginWithBasicAuth(
                              loginParams
                          );
                      }
                  });
        snapshot = await authRepository.recordLoginSuccess({
            user: currentUser,
            loginParams,
            saveCredentials: false
        });
    } catch (error) {
        const normalizedError: AuthExecutionError =
            error instanceof Error ? error : new Error(String(error));
        if (
            userId &&
            typeof normalizedError.message === 'string' &&
            normalizedError.message.includes(
                'Invalid Username/Email or Password'
            )
        ) {
            await webRepository.clearCookies();
            setSignedOutSessionState();
            resetCurrentUserRuntimeAuth();
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
