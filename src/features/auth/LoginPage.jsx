import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { openExternalLink } from '@/lib/entityMedia.js';
import { cn } from '@/lib/utils.js';
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

import { DeleteSavedAccountDialog } from './components/DeleteSavedAccountDialog.jsx';
import { LoginAutoLoginAlert } from './components/LoginAutoLoginAlert.jsx';
import { LoginFormCard } from './components/LoginFormCard.jsx';
import { LoginPageFooter } from './components/LoginPageFooter.jsx';
import { LoginPageHeader } from './components/LoginPageHeader.jsx';
import { LoginProxySettingsDialog } from './components/LoginProxySettingsDialog.jsx';
import { SavedAccountsCard } from './components/SavedAccountsCard.jsx';
import {
    getLoginErrorMessage as getErrorMessage,
    getLoginUserDisplayName as getUserDisplayName
} from './loginDisplay.js';
import { getSnapshotLoginParams } from './loginSession.js';
import { useLoginAutoLogin } from './useLoginAutoLogin.js';

export function LoginPage() {
    const navigate = useNavigate();
    const { t } = useTranslation();
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

    useEffect(() => {
        setProxyInput(proxyServer || '');
    }, [proxyServer]);

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
    const {
        autoLoginAlertVariant,
        autoLoginState,
        autoLoginTarget,
        cancelPendingAutoLogin,
        isAutoLoginActive,
        retryAutoLogin,
        shouldShowAutoLogin
    } = useLoginAutoLogin({
        activeSavedUserId,
        applySnapshot,
        databaseReady,
        isLoading,
        isSubmitting,
        snapshot
    });
    const isDatabaseBlocked = !databaseReady;
    const isAuthBusy =
        isDatabaseBlocked ||
        isSubmitting ||
        Boolean(activeSavedUserId) ||
        isAutoLoginActive ||
        sessionPhase === 'authenticating' ||
        sessionPhase === 'bootstrapping';

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
                        : t(
                              'view.auth.generated_toast.failed_to_load_saved_auth_snapshot'
                          )
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
                    : t('view.auth.generated_toast.failed_to_change_language')
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
                        : t(
                              'view.auth.generated_toast.failed_to_load_proxy_settings'
                          )
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
                    : t(
                          'view.auth.generated_toast.failed_to_save_proxy_settings'
                      )
            );
        } finally {
            setIsSavingProxySettings(false);
        }
    }

    async function handleCustomEndpointToggle(checked) {
        cancelPendingAutoLogin(t('view.auth.auto_login.skipped_form_changed'));
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
                getErrorMessage(
                    error,
                    t(
                        'view.auth.generated_toast.failed_to_update_endpoint_preference'
                    )
                )
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
                    : t(
                          'view.auth.generated_toast.failed_to_remove_saved_account'
                      )
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
            toast.error(
                t(
                    'common.generated.generated.database_initialization_is_still_pending'
                )
            );
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
            toast.success(
                t(
                    'common.generated.generated.authenticated_and_prepared_the_session'
                )
            );
        } catch (error) {
            if (error?.authSnapshot) {
                applySnapshot(error.authSnapshot);
            }
            toast.error(
                getErrorMessage(
                    error,
                    t('view.auth.generated_toast.failed_to_authenticate')
                )
            );
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
            toast.error(
                t(
                    'common.generated.generated.database_initialization_is_still_pending'
                )
            );
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
                t(
                    'view.auth.generated_dynamic.authenticated_and_prepared_the_session_for_value',
                    { value: getUserDisplayName(entry.user) }
                )
            );
        } catch (error) {
            if (error?.authSnapshot) {
                applySnapshot(error.authSnapshot);
            }
            toast.error(
                getErrorMessage(
                    error,
                    t(
                        'view.auth.generated_toast.failed_to_restore_the_saved_account'
                    )
                )
            );
        } finally {
            setActiveSavedUserId('');
        }
    }

    const savedAccounts = snapshot?.savedCredentialsList || [];
    const hasSavedAccounts = !isLoading && savedAccounts.length > 0;

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
