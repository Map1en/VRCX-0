import { useEffect, useRef, useState } from 'react';
import {
    LanguagesIcon,
    LoaderCircleIcon,
    Trash2Icon,
    UserIcon
} from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { useI18n } from '@/app/hooks/use-i18n.js';
import { openExternalLink, userImage } from '@/lib/entityMedia.js';
import { DEFAULT_ENDPOINT_DOMAIN, DEFAULT_WEBSOCKET_DOMAIN } from '@/repositories/vrchatAuthRepository.js';
import {
    deleteSavedAuthSnapshot,
    refreshSavedAuthSnapshot,
    setSavedAuthCustomEndpointEnabled
} from '@/services/authSnapshotService.js';
import {
    executeManualLogin,
    executeSavedCredentialLogin
} from '@/services/authExecutionService.js';
import { executeReactAutoLogin } from '@/services/authAutoLoginService.js';
import { setAppLanguagePreference } from '@/services/preferencesService.js';
import { useSessionStore } from '@/state/sessionStore.js';
import { useShellStore } from '@/state/shellStore.js';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle
} from '@/ui/shadcn/alert-dialog.jsx';
import { Badge } from '@/ui/shadcn/badge.jsx';
import { Button } from '@/ui/shadcn/button.jsx';
import { Checkbox } from '@/ui/shadcn/checkbox.jsx';
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle
} from '@/ui/shadcn/card.jsx';
import { Input } from '@/ui/shadcn/input.jsx';
import { Label } from '@/ui/shadcn/label.jsx';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select.jsx';
import { getLanguageName, languageCodes } from '@/localization/index.js';

function getErrorMessage(error, fallbackMessage) {
    if (error instanceof Error && error.message) {
        return error.message;
    }

    return fallbackMessage;
}

function getUserDisplayName(user) {
    return user?.displayName || user?.username || user?.id || 'account';
}

function getAutoLoginStateLabel(status) {
    switch (status) {
    case 'scheduled':
        return 'Auto-login scheduled';
    case 'running':
        return 'Auto-login running';
    case 'success':
        return 'Auto-login succeeded';
    case 'cancelled':
        return 'Auto-login skipped';
    case 'throttled':
        return 'Auto-login throttled';
    case 'expired':
        return 'Session expired';
    case 'failed':
        return 'Auto-login failed';
    default:
        return 'Auto-login idle';
    }
}

function sanitizeRedirectTarget(value) {
    if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('/login')) {
        return '/feed';
    }

    return value;
}

function getSnapshotLoginParams(nextSnapshot) {
    const lastUserId = nextSnapshot?.lastUserLoggedIn || '';
    const lastCredential = lastUserId ? nextSnapshot?.savedCredentials?.[lastUserId] : null;
    const firstCredential = Array.isArray(nextSnapshot?.savedCredentialsList)
        ? nextSnapshot.savedCredentialsList[0]
        : null;
    return lastCredential?.loginParams || firstCredential?.loginParams || {};
}

