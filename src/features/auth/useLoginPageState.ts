import type { FormEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type {
    SavedAuthSnapshot,
    SavedCredentialRecord
} from '@/repositories/authRepository';
import { getLoginErrorMessage as getErrorMessage } from '@/services/authErrorDisplayService';
import {
    cancelDeviceLogin,
    executeDeviceLogin,
    executeManualLogin,
    executeSavedCredentialLogin,
    getAuthSnapshotFromExecutionError,
    showAuthFailureToast
} from '@/services/authExecutionService';
import {
    deleteSavedAuthSnapshot,
    getCachedAuthSnapshot,
    refreshSavedAuthSnapshot
} from '@/services/authSnapshotService';
import { openExternalLink } from '@/services/entityMediaService';
import { promptLegacyVrcxForceMigration } from '@/services/legacyVrcxMigrationService';
import {
    loadPreferenceSnapshot,
    setAppLanguagePreference
} from '@/services/preferencesService';
import { selectProfileBackupToRestore } from '@/services/profileRestoreSelectionService';
import {
    proxySettingsErrorMessage,
    saveProxySettingsPreferences,
    testProxySettings as testProxySettingsConnectivity
} from '@/services/proxySettingsService';
import { toast } from '@/services/toastService';
import { useDeviceLoginStore } from '@/state/deviceLoginStore';
import { useModalStore } from '@/state/modalStore';
import { usePreferencesStore } from '@/state/preferencesStore';
import { markRestartPending } from '@/state/restartPendingStore';
import { useSessionStore } from '@/state/sessionStore';
import { useShellStore } from '@/state/shellStore';

import type { QrLoginView } from './components/QrLoginCard';
import {
    getLoginUserDisplayName as getUserDisplayName,
    shouldShowLegacyMigrationAction
} from './loginDisplay';
import { useLoginAutoLogin } from './useLoginAutoLogin';

type LoginFormState = {
    password: string;
    saveCredentials: boolean;
    username: string;
};

type LoginErrors = {
    password: string;
    username: string;
};

export function useLoginPageState() {
    const { t } = useTranslation();
    const locale = useShellStore((state) => state.locale);
    const proxyEnabled = usePreferencesStore((state) => state.proxyEnabled);
    const proxyServer = usePreferencesStore((state) => state.proxyServer);
    const alert = useModalStore((state) => state.alert);
    const confirm = useModalStore((state) => state.confirm);
    const preferencesHydrated = usePreferencesStore(
        (state) => state.preferencesHydrated
    );
    const sessionPhase = useSessionStore((state) => state.sessionPhase);
    const databaseReady = useSessionStore((state) => state.databaseReady);
    const [snapshot, setSnapshot] = useState<SavedAuthSnapshot | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [deleteTarget, setDeleteTarget] =
        useState<SavedCredentialRecord | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isProxyDialogOpen, setIsProxyDialogOpen] = useState(false);
    const [proxyEnabledInput, setProxyEnabledInput] = useState(false);
    const [proxyInput, setProxyInput] = useState('');
    const [isSavingProxySettings, setIsSavingProxySettings] = useState(false);
    const [isTestingProxySettings, setIsTestingProxySettings] = useState(false);
    const [isValidatingRestore, setIsValidatingRestore] = useState(false);
    const isSavingProxySettingsRef = useRef(false);
    const [activeSavedUserId, setActiveSavedUserId] = useState('');
    const [loginForm, setLoginForm] = useState<LoginFormState>({
        username: '',
        password: '',
        saveCredentials: true
    });
    const [loginErrors, setLoginErrors] = useState<LoginErrors>({
        username: '',
        password: ''
    });
    const [preparedAccount, setPreparedAccount] =
        useState<SavedCredentialRecord | null>(null);
    const [qrLogin, setQrLogin] = useState<QrLoginView>({ status: 'closed' });
    const pendingDeviceLogin = useDeviceLoginStore((state) => state.pending);

    useEffect(() => {
        setProxyEnabledInput(proxyEnabled);
        setProxyInput(proxyServer || '');
    }, [proxyEnabled, proxyServer]);

    const { cancelPendingAutoLogin } = useLoginAutoLogin({
        activeSavedUserId,
        applySnapshot: setSnapshot,
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
        sessionPhase === 'authenticating' ||
        sessionPhase === 'bootstrapping';

    useEffect(() => {
        let active = true;

        const cachedSnapshot = getCachedAuthSnapshot();
        if (cachedSnapshot) {
            setSnapshot(cachedSnapshot);
            setIsLoading(false);
            return;
        }

        refreshSavedAuthSnapshot()
            .then((nextSnapshot) => {
                if (active) {
                    setSnapshot(nextSnapshot);
                }
            })
            .catch((error: unknown) => {
                toast.add({
                    type: 'error',
                    title:
                        error instanceof Error
                            ? error.message
                            : t(
                                  'view.auth.toast.failed_to_load_saved_auth_snapshot'
                              )
                });
            })
            .finally(() => {
                if (active) {
                    setIsLoading(false);
                }
            });

        return () => {
            active = false;
        };
    }, [t]);

    async function handleLanguageChange(nextLanguage: string) {
        cancelPendingAutoLogin();
        try {
            await setAppLanguagePreference(nextLanguage);
        } catch (error) {
            toast.add({
                type: 'error',
                title:
                    error instanceof Error
                        ? error.message
                        : t('view.auth.toast.failed_to_change_language')
            });
        }
    }

    async function openProxyDialog() {
        cancelPendingAutoLogin();
        if (!preferencesHydrated) {
            try {
                await loadPreferenceSnapshot();
            } catch (error) {
                toast.add({
                    type: 'error',
                    title:
                        error instanceof Error
                            ? error.message
                            : t('view.auth.toast.failed_to_load_proxy_settings')
                });
            }
        }
        setProxyEnabledInput(usePreferencesStore.getState().proxyEnabled);
        setProxyInput(usePreferencesStore.getState().proxyServer || '');
        setIsProxyDialogOpen(true);
    }

    async function migrateLegacyVrcxData() {
        cancelPendingAutoLogin();
        await promptLegacyVrcxForceMigration({ alert, confirm, t, toast });
    }

    async function restoreProfileBackup() {
        if (isValidatingRestore || isAuthBusy) {
            return;
        }
        cancelPendingAutoLogin();
        setIsValidatingRestore(true);
        try {
            await selectProfileBackupToRestore();
        } finally {
            setIsValidatingRestore(false);
        }
    }

    async function saveProxySettings(restart: boolean = true) {
        if (isSavingProxySettingsRef.current) {
            return;
        }
        isSavingProxySettingsRef.current = true;
        setIsSavingProxySettings(true);
        try {
            await saveProxySettingsPreferences(
                {
                    enabled: proxyEnabledInput,
                    server: proxyInput
                },
                { restart }
            );
            if (!restart) {
                markRestartPending();
                toast.add({
                    type: 'success',
                    title: t('prompt.proxy_settings.saved_restart_required')
                });
                setIsProxyDialogOpen(false);
            }
        } catch (error) {
            toast.add({
                type: 'error',
                title:
                    proxySettingsErrorMessage(error) ||
                    t('view.auth.toast.failed_to_save_proxy_settings')
            });
        } finally {
            isSavingProxySettingsRef.current = false;
            setIsSavingProxySettings(false);
        }
    }

    async function testProxySettings() {
        setIsTestingProxySettings(true);
        try {
            const result = await testProxySettingsConnectivity(proxyInput);
            toast.add({
                type: 'success',
                title: t('prompt.proxy_settings.test_success', {
                    status: result.status
                })
            });
        } catch (error) {
            toast.add({
                type: 'error',
                title: t('prompt.proxy_settings.test_failed', {
                    message: proxySettingsErrorMessage(error)
                })
            });
        } finally {
            setIsTestingProxySettings(false);
        }
    }

    async function handleDeleteSavedAccount() {
        const deleteUserId = deleteTarget?.user?.id;
        if (!deleteUserId || typeof deleteUserId !== 'string') {
            return;
        }

        setIsDeleting(true);
        try {
            const nextSnapshot = await deleteSavedAuthSnapshot(deleteUserId);
            setSnapshot(nextSnapshot);
            toast.add({
                type: 'success',
                title: t('message.auth.account_removed')
            });
        } catch (error) {
            toast.add({
                type: 'error',
                title:
                    error instanceof Error
                        ? error.message
                        : t('view.auth.toast.failed_to_remove_saved_account')
            });
        } finally {
            setIsDeleting(false);
            setDeleteTarget(null);
        }
    }

    function validateLoginForm() {
        const nextErrors: LoginErrors = {
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

    async function handleManualLoginSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();

        if (!databaseReady) {
            toast.add({
                type: 'error',
                title: t(
                    'common.status.database_initialization_is_still_pending'
                )
            });
            return;
        }

        if (!validateLoginForm()) {
            return;
        }

        cancelPendingAutoLogin();
        setIsSubmitting(true);
        try {
            const nextSnapshot = await executeManualLogin({
                username: loginForm.username,
                password: loginForm.password,
                saveCredentials: loginForm.saveCredentials
            });
            setSnapshot(nextSnapshot);
            toast.add({
                type: 'success',
                title: t('common.label.authenticated_and_prepared_the_session')
            });
        } catch (error) {
            const failureSnapshot = getAuthSnapshotFromExecutionError(error);
            if (failureSnapshot) {
                setSnapshot(failureSnapshot);
            }
            showAuthFailureToast(
                getErrorMessage(
                    error,
                    t('view.auth.toast.failed_to_authenticate')
                )
            );
        } finally {
            setIsSubmitting(false);
        }
    }

    async function handleSavedCredentialLogin(entry: SavedCredentialRecord) {
        const userId = typeof entry.user?.id === 'string' ? entry.user.id : '';
        if (!userId) {
            return;
        }

        if (!databaseReady) {
            toast.add({
                type: 'error',
                title: t(
                    'common.status.database_initialization_is_still_pending'
                )
            });
            return;
        }

        cancelPendingAutoLogin();
        setActiveSavedUserId(userId);
        try {
            const nextSnapshot = await executeSavedCredentialLogin(entry);
            setSnapshot(nextSnapshot);
            toast.add({
                type: 'success',
                title: t(
                    'view.auth.dynamic.authenticated_and_prepared_the_session_for_value',
                    { value: getUserDisplayName(entry.user) }
                )
            });
        } catch (error) {
            const failureSnapshot = getAuthSnapshotFromExecutionError(error);
            if (failureSnapshot) {
                setSnapshot(failureSnapshot);
            }
            showAuthFailureToast(
                getErrorMessage(
                    error,
                    t('view.auth.toast.failed_to_restore_the_saved_account')
                )
            );
        } finally {
            setActiveSavedUserId('');
        }
    }

    async function startQrLogin() {
        if (!databaseReady) {
            toast.add({
                type: 'error',
                title: t(
                    'common.status.database_initialization_is_still_pending'
                )
            });
            return;
        }

        cancelPendingAutoLogin();
        setQrLogin({ status: 'starting' });
        try {
            const nextSnapshot = await executeDeviceLogin();
            setSnapshot(nextSnapshot);
            setQrLogin({ status: 'closed' });
            toast.add({
                type: 'success',
                title: t('common.label.authenticated_and_prepared_the_session')
            });
        } catch (error) {
            const failureSnapshot = getAuthSnapshotFromExecutionError(error);
            if (failureSnapshot) {
                setSnapshot(failureSnapshot);
            }
            const failure = error as { code?: string; kind?: string };
            if (failure.code === 'AUTH_LOGIN_CANCELLED') {
                return;
            }
            setQrLogin(
                failure.kind === 'deviceCodeExpired'
                    ? { status: 'expired' }
                    : {
                          status: 'failed',
                          reason: getErrorMessage(
                              error,
                              t('device_login.failed_title')
                          )
                      }
            );
        }
    }

    async function cancelQrLogin() {
        setQrLogin({ status: 'closed' });
        await cancelDeviceLogin();
    }

    function closeQrLogin() {
        setQrLogin({ status: 'closed' });
    }

    function clearPreparedAccount() {
        setPreparedAccount(null);
    }

    function prepareSavedAccountLogin(entry: SavedCredentialRecord) {
        setPreparedAccount(entry.hasLoginCredentials ? null : entry);
        const loginUsername =
            typeof entry.loginParams?.username === 'string'
                ? entry.loginParams.username
                : '';
        const profileUsername =
            typeof entry.user?.username === 'string' ? entry.user.username : '';
        const username = loginUsername || profileUsername;
        setLoginForm((current) => ({
            ...current,
            password: '',
            username: username || current.username
        }));
        setLoginErrors({ password: '', username: '' });
    }

    const savedAccounts = snapshot?.savedCredentialsList ?? [];
    const hasSavedAccounts = !isLoading && savedAccounts.length > 0;
    const showLegacyMigrationAction = shouldShowLegacyMigrationAction(
        isLoading,
        savedAccounts
    );

    return {
        activeSavedUserId,
        cancelPendingAutoLogin,
        cancelQrLogin,
        clearPreparedAccount,
        closeQrLogin,
        deleteTarget,
        handleDeleteSavedAccount,
        handleLanguageChange,
        handleManualLoginSubmit,
        handleSavedCredentialLogin,
        hasSavedAccounts,
        isAuthBusy,
        isDeleting,
        isProxyDialogOpen,
        isSavingProxySettings,
        isTestingProxySettings,
        isSubmitting,
        isValidatingRestore,
        locale,
        loginErrors,
        loginForm,
        migrateLegacyVrcxData,
        openExternalLink,
        openProxyDialog,
        pendingDeviceLogin,
        prepareSavedAccountLogin,
        preparedAccount,
        proxyEnabledInput,
        proxyInput,
        qrLogin,
        restoreProfileBackup,
        saveProxySettings,
        savedAccounts,
        setDeleteTarget,
        setIsProxyDialogOpen,
        setLoginErrors,
        setLoginForm,
        setProxyEnabledInput,
        setProxyInput,
        startQrLogin,
        testProxySettings,
        showLegacyMigrationAction
    };
}
