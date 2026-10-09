import {
    useCallback,
    useEffect,
    useRef,
    useState,
    type FormEvent
} from 'react';
import { useTranslation } from 'react-i18next';

import { queryClient } from '@/lib/queryClient';
import { commands, type CollectorAuthStatus } from '@/platform/tauri/bindings';
import {
    getLocalizedAuthPrompt,
    normalizeTwoFactorMode
} from '@/services/authExecutionService';
import { useFriendLogStore } from '@/state/friendLogStore';
import { useModalStore } from '@/state/modalStore';
import { Alert, AlertDescription, AlertTitle } from '@/ui/shadcn/alert';
import { Button } from '@/ui/shadcn/button';
import { Field, FieldLabel } from '@/ui/shadcn/field';
import { Input } from '@/ui/shadcn/input';
import { Spinner } from '@/ui/shadcn/spinner';

const STATUS_POLL_MS = 20_000;
const DATABASE_CHECK_MS = 15_000;

export function RemoteRuntimeStatus() {
    const { t } = useTranslation();
    const [isRemote, setIsRemote] = useState(false);
    const [databaseConnected, setDatabaseConnected] = useState(false);
    const [databaseError, setDatabaseError] = useState<string | null>(null);
    const [authStatus, setAuthStatus] = useState<CollectorAuthStatus | null>(
        null
    );
    const [authStatusUnavailable, setAuthStatusUnavailable] = useState(false);
    const [authError, setAuthError] = useState<string | null>(null);
    const [authBusy, setAuthBusy] = useState(false);
    const [loginOpen, setLoginOpen] = useState(false);
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const wasDatabaseConnected = useRef<boolean | null>(null);
    const databaseProbeInFlight = useRef(false);
    const authProbeGeneration = useRef<number | null>(null);
    const authBusyRef = useRef(false);
    const authGeneration = useRef(0);
    const remoteMode = useRef(false);
    const databaseIsConnected = useRef(false);
    const mounted = useRef(false);

    const refreshDatabase = useCallback(async () => {
        if (databaseProbeInFlight.current) return;
        databaseProbeInFlight.current = true;
        try {
            const result = await commands.appRemoteDatabaseConnectionCheck();
            if (!mounted.current) return;
            setIsRemote(result.isRemote);
            remoteMode.current = result.isRemote;
            const connected = result.isRemote && result.state === 'connected';
            setDatabaseConnected(connected);
            setDatabaseError(result.error ?? null);
            databaseIsConnected.current = connected;
            if (!connected) {
                // A disconnected database cannot provide trustworthy collector
                // auth state. Ignore any status request already in flight.
                authGeneration.current += 1;
                setAuthStatus(null);
                setAuthStatusUnavailable(false);
                setAuthError(null);
                setLoginOpen(false);
                authBusyRef.current = false;
                setAuthBusy(false);
            }
            if (connected && wasDatabaseConnected.current === false) {
                void queryClient.invalidateQueries();
                useFriendLogStore.getState().bumpRevision();
            }
            wasDatabaseConnected.current = connected;
        } catch {
            if (!mounted.current) return;
            // A failed status command is not evidence that the selected mode
            // is remote. Preserve the mode learned from bootstrap/status.
            if (!remoteMode.current) return;
            setDatabaseConnected(false);
            setDatabaseError(t('view.collector.remoteDatabaseUnavailable'));
            databaseIsConnected.current = false;
            authGeneration.current += 1;
            setAuthStatus(null);
            setAuthStatusUnavailable(false);
            setAuthError(null);
            setLoginOpen(false);
            authBusyRef.current = false;
            setAuthBusy(false);
            wasDatabaseConnected.current = false;
        } finally {
            databaseProbeInFlight.current = false;
        }
    }, [t]);

    const refreshAuth = useCallback(async () => {
        if (
            !mounted.current ||
            !remoteMode.current ||
            !databaseIsConnected.current
        ) {
            return;
        }
        if (authBusyRef.current) return;
        const generation = authGeneration.current;
        if (authProbeGeneration.current === generation) return;
        authProbeGeneration.current = generation;
        try {
            const result = await commands.appCollectorAuthStatusGet();
            if (
                !mounted.current ||
                generation !== authGeneration.current ||
                !remoteMode.current ||
                !databaseIsConnected.current
            ) {
                return;
            }
            setAuthStatus(result);
            setAuthStatusUnavailable(false);
            setAuthError(null);
        } catch {
            if (
                !mounted.current ||
                generation !== authGeneration.current ||
                !remoteMode.current ||
                !databaseIsConnected.current
            ) {
                return;
            }
            // Transport errors do not mean the collector needs credentials.
            setAuthStatus(null);
            setAuthStatusUnavailable(true);
            setAuthError(null);
        } finally {
            if (authProbeGeneration.current === generation) {
                authProbeGeneration.current = null;
            }
        }
    }, []);

    useEffect(() => {
        if (databaseConnected && isRemote) void refreshAuth();
    }, [databaseConnected, isRemote, refreshAuth]);

    const continueTwoFactor = useCallback(
        async (initial: CollectorAuthStatus, generation: number) => {
            let result = initial;
            while (result.status === 'awaitingTwoFactor') {
                if (
                    !mounted.current ||
                    generation !== authGeneration.current ||
                    !databaseIsConnected.current
                ) {
                    return null;
                }
                let mode = normalizeTwoFactorMode(result.mode ?? 'totp');
                const prompt = await getLocalizedAuthPrompt(mode);
                if (
                    !mounted.current ||
                    generation !== authGeneration.current ||
                    !databaseIsConnected.current
                ) {
                    return null;
                }
                if (mode === 'emailOtp') {
                    prompt.cancelText = t('common.actions.cancel');
                }
                const code = await useModalStore.getState().otpPrompt(prompt);
                if (
                    !mounted.current ||
                    generation !== authGeneration.current ||
                    !databaseIsConnected.current
                ) {
                    return null;
                }
                if (!code.ok || !code.value) {
                    if (code.reason === 'cancel' && mode !== 'emailOtp') {
                        mode = mode === 'totp' ? 'otp' : 'totp';
                        result = { ...result, mode };
                        continue;
                    }
                    if (result.attemptId) {
                        result = await commands.appCollectorAuthCancel(
                            result.attemptId
                        );
                        if (
                            !mounted.current ||
                            generation !== authGeneration.current ||
                            !databaseIsConnected.current
                        ) {
                            return null;
                        }
                        setAuthStatus(result);
                    }
                    return result;
                }
                if (!result.attemptId) {
                    throw new Error(t('view.collector.authAttemptMissing'));
                }
                result = await commands.appCollectorAuthVerify(
                    result.attemptId,
                    mode,
                    code.value
                );
                if (
                    !mounted.current ||
                    generation !== authGeneration.current ||
                    !databaseIsConnected.current
                ) {
                    return null;
                }
                setAuthStatus(result);
                setAuthError(result.error ?? null);
            }
            return result;
        },
        [t]
    );

    useEffect(() => {
        let active = true;
        let databaseTimer: number | null = null;
        let authTimer: number | null = null;
        const initialize = async () => {
            try {
                const bootstrap = await commands.appBootstrapStatusGet();
                if (!active) return;
                mounted.current = true;
                remoteMode.current = bootstrap.isRemote;
                setIsRemote(bootstrap.isRemote);
                if (!bootstrap.isRemote) return;
                await refreshDatabase();
                if (active) {
                    databaseTimer = window.setInterval(() => {
                        if (active) void refreshDatabase();
                    }, DATABASE_CHECK_MS);
                    authTimer = window.setInterval(() => {
                        if (active) void refreshAuth();
                    }, STATUS_POLL_MS);
                }
            } catch {
                // The bootstrap UI owns failures before an AppState exists.
            }
        };
        void initialize();
        return () => {
            active = false;
            mounted.current = false;
            authGeneration.current += 1;
            if (databaseTimer !== null) window.clearInterval(databaseTimer);
            if (authTimer !== null) window.clearInterval(authTimer);
        };
    }, [refreshAuth, refreshDatabase]);

    const authenticate = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const generation = ++authGeneration.current;
        authBusyRef.current = true;
        setAuthBusy(true);
        setAuthError(null);
        try {
            let result = await commands.appCollectorAuthLogin(
                username.trim(),
                password
            );
            if (
                !mounted.current ||
                generation !== authGeneration.current ||
                !databaseIsConnected.current
            ) {
                return;
            }
            setAuthStatus(result);
            if (result.status === 'awaitingTwoFactor') {
                const twoFactorResult = await continueTwoFactor(
                    result,
                    generation
                );
                if (!twoFactorResult) return;
                result = twoFactorResult;
            }
            if (generation !== authGeneration.current) return;
            if (result.status === 'error' || result.error) {
                setAuthError(result.error || t('view.collector.authFailed'));
                setLoginOpen(true);
            } else {
                setLoginOpen(false);
            }
        } catch (error) {
            if (mounted.current && generation === authGeneration.current) {
                setAuthStatus(null);
                setAuthStatusUnavailable(true);
                setAuthError(errorMessage(error));
                void refreshDatabase();
            }
        } finally {
            if (generation === authGeneration.current) {
                authBusyRef.current = false;
                setAuthBusy(false);
            }
            setPassword('');
        }
    };

    const resumeTwoFactor = async () => {
        if (!authStatus || authStatus.status !== 'awaitingTwoFactor') return;
        const generation = ++authGeneration.current;
        authBusyRef.current = true;
        setAuthBusy(true);
        setAuthError(null);
        try {
            const result = await continueTwoFactor(authStatus, generation);
            if (
                !result ||
                !mounted.current ||
                generation !== authGeneration.current
            ) {
                return;
            }
            setAuthStatus(result);
            if (result.status === 'error' || result.error) {
                setAuthError(result.error || t('view.collector.authFailed'));
            }
        } catch (error) {
            if (mounted.current && generation === authGeneration.current) {
                setAuthStatus(null);
                setAuthStatusUnavailable(true);
                setAuthError(errorMessage(error));
                void refreshDatabase();
            }
        } finally {
            if (generation === authGeneration.current) {
                authBusyRef.current = false;
                setAuthBusy(false);
            }
        }
    };

    const collectorReady =
        databaseConnected &&
        authStatus?.status === 'ready' &&
        authStatus.collectorReady;
    if (!isRemote || collectorReady) return null;

    const hasConfirmedAuthState =
        authStatus?.status === 'needsLogin' ||
        authStatus?.status === 'error' ||
        authStatus?.status === 'awaitingTwoFactor' ||
        authStatus?.status === 'authenticating' ||
        authStatus?.status === 'ready';

    return (
        <div className="pointer-events-none fixed inset-x-3 top-12 z-50 flex justify-center">
            <div className="pointer-events-auto w-full max-w-3xl space-y-2">
                {!databaseConnected ? (
                    <Alert variant="destructive" role="status">
                        <AlertTitle>
                            {t('view.collector.remoteDisconnected')}
                        </AlertTitle>
                        <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
                            <span>
                                {databaseError ||
                                    t(
                                        'view.collector.remoteDatabaseUnavailable'
                                    )}{' '}
                                {t('view.collector.remoteRetrying')}
                            </span>
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={() => void refreshDatabase()}
                            >
                                {t('common.action.retry')}
                            </Button>
                        </AlertDescription>
                    </Alert>
                ) : null}
                {databaseConnected &&
                !collectorReady &&
                hasConfirmedAuthState ? (
                    <Alert role="status">
                        <AlertTitle>
                            {authStatus?.status === 'authenticating'
                                ? t('view.collector.authStarting')
                                : authStatus?.status === 'ready'
                                  ? t('view.collector.collectorStarting')
                                  : t('view.collector.authRequired')}
                        </AlertTitle>
                        <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                            <span>
                                {authError ||
                                    authStatus?.error ||
                                    t('view.collector.authDescription')}
                            </span>
                            {authStatus?.status === 'awaitingTwoFactor' ? (
                                <Button
                                    size="sm"
                                    disabled={authBusy}
                                    onClick={() => void resumeTwoFactor()}
                                >
                                    {t('view.collector.continueVerification')}
                                </Button>
                            ) : authStatus?.status === 'authenticating' ||
                              authStatus?.status === 'ready' ? (
                                <Button
                                    size="sm"
                                    disabled={authBusy}
                                    onClick={() => void refreshAuth()}
                                >
                                    {t('common.action.retry')}
                                </Button>
                            ) : loginOpen ? (
                                <form
                                    className="flex flex-wrap items-end gap-2"
                                    onSubmit={(event) =>
                                        void authenticate(event)
                                    }
                                >
                                    <Field className="w-44">
                                        <FieldLabel htmlFor="collector-username">
                                            {t('view.login.field.username')}
                                        </FieldLabel>
                                        <Input
                                            id="collector-username"
                                            autoComplete="username"
                                            value={username}
                                            disabled={authBusy}
                                            onChange={(event) =>
                                                setUsername(event.target.value)
                                            }
                                            required
                                        />
                                    </Field>
                                    <Field className="w-44">
                                        <FieldLabel htmlFor="collector-password">
                                            {t('view.login.field.password')}
                                        </FieldLabel>
                                        <Input
                                            id="collector-password"
                                            type="password"
                                            autoComplete="current-password"
                                            value={password}
                                            disabled={authBusy}
                                            onChange={(event) =>
                                                setPassword(event.target.value)
                                            }
                                            required
                                        />
                                    </Field>
                                    <Button
                                        type="submit"
                                        size="sm"
                                        disabled={
                                            authBusy || !databaseConnected
                                        }
                                    >
                                        {authBusy ? (
                                            <Spinner data-icon="inline-start" />
                                        ) : null}
                                        {t('view.collector.signIn')}
                                    </Button>
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="ghost"
                                        disabled={authBusy}
                                        onClick={() => {
                                            setLoginOpen(false);
                                            setPassword('');
                                        }}
                                    >
                                        {t('common.actions.cancel')}
                                    </Button>
                                </form>
                            ) : (
                                <Button
                                    size="sm"
                                    disabled={!databaseConnected || authBusy}
                                    onClick={() => setLoginOpen(true)}
                                >
                                    {t('view.collector.signIn')}
                                </Button>
                            )}
                        </AlertDescription>
                    </Alert>
                ) : null}
                {databaseConnected &&
                !collectorReady &&
                authStatusUnavailable ? (
                    <Alert role="status">
                        <AlertTitle>
                            {t('view.collector.authStatusUnavailable')}
                        </AlertTitle>
                        <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
                            <span>
                                {authError ||
                                    t('view.collector.remoteRetrying')}
                            </span>
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={() => void refreshAuth()}
                            >
                                {t('common.action.retry')}
                            </Button>
                        </AlertDescription>
                    </Alert>
                ) : null}
            </div>
        </div>
    );
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