export function LoginPage() {
    const navigate = useNavigate();
    const location = useLocation();
    const { t } = useI18n();
    const locale = useShellStore((state) => state.locale);
    const sessionPhase = useSessionStore((state) => state.sessionPhase);
    const databaseReady = useSessionStore((state) => state.databaseReady);
    const [snapshot, setSnapshot] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [deleteTarget, setDeleteTarget] = useState(null);
    const [isDeleting, setIsDeleting] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isUpdatingEndpointSetting, setIsUpdatingEndpointSetting] = useState(false);
    const [activeSavedUserId, setActiveSavedUserId] = useState('');
    const [autoLoginState, setAutoLoginState] = useState({
        status: 'idle',
        remainingSeconds: 0,
        detail: '',
        userId: ''
    });
    const [loginForm, setLoginForm] = useState({
        username: '',
        password: '',
        saveCredentials: false,
        enableCustomEndpoint: false,
        endpoint: '',
        websocket: ''
    });
    const autoLoginSuppressedKeyRef = useRef('');
    const autoLoginAbortRef = useRef(null);

    const redirectQuery = new URLSearchParams(location.search).get('redirect');
    const redirectTo = sanitizeRedirectTarget(
        location.state?.redirectTo ?? redirectQuery ?? '/feed'
    );
    const isDatabaseBlocked = !databaseReady;
    const isAutoLoginActive =
        autoLoginState.status === 'scheduled' ||
        autoLoginState.status === 'running';
    const isAutoLoginStartBlocked =
        isDatabaseBlocked ||
        isSubmitting ||
        Boolean(activeSavedUserId);
    const isAuthBusy =
        isDatabaseBlocked ||
        isSubmitting ||
        Boolean(activeSavedUserId) ||
        isAutoLoginActive ||
        sessionPhase === 'authenticating' ||
        sessionPhase === 'bootstrapping';

    function applySnapshot(nextSnapshot) {
        const loginParams = getSnapshotLoginParams(nextSnapshot);
        setSnapshot(nextSnapshot);
        setLoginForm((current) => ({
            ...current,
            enableCustomEndpoint: Boolean(nextSnapshot?.enableCustomEndpoint),
            endpoint: nextSnapshot?.enableCustomEndpoint
                ? loginParams.endpoint || current.endpoint || ''
                : '',
            websocket: nextSnapshot?.enableCustomEndpoint
                ? loginParams.websocket || current.websocket || ''
                : ''
        }));
        return nextSnapshot;
    }

    function getAutoLoginSnapshotKey(nextSnapshot = snapshot) {
        const userId = nextSnapshot?.lastUserLoggedIn || '';
        const savedCredential = userId ? nextSnapshot?.savedCredentials?.[userId] : null;
        if (!userId) {
            return '';
        }

        return JSON.stringify({
            userId,
            endpoint: savedCredential?.loginParams?.endpoint || '',
            username: savedCredential?.loginParams?.username || '',
            hasCookies: Boolean(savedCredential?.cookies),
            hasSavedCredential: Boolean(savedCredential),
            autoLoginStatus: nextSnapshot.autoLoginStatus,
            autoLoginDelayEnabled: Boolean(nextSnapshot.autoLoginDelayEnabled),
            autoLoginDelaySeconds: nextSnapshot.autoLoginDelaySeconds || 0
        });
    }

    function cancelPendingAutoLogin(detail = 'Automatic login was skipped.') {
        const controller = autoLoginAbortRef.current;
        if (controller) {
            controller.abort();
            autoLoginAbortRef.current = null;
        }

        setAutoLoginState((current) => {
            if (current.status !== 'scheduled' && current.status !== 'running') {
                return current;
            }

            return {
                ...current,
                status: 'cancelled',
                remainingSeconds: 0,
                detail
            };
        });
    }

    function retryAutoLogin() {
        autoLoginSuppressedKeyRef.current = '';
        setAutoLoginState({
            status: 'idle',
            remainingSeconds: 0,
            detail: '',
            userId: ''
        });
    }

    useEffect(() => {
        let active = true;

        refreshSavedAuthSnapshot()
            .then((nextSnapshot) => {
                if (active) {
                    applySnapshot(nextSnapshot);
                }
            })
            .catch((error) => {
                toast.error(
                    error instanceof Error ? error.message : 'Failed to load saved auth snapshot.'
                );
            })
            .finally(() => {
                if (active) {
                    setIsLoading(false);
                }
            });

        return () => {
            active = false;
        };
    }, []);

    useEffect(() => {
        const shouldAttemptCookieRestore =
            Boolean(snapshot?.lastUserLoggedIn);
        const shouldAttemptSavedCredentialFallback =
            snapshot?.autoLoginStatus === 'available';

        if (
            isLoading ||
            isAutoLoginStartBlocked ||
            !databaseReady ||
            (!shouldAttemptCookieRestore && !shouldAttemptSavedCredentialFallback)
        ) {
            return undefined;
        }

        const userId = snapshot?.lastUserLoggedIn;
        const savedCredential = userId ? snapshot?.savedCredentials?.[userId] : null;
        const autoLoginDisplayName = savedCredential
            ? getUserDisplayName(savedCredential.user)
            : userId;
        const autoLoginSnapshotKey = getAutoLoginSnapshotKey(snapshot);
        if (
            !userId ||
            !autoLoginSnapshotKey ||
            autoLoginSuppressedKeyRef.current === autoLoginSnapshotKey
        ) {
            return undefined;
        }

        autoLoginSuppressedKeyRef.current = autoLoginSnapshotKey;
        const controller = new AbortController();
        autoLoginAbortRef.current = controller;
        let active = true;

        setAutoLoginState({
            status:
                snapshot.autoLoginDelayEnabled && snapshot.autoLoginDelaySeconds > 0
                    ? 'scheduled'
                    : 'running',
            remainingSeconds:
                snapshot.autoLoginDelayEnabled && snapshot.autoLoginDelaySeconds > 0
                    ? snapshot.autoLoginDelaySeconds
                    : 0,
            detail: savedCredential
                ? `Preparing automatic login for ${autoLoginDisplayName}.`
                : `Preparing automatic session restore for ${userId}.`,
            userId
        });

        executeReactAutoLogin(snapshot, {
            signal: controller.signal,
            onCountdown(remainingSeconds) {
                if (!active) {
                    return;
                }

                setAutoLoginState((current) => ({
                    ...current,
                    status: remainingSeconds > 0 ? 'scheduled' : 'running',
                    remainingSeconds,
                    detail:
                        remainingSeconds > 0
                            ? `Automatic login will start in ${remainingSeconds}s.`
                            : savedCredential
                                ? `Authenticating ${autoLoginDisplayName}.`
                                : `Restoring an existing browser session for ${autoLoginDisplayName}.`
                }));
            }
        })
            .then((result) => {
                if (!active) {
                    return;
                }

                autoLoginAbortRef.current = null;
                if (result.snapshot) {
                    applySnapshot(result.snapshot);
                }

                switch (result.status) {
                case 'success':
                    setAutoLoginState({
                        status: 'success',
                        remainingSeconds: 0,
                        detail: savedCredential
                            ? `Automatically logged in as ${autoLoginDisplayName}.`
                            : `Automatically restored the previous browser session for ${autoLoginDisplayName}.`,
                        userId
                    });
                    break;
                case 'cancelled':
                    setAutoLoginState({
                        status: 'cancelled',
                        remainingSeconds: 0,
                        detail: 'Automatic login was skipped before the auth request started.',
                        userId
                    });
                    break;
                case 'throttled':
                    setAutoLoginState({
                        status: 'throttled',
                        remainingSeconds: 0,
                        detail: 'Automatic login was disabled after repeated failures in the last hour.',
                        userId
                    });
                    break;
                case 'expired':
                    setAutoLoginState({
                        status: 'expired',
                        remainingSeconds: 0,
                        detail: 'The previous browser session expired and no saved account fallback was available.',
                        userId
                    });
                    break;
                case 'failed':
                    setAutoLoginState({
                        status: 'failed',
                        remainingSeconds: 0,
                        detail: 'Automatic login failed. Manual sign-in is still available below.',
                        userId
                    });
                    break;
                default:
                    setAutoLoginState({
                        status: 'idle',
                        remainingSeconds: 0,
                        detail: '',
                        userId: ''
                    });
                    break;
                }
            })
            .catch((error) => {
                if (!active) {
                    return;
                }

                autoLoginAbortRef.current = null;
                setAutoLoginState({
                    status: 'failed',
                    remainingSeconds: 0,
                    detail: getErrorMessage(error, 'Automatic login failed unexpectedly.'),
                    userId
                });
                toast.error(getErrorMessage(error, 'Automatic login failed unexpectedly.'));
            });

        return () => {
            active = false;
            controller.abort();
            if (autoLoginAbortRef.current === controller) {
                autoLoginAbortRef.current = null;
            }
        };
    }, [databaseReady, isAutoLoginStartBlocked, isLoading, snapshot]);

    useEffect(
        () => () => {
            autoLoginAbortRef.current?.abort();
        },
        []
    );

    useEffect(() => {
        if (sessionPhase === 'ready') {
            navigate(redirectTo, { replace: true });
        }
    }, [navigate, redirectTo, sessionPhase]);

    async function handleLanguageChange(nextLanguage) {
        try {
            await setAppLanguagePreference(nextLanguage);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to change language.');
        }
    }

    async function handleCustomEndpointToggle(checked) {
        cancelPendingAutoLogin('Automatic login was skipped because the login form changed.');
        const previousValue = Boolean(snapshot?.enableCustomEndpoint);
        const nextValue = checked === true;

        setLoginForm((current) => ({
            ...current,
            enableCustomEndpoint: nextValue,
            endpoint: nextValue ? current.endpoint : '',
            websocket: nextValue ? current.websocket : ''
        }));
        setIsUpdatingEndpointSetting(true);

        try {
            const nextSnapshot = await setSavedAuthCustomEndpointEnabled(nextValue);
            applySnapshot(nextSnapshot);
        } catch (error) {
            setLoginForm((current) => ({
                ...current,
                enableCustomEndpoint: previousValue,
                endpoint: previousValue ? current.endpoint : '',
                websocket: previousValue ? current.websocket : ''
            }));
            toast.error(getErrorMessage(error, 'Failed to update endpoint preference.'));
        } finally {
            setIsUpdatingEndpointSetting(false);
        }
    }

    async function handleDeleteSavedAccount() {
        if (!deleteTarget?.user?.id) {
            return;
        }

        setIsDeleting(true);
        try {
            const nextSnapshot = await deleteSavedAuthSnapshot(deleteTarget.user.id);
            applySnapshot(nextSnapshot);
            toast.success(t('message.auth.account_removed'));
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to remove saved account.');
        } finally {
            setIsDeleting(false);
            setDeleteTarget(null);
        }
    }

    async function handleManualLoginSubmit(event) {
        event.preventDefault();

        if (!databaseReady) {
            toast.error('Database initialization is still pending.');
            return;
        }

        cancelPendingAutoLogin('Automatic login was skipped because a manual login started.');
        setIsSubmitting(true);
        try {
            const nextSnapshot = await executeManualLogin({
                username: loginForm.username,
                password: loginForm.password,
                endpoint: loginForm.enableCustomEndpoint ? loginForm.endpoint : '',
                websocket: loginForm.enableCustomEndpoint ? loginForm.websocket : '',
                saveCredentials: loginForm.saveCredentials
            });
            applySnapshot(nextSnapshot);
            toast.success('Authenticated and prepared the session.');
        } catch (error) {
            if (error?.authSnapshot) {
                applySnapshot(error.authSnapshot);
            }
            toast.error(getErrorMessage(error, 'Failed to authenticate.'));
        } finally {
            setIsSubmitting(false);
        }
    }

    async function handleSavedCredentialLogin(entry) {
        const userId = entry?.user?.id;
        if (!userId) {
            return;
        }

        if (!databaseReady) {
            toast.error('Database initialization is still pending.');
            return;
        }

        cancelPendingAutoLogin('Automatic login was skipped because another saved account was selected.');
        setActiveSavedUserId(userId);
        try {
            const nextSnapshot = await executeSavedCredentialLogin(entry);
            applySnapshot(nextSnapshot);
            toast.success(
                `Authenticated and prepared the session for ${getUserDisplayName(entry.user)}.`
            );
        } catch (error) {
            if (error?.authSnapshot) {
                applySnapshot(error.authSnapshot);
            }
            toast.error(getErrorMessage(error, 'Failed to restore the saved account.'));
        } finally {
            setActiveSavedUserId('');
        }
    }

    const savedAccounts = snapshot?.savedCredentialsList || [];
    const hasSavedAccounts = !isLoading && savedAccounts.length > 0;
    const shouldShowAutoLogin =
        !isLoading &&
        (Boolean(snapshot?.lastUserLoggedIn) ||
            snapshot?.autoLoginStatus === 'available' ||
            autoLoginState.status !== 'idle');
    const autoLoginTarget = snapshot?.savedCredentials?.[snapshot?.lastUserLoggedIn]?.user
        ? getUserDisplayName(snapshot.savedCredentials[snapshot.lastUserLoggedIn].user)
        : snapshot?.lastUserLoggedIn || 'last session';

    return (
        <div className="relative flex min-h-screen w-full items-center justify-center p-6">
            <div className="absolute left-2 top-2 flex items-center gap-2">
                <LanguagesIcon className="size-4 text-muted-foreground" />
                <Select
                    value={locale}
                    disabled={isAuthBusy}
                    onValueChange={(value) => void handleLanguageChange(value)}>
                    <SelectTrigger className="w-[180px]">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {languageCodes.map((code) => (
                            <SelectItem key={code} value={code}>
                                {getLanguageName(code)}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            <div className="w-full max-w-4xl space-y-3">
                <div className={`grid min-h-[380px] gap-2 ${hasSavedAccounts ? 'md:grid-cols-[1fr_auto_1fr]' : ''}`}>
                    <div className="space-y-3">
                        {shouldShowAutoLogin ? (
                            <Card>
                                <CardContent className="flex flex-wrap items-center gap-3 p-3 text-sm">
                                    <Badge variant="secondary">Auto-login</Badge>
                                    <span className="font-medium">{autoLoginTarget}</span>
                                    {autoLoginState.status !== 'scheduled' && autoLoginState.status !== 'idle' ? (
                                        <span className="text-muted-foreground">{getAutoLoginStateLabel(autoLoginState.status)}</span>
                                    ) : null}
                                    {autoLoginState.remainingSeconds > 0 ? (
                                        <span className="text-muted-foreground">{autoLoginState.remainingSeconds}s</span>
                                    ) : null}
                                    {autoLoginState.status === 'scheduled' ? (
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={() =>
                                                cancelPendingAutoLogin(
                                                    'Automatic login was skipped before the countdown finished.'
                                                )
                                            }>
                                            Skip
                                        </Button>
                                    ) : null}
                                    {autoLoginState.status === 'cancelled' ||
                                    autoLoginState.status === 'failed' ||
                                    autoLoginState.status === 'expired' ? (
                                        <Button type="button" variant="outline" size="sm" onClick={retryAutoLogin}>
                                            Retry
                                        </Button>
                                    ) : null}
                                </CardContent>
                            </Card>
                        ) : null}

                        <Card>
                            <CardHeader>
                                <CardTitle className="text-center">{t('view.login.login')}</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <form className="space-y-4" onSubmit={handleManualLoginSubmit}>
                                    <div className="space-y-3">
                                        <div className="space-y-2">
                                            <Label htmlFor="react-login-username">
                                                {t('view.login.field.username')}
                                            </Label>
                                            <Input
                                                id="react-login-username"
                                                autoComplete="username"
                                                disabled={isAuthBusy}
                                                placeholder={t('view.login.field.username')}
                                                value={loginForm.username}
                                                onChange={(event) => {
                                                    cancelPendingAutoLogin(
                                                        'Automatic login was skipped because the login form changed.'
                                                    );
                                                    setLoginForm((current) => ({
                                                        ...current,
                                                        username: event.target.value
                                                    }));
                                                }}
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label htmlFor="react-login-password">
                                                {t('view.login.field.password')}
                                            </Label>
                                            <Input
                                                id="react-login-password"
                                                type="password"
                                                autoComplete="current-password"
                                                disabled={isAuthBusy}
                                                placeholder={t('view.login.field.password')}
                                                value={loginForm.password}
                                                onChange={(event) => {
                                                    cancelPendingAutoLogin(
                                                        'Automatic login was skipped because the login form changed.'
                                                    );
                                                    setLoginForm((current) => ({
                                                        ...current,
                                                        password: event.target.value
                                                    }));
                                                }}
                                            />
                                        </div>
                                    </div>

                                    <div className="flex flex-wrap items-center gap-6">
                                        <label className="flex items-center gap-2 text-sm">
                                            <Checkbox
                                                checked={loginForm.saveCredentials}
                                                disabled={isAuthBusy}
                                                onCheckedChange={(checked) => {
                                                    cancelPendingAutoLogin(
                                                        'Automatic login was skipped because the login form changed.'
                                                    );
                                                    setLoginForm((current) => ({
                                                        ...current,
                                                        saveCredentials: checked === true
                                                    }));
                                                }}
                                            />
                                            <span>{t('view.login.field.saveCredentials')}</span>
                                        </label>
                                        <label className="flex items-center gap-2 text-sm">
                                            <Checkbox
                                                checked={loginForm.enableCustomEndpoint}
                                                disabled={isUpdatingEndpointSetting || isAuthBusy}
                                                onCheckedChange={(checked) =>
                                                    void handleCustomEndpointToggle(checked)
                                                }
                                            />
                                            <span>{t('view.login.field.devEndpoint')}</span>
                                        </label>
                                    </div>

                                    {loginForm.enableCustomEndpoint ? (
                                        <div className="grid gap-4 md:grid-cols-2">
                                            <div className="space-y-2">
                                                <Label htmlFor="react-login-endpoint">
                                                    {t('view.login.field.endpoint')}
                                                </Label>
                                                <Input
                                                    id="react-login-endpoint"
                                                    disabled={isAuthBusy}
                                                    placeholder={DEFAULT_ENDPOINT_DOMAIN}
                                                    value={loginForm.endpoint}
                                                    onChange={(event) => {
                                                        cancelPendingAutoLogin(
                                                            'Automatic login was skipped because the login form changed.'
                                                        );
                                                        setLoginForm((current) => ({
                                                            ...current,
                                                            endpoint: event.target.value
                                                        }));
                                                    }}
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <Label htmlFor="react-login-websocket">
                                                    {t('view.login.field.websocket')}
                                                </Label>
                                                <Input
                                                    id="react-login-websocket"
                                                    disabled={isAuthBusy}
                                                    placeholder={DEFAULT_WEBSOCKET_DOMAIN}
                                                    value={loginForm.websocket}
                                                    onChange={(event) => {
                                                        cancelPendingAutoLogin(
                                                            'Automatic login was skipped because the login form changed.'
                                                        );
                                                        setLoginForm((current) => ({
                                                            ...current,
                                                            websocket: event.target.value
                                                        }));
                                                    }}
                                                />
                                            </div>
                                        </div>
                                    ) : null}

                                    <Button type="submit" size="lg" className="w-full" disabled={isAuthBusy}>
                                            {isSubmitting ? (
                                                <>
                                                    <LoaderCircleIcon className="size-4 animate-spin" />
                                                    Authenticating...
                                                </>
                                            ) : (
                                                t('view.login.login')
                                            )}
                                    </Button>
                                </form>
                                <Button
                                    type="button"
                                    variant="secondary"
                                    size="lg"
                                    className="w-full"
                                    onClick={() => void openExternalLink('https://vrchat.com/register')}>
                                    {t('view.login.register')}
                                </Button>
                            </CardContent>
                        </Card>

                        <div className="space-y-1 text-center text-xs text-muted-foreground">
                            <p>
                                <button
                                    type="button"
                                    className="cursor-pointer underline-offset-4 hover:underline"
                                    onClick={() => void openExternalLink('https://vrchat.com/home/password')}>
                                    {t('view.login.forgotPassword')}
                                </button>
                            </p>
                            <p>{t('view.settings.general.legal_notice.info')}</p>
                            <p>{t('view.settings.general.legal_notice.disclaimer1')}</p>
                            <p>{t('view.settings.general.legal_notice.disclaimer2')}</p>
                        </div>

                    </div>

                    {hasSavedAccounts ? (
                        <>
                            <div className="hidden w-px bg-border md:block" />
                            <Card className="flex min-h-0 flex-col">
                                <CardHeader>
                                    <CardTitle className="text-center">{t('view.login.savedAccounts')}</CardTitle>
                                </CardHeader>
                                <CardContent className="min-h-0 flex-1 overflow-y-auto">
                                    <div className="space-y-2">
                                        {savedAccounts.map((entry) => {
                                            const hasStoredCredentials = Boolean(
                                                entry.loginParams?.username && entry.loginParams?.password
                                            );
                                            const isRelogging = activeSavedUserId === entry.user.id;
                                            const avatarUrl = userImage(entry.user, true, '64');

                                            return (
                                                <div
                                                    key={entry.user.id}
                                                    role="button"
                                                    tabIndex={0}
                                                    className="flex cursor-pointer items-center gap-3 rounded-md p-2 hover:bg-muted"
                                                    onClick={() => {
                                                        if (hasStoredCredentials && !isAuthBusy) {
                                                            void handleSavedCredentialLogin(entry);
                                                        }
                                                    }}
                                                    onKeyDown={(event) => {
                                                        if (event.key === 'Enter' || event.key === ' ') {
                                                            event.preventDefault();
                                                            if (hasStoredCredentials && !isAuthBusy) {
                                                                void handleSavedCredentialLogin(entry);
                                                            }
                                                        }
                                                    }}>
                                                    <div className="flex size-10 shrink-0 items-center justify-center rounded-full border bg-background">
                                                        {avatarUrl ? (
                                                            <img src={avatarUrl} alt="" className="size-full rounded-full object-cover" />
                                                        ) : (
                                                            <UserIcon className="size-5 text-muted-foreground" />
                                                        )}
                                                    </div>
                                                    <div className="min-w-0 flex-1">
                                                        <div className="truncate text-sm font-medium">
                                                            {getUserDisplayName(entry.user)}
                                                        </div>
                                                        <div className="truncate text-xs text-muted-foreground">
                                                            {entry.user.username || entry.user.id}
                                                        </div>
                                                        {entry.loginParams.endpoint ? (
                                                            <div className="truncate text-xs text-muted-foreground">
                                                                {entry.loginParams.endpoint}
                                                            </div>
                                                        ) : null}
                                                    </div>
                                                    {isRelogging ? (
                                                        <LoaderCircleIcon className="size-4 shrink-0 animate-spin text-muted-foreground" />
                                                    ) : null}
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="icon"
                                                        disabled={isDeleting || isAuthBusy}
                                                        onClick={(event) => {
                                                            event.stopPropagation();
                                                            cancelPendingAutoLogin(
                                                                'Automatic login was skipped because a saved account is being edited.'
                                                            );
                                                            setDeleteTarget(entry);
                                                        }}>
                                                        <Trash2Icon className="size-4" />
                                                    </Button>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </CardContent>
                            </Card>
                        </>
                    ) : null}
                </div>
            </div>

            <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Remove saved account</AlertDialogTitle>
                        <AlertDialogDescription>
                            {deleteTarget?.user?.displayName || deleteTarget?.user?.username || deleteTarget?.user?.id}
                            {' '}will be removed.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
                        <AlertDialogAction disabled={isDeleting} onClick={() => void handleDeleteSavedAccount()}>
                            {isDeleting ? 'Removing...' : 'Remove'}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
