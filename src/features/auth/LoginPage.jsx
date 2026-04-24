import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { useI18n } from '@/app/hooks/use-i18n.js';
import { openExternalLink } from '@/lib/entityMedia.js';
import { cn } from '@/lib/utils.js';
import { executeReactAutoLogin } from '@/services/authAutoLoginService.js';
import {
    executeManualLogin,
    executeSavedCredentialLogin
} from '@/services/authExecutionService.js';
import {
    deleteSavedAuthSnapshot,
    refreshSavedAuthSnapshot,
    setSavedAuthCustomEndpointEnabled
} from '@/services/authSnapshotService.js';
import {
    loadPreferenceSnapshot,
    setAppLanguagePreference,
    setProxyServerPreference
} from '@/services/preferencesService.js';
import { usePreferencesStore } from '@/state/preferencesStore.js';
import { useSessionStore } from '@/state/sessionStore.js';
import { useShellStore } from '@/state/shellStore.js';

import {
    getLoginErrorMessage as getErrorMessage,
    getLoginUserDisplayName as getUserDisplayName
} from './loginDisplay.js';
import { getSnapshotLoginParams } from './loginSession.js';
import { appI18n } from '@/services/i18nService.js';
import { DeleteSavedAccountDialog } from './components/DeleteSavedAccountDialog.jsx';
import { LoginAutoLoginAlert } from './components/LoginAutoLoginAlert.jsx';
import { LoginFormCard } from './components/LoginFormCard.jsx';
import { LoginPageFooter } from './components/LoginPageFooter.jsx';
import { LoginPageHeader } from './components/LoginPageHeader.jsx';
import { LoginProxySettingsDialog } from './components/LoginProxySettingsDialog.jsx';
import { SavedAccountsCard } from './components/SavedAccountsCard.jsx';

