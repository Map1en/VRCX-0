import {
    authRepository,
    avatarProfileRepository,
    vrchatAuthRepository,
    webRepository
} from '@/repositories/index.js';
import { useDialogStore } from '@/state/dialogStore.js';
import { useFavoriteStore } from '@/state/favoriteStore.js';
import { useModalStore } from '@/state/modalStore.js';
import { useNotificationStore } from '@/state/notificationStore.js';
import { useVrcNotificationStore } from '@/state/vrcNotificationStore.js';
import { useFriendRosterStore } from '@/state/friendRosterStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { useSessionStore } from '@/state/sessionStore.js';
import { toast } from 'sonner';

import { applySavedAuthSnapshot, refreshSavedAuthSnapshot } from './authSnapshotService.js';
import { resetReactAutoLoginThrottle } from './authAutoLoginState.js';
import { resetActivityCacheState } from './activityCacheService.js';
import { clearEntityQueryCache } from './entityQueryCacheService.js';
import { translateCurrentLocale } from './i18nService.js';
import { stopRealtimeTransport } from './realtimeTransportService.js';
import { bootstrapAuthenticatedSession } from './sessionBootstrapService.js';

function normalizeLoginParams(loginParams = {}) {
    return {
        username: typeof loginParams.username === 'string' ? loginParams.username.trim() : '',
        password: typeof loginParams.password === 'string' ? loginParams.password : '',
        endpoint: typeof loginParams.endpoint === 'string' ? loginParams.endpoint.trim() : '',
        websocket: typeof loginParams.websocket === 'string' ? loginParams.websocket.trim() : ''
    };
}

function createAuthExecutionError(message, code) {
    const error = new Error(message);
    error.code = code;
    return error;
}

function parseAuthResponse(json) {
    if (!json || typeof json !== 'object') {
        throw createAuthExecutionError('The auth request returned an invalid response.', 'AUTH_INVALID_RESPONSE');
    }

    if (Array.isArray(json.requiresTwoFactorAuth) && json.requiresTwoFactorAuth.length > 0) {
        return {
            type: 'twoFactor',
            methods: json.requiresTwoFactorAuth
        };
    }

    if (!json.id) {
        throw createAuthExecutionError('The auth request did not return a current user payload.', 'AUTH_INVALID_RESPONSE');
    }

    return {
        type: 'authenticated',
        user: json
    };
}

function isMissingCredentialsError(error) {
    return Boolean(
        error?.status === 401 &&
        typeof error?.message === 'string' &&
        error.message.includes('Missing Credentials')
    );
}

function getCurrentUserDisplayName(user) {
    return user?.displayName || user?.username || user?.id || '';
}

