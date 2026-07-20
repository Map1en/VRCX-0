import { toast } from 'sonner';

import { clearEntityQueryCache } from '@/lib/entityQueryCache';
import {
    type AuthenticatedRuntimeSession,
    type LoginFailureKind,
    type LoginSessionState
} from '@/platform/tauri/bindings';
import authRepository, {
    type SavedAuthSnapshot,
    type SavedCredentialRecord
} from '@/repositories/authRepository';
import avatarProfileRepository from '@/repositories/avatarProfileRepository';
import vrchatAuthRepository from '@/repositories/vrchatAuthRepository';
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

import {
    beginAuthAttempt,
    ensureCurrentAuthAttempt,
    isCurrentAuthAttempt,
    type AuthAttempt
} from './authAttempt';
import { applySavedAuthSnapshot } from './authSnapshotService';
import { buildAvatarWearSnapshotUpdate } from './avatarWearTimeService';
import {
    recordCurrentUserSnapshot,
    resetDomainFacts
} from './domainIngestionService';
import i18n from './i18nService';
import { bootstrapAuthenticatedSession } from './sessionBootstrapService';

type AuthExecutionError = Error & {
    code?: string;
    kind?: LoginFailureKind;
    authSnapshot?: SavedAuthSnapshot | null;
};

type AuthUserRecord = Record<string, unknown> & {
    id?: string;
    displayName?: string;
    username?: string;
};
type LoginParams = {
    username: string;
    password: string;
};
type TwoFactorMode = 'emailOtp' | 'otp' | 'totp';
type RestartLoginChallenge = (attemptId: string) => Promise<LoginSessionState>;
type ResolvedLoginSession = {
    session: AuthenticatedRuntimeSession;
    snapshot: SavedAuthSnapshot;
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
            typeof loginParams.password === 'string' ? loginParams.password : ''
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

function loginSessionFailureError(
    state: LoginSessionState
): AuthExecutionError {
    if (state.status === 'failed') {
        const error = createAuthExecutionError(
            state.reason || 'VRChat login failed.',
            'AUTH_LOGIN_FAILED'
        );
        error.kind = state.kind;
        error.authSnapshot = state.snapshot ?? null;
        return error;
    }
    return createAuthExecutionError(
        'The login session was cancelled.',
        'AUTH_LOGIN_CANCELLED'
    );
}

function authenticatedLoginResult(
    state: LoginSessionState & { status: 'authenticated' }
): ResolvedLoginSession {
    if (!state.snapshot) {
        throw createAuthExecutionError(
            'The authenticated session did not include its saved auth snapshot.',
            'AUTH_SNAPSHOT_MISSING'
        );
    }
    return {
        session: state.session,
        snapshot: state.snapshot
    };
}

export function toAuthUserRecord(
    session: AuthenticatedRuntimeSession
): AuthUserRecord {
    if (isRecord(session.currentUser)) {
        return session.currentUser;
    }
    return {
        id: session.userId,
        displayName: session.displayName
    };
}

function getCurrentUserDisplayName(user: AuthUserRecord | null) {
    return (
        normalizeText(user?.displayName) ||
        normalizeText(user?.username) ||
        normalizeText(user?.id)
    );
}

export function setSignedOutSessionState() {
    useSessionStore.getState().setSessionState({
        isLoggedIn: false,
        isFriendsLoaded: false,
        isFavoritesLoaded: false,
        sessionPhase: 'signed_out'
    });
}

export function setAuthenticatingSessionState() {
    useSessionStore.getState().setSessionState({
        isLoggedIn: false,
        isFriendsLoaded: false,
        isFavoritesLoaded: false,
        sessionPhase: 'authenticating'
    });
}

function resetCurrentUserRuntimeCaches() {
    clearEntityQueryCache();
    avatarProfileRepository.clearAvatarNameCache();
    useFriendRosterStore.getState().resetRoster();
    useFavoriteStore.getState().resetFavorites();
    useFeedLiveStore.getState().resetFeedLive();
    resetDomainFacts();
    useRuntimeStore
        .getState()
        .setGroupInstancesState(createGroupInstancesState());
}

function clearCurrentUserRuntimeAuthState() {
    resetCurrentUserRuntimeCaches();
    useRuntimeStore.getState().setAuthBootstrap({
        currentUserId: null,
        currentUserDisplayName: '',
        currentUserEndpoint: '',
        currentUserWebsocket: '',
        currentUserSnapshot: null
    });
}

export function resetCurrentUserRuntimeAuth() {
    clearCurrentUserRuntimeAuthState();
}

function setCurrentUserRuntimeAuth(
    user: AuthUserRecord | null,
    { endpoint = '', websocket = '' }: Record<string, string> = {}
) {
    const runtimeStore = useRuntimeStore.getState();
    const { snapshot } = buildAvatarWearSnapshotUpdate({
        previousSnapshot: runtimeStore.auth.currentUserSnapshot,
        nextSnapshot: user,
        isGameRunning: runtimeStore.gameState.isGameRunning
    });
    const nextSnapshot = isRecord(snapshot) ? snapshot : null;
    const currentUserId = normalizeText(nextSnapshot?.id);

    resetCurrentUserRuntimeCaches();
    useRuntimeStore.getState().setAuthBootstrap({
        currentUserId: currentUserId || null,
        currentUserDisplayName: getCurrentUserDisplayName(nextSnapshot),
        currentUserEndpoint: endpoint,
        currentUserWebsocket: websocket,
        currentUserSnapshot: nextSnapshot ?? null
    });
    recordCurrentUserSnapshot(nextSnapshot ?? null, { endpoint });
}

async function getLocalizedAuthPrompt(mode: TwoFactorMode): Promise<{
    mode: TwoFactorMode;
    title: string;
    description: string;
    confirmText: string;
    cancelText: string;
}> {
    const keys = {
        emailOtp: [
            'prompt.email_otp.header',
            'prompt.email_otp.description',
            'prompt.email_otp.verify',
            'prompt.email_otp.resend'
        ],
        otp: [
            'prompt.otp.header',
            'prompt.otp.description',
            'prompt.otp.verify',
            'prompt.otp.use_totp'
        ],
        totp: [
            'prompt.totp.header',
            'prompt.totp.description',
            'prompt.totp.verify',
            'prompt.totp.use_otp'
        ]
    }[mode];
    const [title, description, confirmText, cancelText] = await Promise.all(
        keys.map((key) => i18n.t(key))
    );
    return { mode, title, description, confirmText, cancelText };
}

async function promptForTwoFactorCode(mode: TwoFactorMode) {
    const prompt = await getLocalizedAuthPrompt(mode);
    return useModalStore.getState().otpPrompt(prompt);
}

async function getTwoFactorInputErrorMessage(mode: TwoFactorMode) {
    return i18n.t(
        {
            emailOtp: 'prompt.email_otp.input_error',
            otp: 'prompt.otp.input_error',
            totp: 'prompt.totp.input_error'
        }[mode]
    );
}

function normalizeTwoFactorMode(mode: string): TwoFactorMode {
    return mode === 'emailOtp' || mode === 'otp' ? mode : 'totp';
}

async function completeTwoFactorChallenge(
    challenge: LoginSessionState & { status: 'challenge' },
    restartChallenge: RestartLoginChallenge,
    attempt: AuthAttempt
): Promise<ResolvedLoginSession> {
    let mode = normalizeTwoFactorMode(challenge.mode);
    let challengeAttemptId = challenge.attemptId;

    while (true) {
        ensureCurrentAuthAttempt(attempt);
        const result = await promptForTwoFactorCode(mode);
        ensureCurrentAuthAttempt(attempt);
        if (!result.ok) {
            if (result.reason === 'cancel') {
                if (mode === 'emailOtp') {
                    const restarted =
                        await restartChallenge(challengeAttemptId);
                    ensureCurrentAuthAttempt(attempt);
                    if (restarted.status === 'authenticated') {
                        return authenticatedLoginResult(restarted);
                    }
                    if (restarted.status !== 'challenge') {
                        throw loginSessionFailureError(restarted);
                    }
                    challengeAttemptId = restarted.attemptId;
                    mode = normalizeTwoFactorMode(restarted.mode);
                    continue;
                }

                mode = mode === 'totp' ? 'otp' : 'totp';
                continue;
            }

            await vrchatAuthRepository.cancelLoginSession(challengeAttemptId);
            ensureCurrentAuthAttempt(attempt);
            throw createAuthExecutionError(
                'Two-factor verification was cancelled.',
                'AUTH_2FA_CANCELLED'
            );
        }

        const next = await vrchatAuthRepository.respondLoginSession({
            attemptId: challengeAttemptId,
            method: mode,
            code: result.value
        });
        ensureCurrentAuthAttempt(attempt);
        if (next.status === 'authenticated') {
            return authenticatedLoginResult(next);
        }
        if (next.status !== 'challenge') {
            throw loginSessionFailureError(next);
        }
        if (next.error) {
            toast.error(await getTwoFactorInputErrorMessage(mode));
            continue;
        }
        challengeAttemptId = next.attemptId;
        mode = normalizeTwoFactorMode(next.mode);
    }
}

export async function resolveLoginSessionState(
    state: LoginSessionState,
    restartChallenge: RestartLoginChallenge,
    attempt: AuthAttempt
): Promise<ResolvedLoginSession> {
    ensureCurrentAuthAttempt(attempt);
    if (state.status === 'authenticated') {
        return authenticatedLoginResult(state);
    }
    if (state.status === 'challenge') {
        return completeTwoFactorChallenge(state, restartChallenge, attempt);
    }
    throw loginSessionFailureError(state);
}

export async function finalizeSuccessfulLogin(
    resolved: ResolvedLoginSession,
    detail: string,
    attempt: AuthAttempt
) {
    ensureCurrentAuthAttempt(attempt);
    const user = toAuthUserRecord(resolved.session);
    setCurrentUserRuntimeAuth(user, {
        endpoint: resolved.session.endpoint,
        websocket: resolved.session.websocket
    });
    applySavedAuthSnapshot(resolved.snapshot);
    useRuntimeStore.getState().setStartupTask('auth', 'completed', detail);
    try {
        await bootstrapAuthenticatedSession(user, attempt);
    } catch (error) {
        const normalizedError: AuthExecutionError =
            error instanceof Error ? error : new Error(String(error));
        normalizedError.authSnapshot = resolved.snapshot;
        throw normalizedError;
    }
    return resolved.snapshot;
}

function restoreAuthSnapshotOnFailure(
    error: AuthExecutionError,
    attempt: AuthAttempt
): never {
    if (!isCurrentAuthAttempt(attempt)) {
        throw error;
    }
    resetCurrentUserRuntimeAuth();
    setSignedOutSessionState();

    if (error.authSnapshot) {
        error.authSnapshot = applySavedAuthSnapshot(error.authSnapshot);
    }
    throw error;
}

function normalizeAuthExecutionError(error: unknown): AuthExecutionError {
    return error instanceof Error ? error : new Error(String(error));
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

    const attempt = beginAuthAttempt();

    const runtimeStore = useRuntimeStore.getState();
    const currentUserId = runtimeStore.auth.currentUserId;
    const currentUserDisplayName = runtimeStore.auth.currentUserDisplayName;
    const sessionPhase = useSessionStore.getState().sessionPhase;

    useDialogStore.getState().clearDialogState();
    useModalStore.getState().resetModalState();
    useNotificationStore.getState().resetNotificationState();
    useVrcNotificationStore.getState().resetVrcNotificationState();

    if (!currentUserId && sessionPhase !== 'authenticating') {
        resetCurrentUserRuntimeAuth();
        setSignedOutSessionState();
        runtimeStore.setStartupTask(
            'auth',
            'completed',
            'Reset VRCX-0 without changing persisted auth state.'
        );
        return true;
    }

    let snapshot: SavedAuthSnapshot | null;
    try {
        snapshot = await authRepository.endSession({ kind: 'logout' });
    } catch (error) {
        if (isCurrentAuthAttempt(attempt)) {
            clearCurrentUserRuntimeAuthState();
            setSignedOutSessionState();
        }
        throw error;
    }
    ensureCurrentAuthAttempt(attempt);
    if (!snapshot) {
        return false;
    }
    clearCurrentUserRuntimeAuthState();
    setSignedOutSessionState();
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

async function executeLoginAttempt({
    startupDetail,
    successDetail,
    startSession,
    transformError
}: {
    startupDetail: string;
    successDetail: string;
    startSession: () => Promise<LoginSessionState>;
    transformError?: (error: AuthExecutionError) => void;
}) {
    const attempt = beginAuthAttempt();
    useRuntimeStore.getState().setStartupTask('auth', 'running', startupDetail);
    setAuthenticatingSessionState();

    let resolved: ResolvedLoginSession;
    try {
        const state = await startSession();
        ensureCurrentAuthAttempt(attempt);
        resolved = await resolveLoginSessionState(
            state,
            async (challengeAttemptId) => {
                await vrchatAuthRepository.cancelLoginSession(
                    challengeAttemptId
                );
                ensureCurrentAuthAttempt(attempt);
                return startSession();
            },
            attempt
        );
    } catch (error) {
        const normalizedError = normalizeAuthExecutionError(error);
        transformError?.(normalizedError);
        return restoreAuthSnapshotOnFailure(normalizedError, attempt);
    }

    return finalizeSuccessfulLogin(resolved, successDetail, attempt);
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

    return executeLoginAttempt({
        startupDetail: `Authenticating ${loginParams.username}.`,
        successDetail: saveCredentials
            ? 'Authenticated and refreshed saved credentials.'
            : 'Authenticated.',
        startSession: () =>
            vrchatAuthRepository.startLoginSession({
                mode: 'basic',
                username: loginParams.username,
                password: loginParams.password,
                saveCredentials
            })
    });
}

export async function executeSavedCredentialLogin(
    savedCredential: SavedCredentialRecord
) {
    const userId = normalizeText(savedCredential?.user?.id);
    const displayName =
        normalizeText(savedCredential?.user?.displayName) ||
        normalizeText(savedCredential?.user?.username) ||
        userId ||
        'saved account';

    if (!userId || !savedCredential?.hasLoginCredentials) {
        throw createAuthExecutionError(
            'The saved account is missing username or password data.',
            'AUTH_SAVED_CREDENTIALS_INVALID'
        );
    }

    return executeLoginAttempt({
        startupDetail: `Authenticating ${displayName}.`,
        successDetail: 'Authenticated with a saved account.',
        startSession: () =>
            vrchatAuthRepository.startLoginSession({
                mode: 'savedCredential',
                userId
            }),
        transformError: (error) => {
            if (error.kind === 'invalidCredentials') {
                error.message =
                    'Saved credentials are no longer valid. The saved account has been removed.';
                error.code = 'AUTH_SAVED_CREDENTIALS_INVALID';
            }
        }
    });
}