export function LoginPage() {
    const navigate = useNavigate();
    const { t } = useI18n();
    const locale = useShellStore((state) => state.locale);
    const proxyServer = usePreferencesStore((state) => state.proxyServer);
    const preferencesHydrated = usePreferencesStore(
        (state) => state.preferencesHydrated
    );
    const sessionPhase = useSessionStore((state) => state.sessionPhase);
    const databaseReady = useSessionStore((state) => state.databaseReady);
    const [snapshot, setSnapshot] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [deleteTarget, setDeleteTarget] = useState(null);
    const [isDeleting, setIsDeleting] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isProxyDialogOpen, setIsProxyDialogOpen] = useState(false);
    const [proxyInput, setProxyInput] = useState('');
    const [isSavingProxySettings, setIsSavingProxySettings] = useState(false);
    const [isUpdatingEndpointSetting, setIsUpdatingEndpointSetting] =
        useState(false);
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
    const [loginErrors, setLoginErrors] = useState({
        username: '',
        password: ''
    });
    const autoLoginSuppressedKeyRef = useRef('');
    const autoLoginAbortRef = useRef(null);

    useEffect(() => {
        setProxyInput(proxyServer || '');
    }, [proxyServer]);

    const isDatabaseBlocked = !databaseReady;
    const isAutoLoginActive =
        autoLoginState.status === 'scheduled' ||
        autoLoginState.status === 'running';
    const isAutoLoginStartBlocked =
        isDatabaseBlocked || isSubmitting || Boolean(activeSavedUserId);
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
        const savedCredential = userId
            ? nextSnapshot?.savedCredentials?.[userId]
            : null;
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

    function cancelPendingAutoLogin(
        detail = t('view.auth.auto_login.skipped')
    ) {
        const controller = autoLoginAbortRef.current;
        if (controller) {
            controller.abort();
            autoLoginAbortRef.current = null;
        }

        setAutoLoginState((current) => {
            if (
                current.status !== 'scheduled' &&
                current.status !== 'running'
            ) {
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
                    error instanceof Error
                        ? error.message
                        : appI18n.t('view.auth.generated_toast.failed_to_load_saved_auth_snapshot')
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
        const shouldAttemptCookieRestore = Boolean(snapshot?.lastUserLoggedIn);
        const shouldAttemptSavedCredentialFallback =
            snapshot?.autoLoginStatus === 'available';

        if (
            isLoading ||
            isAutoLoginStartBlocked ||
            !databaseReady ||
            (!shouldAttemptCookieRestore &&
                !shouldAttemptSavedCredentialFallback)
        ) {
            return undefined;
        }

        const userId = snapshot?.lastUserLoggedIn;
        const savedCredential = userId
            ? snapshot?.savedCredentials?.[userId]
            : null;
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
                snapshot.autoLoginDelayEnabled &&
                snapshot.autoLoginDelaySeconds > 0
                    ? 'scheduled'
                    : 'running',
            remainingSeconds:
                snapshot.autoLoginDelayEnabled &&
                snapshot.autoLoginDelaySeconds > 0
                    ? snapshot.autoLoginDelaySeconds
                    : 0,
            detail: savedCredential
                ? t('view.auth.auto_login.preparing_login_for', {
                      name: autoLoginDisplayName
                  })
                : t('view.auth.auto_login.preparing_restore_for', {
                      userId
                  }),
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
                            ? t('view.auth.auto_login.starts_in', {
                                  seconds: remainingSeconds
                              })
                            : savedCredential
                              ? t('view.auth.auto_login.authenticating', {
                                    name: autoLoginDisplayName
                                })
                              : t('view.auth.auto_login.restoring_session_for', {
                                    name: autoLoginDisplayName
                                })
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
                                ? t('view.auth.auto_login.logged_in_as', {
                                      name: autoLoginDisplayName
                                  })
                                : t('view.auth.auto_login.restored_session_for', {
                                      name: autoLoginDisplayName
                                  }),
                            userId
                        });
                        break;
                    case 'cancelled':
                        setAutoLoginState({
                            status: 'cancelled',
                            remainingSeconds: 0,
                            detail: t(
                                'view.auth.auto_login.skipped_before_request'
                            ),
                            userId
                        });
                        break;
                    case 'throttled':
                        setAutoLoginState({
                            status: 'throttled',
                            remainingSeconds: 0,
                            detail: t('view.auth.auto_login.throttled'),
                            userId
                        });
                        break;
                    case 'expired':
                        setAutoLoginState({
                            status: 'expired',
                            remainingSeconds: 0,
                            detail: t('view.auth.auto_login.expired'),
                            userId
                        });
                        break;
                    case 'failed':
                        setAutoLoginState({
                            status: 'failed',
                            remainingSeconds: 0,
                            detail: t('view.auth.auto_login.failed_manual'),
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
                    detail: getErrorMessage(
                        error,
                        t('view.auth.auto_login.failed_unexpectedly')
                    ),
                    userId
                });
                toast.error(
                    getErrorMessage(
                        error,
                        appI18n.t('view.auth.generated_toast.automatic_login_failed_unexpectedly')
                    )
                );
            });

        return () => {
            active = false;
            controller.abort();
            if (autoLoginAbortRef.current === controller) {
                autoLoginAbortRef.current = null;
            }
        };
    }, [databaseReady, isAutoLoginStartBlocked, isLoading, snapshot, t]);

    useEffect(
        () => () => {
            autoLoginAbortRef.current?.abort();
        },
        []
    );

    useEffect(() => {
        if (sessionPhase === 'ready') {
            navigate('/feed', { replace: true });
        }
    }, [navigate, sessionPhase]);

    async function handleLanguageChange(nextLanguage) {
        try {
            await setAppLanguagePreference(nextLanguage);
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('view.auth.generated_toast.failed_to_change_language')
            );
        }
    }

    async function openProxyDialog() {
        if (!preferencesHydrated) {
            try {
                await loadPreferenceSnapshot();
            } catch (error) {
                toast.error(
                    error instanceof Error
                        ? error.message
                        : appI18n.t('view.auth.generated_toast.failed_to_load_proxy_settings')
                );
            }
        }
        setProxyInput(usePreferencesStore.getState().proxyServer || '');
        setIsProxyDialogOpen(true);
    }

    async function saveProxySettings(event) {
        event.preventDefault();
        setIsSavingProxySettings(true);
        try {
            const nextProxyServer = proxyInput.trim();
            const currentProxyServer =
                usePreferencesStore.getState().proxyServer || '';
            if (nextProxyServer !== currentProxyServer) {
                await setProxyServerPreference(nextProxyServer);
                return;
            }
            setIsProxyDialogOpen(false);
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('view.auth.generated_toast.failed_to_save_proxy_settings')
            );
        } finally {
            setIsSavingProxySettings(false);
        }
    }

    async function handleCustomEndpointToggle(checked) {
        cancelPendingAutoLogin(
            t('view.auth.auto_login.skipped_form_changed')
        );
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
            const nextSnapshot =
                await setSavedAuthCustomEndpointEnabled(nextValue);
            applySnapshot(nextSnapshot);
        } catch (error) {
            setLoginForm((current) => ({
                ...current,
                enableCustomEndpoint: previousValue,
                endpoint: previousValue ? current.endpoint : '',
                websocket: previousValue ? current.websocket : ''
            }));
            toast.error(
                getErrorMessage(error, appI18n.t('view.auth.generated_toast.failed_to_update_endpoint_preference'))
            );
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
            const nextSnapshot = await deleteSavedAuthSnapshot(
                deleteTarget.user.id
            );
            applySnapshot(nextSnapshot);
            toast.success(t('message.auth.account_removed'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('view.auth.generated_toast.failed_to_remove_saved_account')
            );
        } finally {
            setIsDeleting(false);
            setDeleteTarget(null);
        }
    }

    function validateLoginForm() {
        const nextErrors = {
            username: loginForm.username.trim()
                ? ''
                : t('view.login.validation.username_required'),
            password: loginForm.password
                ? ''
                : t('view.login.validation.password_required')
        };

        setLoginErrors(nextErrors);
        return !nextErrors.username && !nextErrors.password;
    }

    async function handleManualLoginSubmit(event) {
        event.preventDefault();

        if (!databaseReady) {
            toast.error(t('common.generated.generated.database_initialization_is_still_pending'));
            return;
        }

        if (!validateLoginForm()) {
            return;
        }

        cancelPendingAutoLogin(
            t('view.auth.auto_login.skipped_manual_started')
        );
        setIsSubmitting(true);
        try {
            const nextSnapshot = await executeManualLogin({
                username: loginForm.username,
                password: loginForm.password,
                endpoint: loginForm.enableCustomEndpoint
                    ? loginForm.endpoint
                    : '',
                websocket: loginForm.enableCustomEndpoint
                    ? loginForm.websocket
                    : '',
                saveCredentials: loginForm.saveCredentials
            });
            applySnapshot(nextSnapshot);
            toast.success(t('common.generated.generated.authenticated_and_prepared_the_session'));
        } catch (error) {
            if (error?.authSnapshot) {
                applySnapshot(error.authSnapshot);
            }
            toast.error(getErrorMessage(error, appI18n.t('view.auth.generated_toast.failed_to_authenticate')));
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
            toast.error(t('common.generated.generated.database_initialization_is_still_pending'));
            return;
        }

        cancelPendingAutoLogin(
            t('view.auth.auto_login.skipped_saved_account_selected')
        );
        setActiveSavedUserId(userId);
        try {
            const nextSnapshot = await executeSavedCredentialLogin(entry);
            applySnapshot(nextSnapshot);
            toast.success(
                appI18n.t('view.auth.generated_dynamic.authenticated_and_prepared_the_session_for_value', { value: getUserDisplayName(entry.user) })
            );
        } catch (error) {
            if (error?.authSnapshot) {
                applySnapshot(error.authSnapshot);
            }
            toast.error(
                getErrorMessage(error, appI18n.t('view.auth.generated_toast.failed_to_restore_the_saved_account'))
            );
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
    const autoLoginTarget = snapshot?.savedCredentials?.[
        snapshot?.lastUserLoggedIn
    ]?.user
        ? getUserDisplayName(
              snapshot.savedCredentials[snapshot.lastUserLoggedIn].user
          )
        : snapshot?.lastUserLoggedIn || t('status_bar.game_last_session');
    const autoLoginAlertVariant =
        autoLoginState.status === 'failed' ||
        autoLoginState.status === 'expired'
            ? 'destructive'
            : 'default';

    return (
        <div className="bg-background relative flex min-h-full w-full flex-col overflow-y-auto p-6">
            <div className="flex flex-1 items-center justify-center">
                <div className="flex w-full max-w-4xl flex-col gap-4">
                    <LoginPageHeader
                        locale={locale}
                        disabled={isAuthBusy}
                        onLanguageChange={(value) =>
                            void handleLanguageChange(value)
                        }
                        onOpenProxyDialog={() => void openProxyDialog()}
                    />
                    <div
                        className={cn(
                            'grid min-h-95 items-stretch gap-2',
                            hasSavedAccounts && 'md:grid-cols-[1fr_auto_1fr]'
                        )}
                    >
                        <div className="flex h-full flex-col gap-3">
                            <LoginAutoLoginAlert
                                visible={shouldShowAutoLogin}
                                variant={autoLoginAlertVariant}
                                target={autoLoginTarget}
                                state={autoLoginState}
                                onCancel={() =>
                                    cancelPendingAutoLogin(
                                        t(
                                            'view.auth.auto_login.skipped_countdown_finished'
                                        )
                                    )
                                }
                                onRetry={retryAutoLogin}
                            />
                            <LoginFormCard
                                busy={isAuthBusy}
                                submitting={isSubmitting}
                                loginForm={loginForm}
                                loginErrors={loginErrors}
                                setLoginForm={setLoginForm}
                                setLoginErrors={setLoginErrors}
                                onSubmit={handleManualLoginSubmit}
                                onCancelAutoLogin={cancelPendingAutoLogin}
                                onOpenRegister={() =>
                                    void openExternalLink(
                                        'https://vrchat.com/register'
                                    )
                                }
                                onOpenForgotPassword={() =>
                                    void openExternalLink(
                                        'https://vrchat.com/home/password'
                                    )
                                }
                            />
                        </div>
                        <SavedAccountsCard
                            visible={hasSavedAccounts}
                            accounts={savedAccounts}
                            activeSavedUserId={activeSavedUserId}
                            isDeleting={isDeleting}
                            isAuthBusy={isAuthBusy}
                            onLogin={handleSavedCredentialLogin}
                            onDeleteStart={setDeleteTarget}
                            onCancelAutoLogin={cancelPendingAutoLogin}
                        />
                    </div>
                </div>
            </div>
            <LoginPageFooter
                onOpenGithub={() =>
                    void openExternalLink('https://github.com/Map1en/VRCX-0')
                }
                onOpenDiscord={() =>
                    void openExternalLink('https://discord.gg/bnEVqwSp')
                }
            />
            <LoginProxySettingsDialog
                state={{
                    open: isProxyDialogOpen,
                    setOpen: setIsProxyDialogOpen,
                    proxyInput,
                    setProxyInput
                }}
                loginForm={loginForm}
                setLoginForm={setLoginForm}
                flags={{
                    isSavingProxySettings,
                    isUpdatingEndpointSetting,
                    isAuthBusy
                }}
                onSubmit={saveProxySettings}
                onCustomEndpointToggle={handleCustomEndpointToggle}
                onCancelAutoLogin={cancelPendingAutoLogin}
            />
            <DeleteSavedAccountDialog
                deleteTarget={deleteTarget}
                isDeleting={isDeleting}
                onOpenChange={(open) => {
                    if (!open) {
                        setDeleteTarget(null);
                    }
                }}
                onConfirm={handleDeleteSavedAccount}
            />
        </div>
    );
}