function setSignedOutSessionState() {
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

function resetCurrentUserRuntimeAuth() {
    stopRealtimeTransport();
    void clearEntityQueryCache();
    avatarProfileRepository.clearAvatarNameCache();
    useFriendRosterStore.getState().resetRoster();
    useFavoriteStore.getState().resetFavorites();
    resetActivityCacheState();
    useRuntimeStore.getState().setAuthBootstrap({
        currentUserId: null,
        currentUserDisplayName: '',
        currentUserEndpoint: '',
        currentUserWebsocket: '',
        currentUserSnapshot: null
    });
}

function setCurrentUserRuntimeAuth(user, { endpoint = '', websocket = '' } = {}) {
    stopRealtimeTransport({ updateStatus: false });
    void clearEntityQueryCache();
    avatarProfileRepository.clearAvatarNameCache();
    useFriendRosterStore.getState().resetRoster();
    useFavoriteStore.getState().resetFavorites();
    useRuntimeStore.getState().setAuthBootstrap({
        currentUserId: user?.id ?? null,
        currentUserDisplayName: getCurrentUserDisplayName(user),
        currentUserEndpoint: endpoint,
        currentUserWebsocket: websocket,
        currentUserSnapshot: user ?? null
    });
}

async function getLocalizedAuthPrompt(mode) {
    switch (mode) {
    case 'emailOtp': {
        const [title, description, confirmText, cancelText] = await Promise.all([
            translateCurrentLocale('prompt.email_otp.header'),
            translateCurrentLocale('prompt.email_otp.description'),
            translateCurrentLocale('prompt.email_otp.verify'),
            translateCurrentLocale('prompt.email_otp.resend')
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
        const [title, description, confirmText, cancelText] = await Promise.all([
            translateCurrentLocale('prompt.otp.header'),
            translateCurrentLocale('prompt.otp.description'),
            translateCurrentLocale('prompt.otp.verify'),
            translateCurrentLocale('prompt.otp.use_totp')
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
        const [title, description, confirmText, cancelText] = await Promise.all([
            translateCurrentLocale('prompt.totp.header'),
            translateCurrentLocale('prompt.totp.description'),
            translateCurrentLocale('prompt.totp.verify'),
            translateCurrentLocale('prompt.totp.use_otp')
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

async function promptForTwoFactorCode(mode) {
    const prompt = await getLocalizedAuthPrompt(mode);
    return useModalStore.getState().otpPrompt(prompt);
}

async function getTwoFactorInputErrorMessage(mode) {
    switch (mode) {
    case 'emailOtp':
        return translateCurrentLocale('prompt.email_otp.input_error');
    case 'otp':
        return translateCurrentLocale('prompt.otp.input_error');
    default:
        return translateCurrentLocale('prompt.totp.input_error');
    }
}

async function completeTwoFactorChallenge({
    endpoint,
    initialMethods,
    restartChallenge
}) {
    let methods = Array.isArray(initialMethods) ? [...initialMethods] : [];
    let mode = methods.includes('emailOtp') ? 'emailOtp' : 'totp';

    while (methods.length > 0) {
        const result = await promptForTwoFactorCode(mode);
        if (!result.ok) {
            if (mode === 'emailOtp' && result.reason === 'cancel' && typeof restartChallenge === 'function') {
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
            toast.error(error instanceof Error && error.message ? error.message : fallbackMessage);
            continue;
        }

        const currentUserResponse = await vrchatAuthRepository.getCurrentUser({ endpoint });
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

async function finalizeSuccessfulLogin(snapshot, detail, user, authContext = {}) {
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
        const normalizedError = error instanceof Error ? error : new Error(String(error));
        normalizedError.authSnapshot = snapshot;
        throw normalizedError;
    }
    return snapshot;
}

async function restoreAuthSnapshotOnFailure(error) {
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
        translateCurrentLocale('common.actions.confirm'),
        translateCurrentLocale('confirm.logout'),
        translateCurrentLocale('dialog.alertdialog.confirm'),
        translateCurrentLocale('dialog.alertdialog.cancel')
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
            'Reset VRCX without changing persisted auth state.'
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
    runtimeStore.setStartupTask('auth', 'completed', 'Signed out from VRCX.');

    if (currentUserDisplayName) {
        toast.success(
            await translateCurrentLocale('message.auth.logout_greeting', {
                name: currentUserDisplayName
            })
        );
    }

    return true;
}

export async function executeCookieSessionRestore({ endpoint = '' } = {}) {
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
        const response = await vrchatAuthRepository.getCurrentUser({ endpoint });
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
        const normalizedError = error instanceof Error ? error : new Error(String(error));
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
    endpoint = '',
    websocket = '',
    saveCredentials = false
}) {
    const runtimeStore = useRuntimeStore.getState();
    const loginParams = normalizeLoginParams({
        username,
        password,
        endpoint,
        websocket
    });

    if (!loginParams.username || !loginParams.password) {
        throw createAuthExecutionError('Username and password are required.', 'AUTH_FORM_INVALID');
    }

    runtimeStore.setStartupTask('auth', 'running', `Authenticating ${loginParams.username}.`);
    setAuthenticatingSessionState();

    let currentUser = null;
    let snapshot = null;

    try {
        await webRepository.clearCookies();
        await vrchatAuthRepository.getConfig({ endpoint: loginParams.endpoint });
        const response = await vrchatAuthRepository.loginWithBasicAuth(loginParams);
        const authResponse = parseAuthResponse(response.json);
        currentUser =
            authResponse.type === 'authenticated'
                ? authResponse.user
                : await completeTwoFactorChallenge({
                    endpoint: loginParams.endpoint,
                    initialMethods: authResponse.methods,
                    async restartChallenge() {
                        await webRepository.clearCookies();
                        return vrchatAuthRepository.loginWithBasicAuth(loginParams);
                    }
                });
        snapshot = await authRepository.recordLoginSuccess({
            user: currentUser,
            loginParams,
            saveCredentials
        });
    } catch (error) {
        return restoreAuthSnapshotOnFailure(error instanceof Error ? error : new Error(String(error)));
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

export async function executeSavedCredentialLogin(savedCredential) {
    const runtimeStore = useRuntimeStore.getState();
    const userId = savedCredential?.user?.id ?? '';
    const displayName =
        savedCredential?.user?.displayName || savedCredential?.user?.username || userId || 'saved account';

    let loginParams = normalizeLoginParams(savedCredential?.loginParams);
    if (!loginParams.username || !loginParams.password) {
        throw createAuthExecutionError(
            'The saved account is missing username or password data.',
            'AUTH_SAVED_CREDENTIALS_INVALID'
        );
    }

    runtimeStore.setStartupTask('auth', 'running', `Authenticating ${displayName}.`);
    setAuthenticatingSessionState();

    let currentUser = null;
    let snapshot = null;

    try {
        await webRepository.clearCookies();
        if (savedCredential?.cookies) {
            await webRepository.setCookies(savedCredential.cookies);
        }

        await vrchatAuthRepository.getConfig({ endpoint: loginParams.endpoint });
        const response = await vrchatAuthRepository.loginWithBasicAuth(loginParams);
        const authResponse = parseAuthResponse(response.json);
        currentUser =
            authResponse.type === 'authenticated'
                ? authResponse.user
                : await completeTwoFactorChallenge({
                    endpoint: loginParams.endpoint,
                    initialMethods: authResponse.methods,
                    async restartChallenge() {
                        await webRepository.clearCookies();
                        return vrchatAuthRepository.loginWithBasicAuth(loginParams);
                    }
                });
        snapshot = await authRepository.recordLoginSuccess({
            user: currentUser,
            loginParams,
            saveCredentials: false
        });
    } catch (error) {
        const normalizedError = error instanceof Error ? error : new Error(String(error));
        if (
            userId &&
            typeof normalizedError.message === 'string' &&
            normalizedError.message.includes('Invalid Username/Email or Password')
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
