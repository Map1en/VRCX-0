import type { FormEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import type {
    SavedAuthSnapshot,
    SavedCredentialRecord
} from '@/repositories/authRepository';
import {
    executeManualLogin,
    executeSavedCredentialLogin
} from '@/services/authExecutionService';
import {
    deleteSavedAuthSnapshot,
    refreshSavedAuthSnapshot
} from '@/services/authSnapshotService';
import { openExternalLink } from '@/services/entityMediaService';
import { promptLegacyVrcxForceMigration } from '@/services/legacyVrcxMigrationService';
import {
    loadPreferenceSnapshot,
    setAppLanguagePreference
} from '@/services/preferencesService';
import {
    proxySettingsErrorMessage,
    saveProxySettingsPreferences,
    testProxySettings as testProxySettingsConnectivity
} from '@/services/proxySettingsService';
import { useModalStore } from '@/state/modalStore';
import { usePreferencesStore } from '@/state/preferencesStore';
import { useSessionStore } from '@/state/sessionStore';
import { useShellStore } from '@/state/shellStore';

import {
    getLoginErrorMessage as getErrorMessage,
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

    useEffect(() => {
        setProxyEnabledInput(proxyEnabled);
        setProxyInput(proxyServer || '');
    }, [proxyEnabled, proxyServer]);

    function applySnapshot(nextSnapshot: any) {
        setSnapshot(nextSnapshot);
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
            .then((nextSnapshot: any) => {
                if (active) {
                    applySnapshot(nextSnapshot);
                }
            })
            .catch((error: unknown) => {
                toast.error(
                    error instanceof Error
                        ? error.message
                        : t(
                              'view.auth.toast.failed_to_load_saved_auth_snapshot'
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

    async function handleLanguageChange(nextLanguage: any) {
        try {
            await setAppLanguagePreference(nextLanguage);
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('view.auth.toast.failed_to_change_language')
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
                        : t('view.auth.toast.failed_to_load_proxy_settings')
                );
            }
        }
        setProxyEnabledInput(usePreferencesStore.getState().proxyEnabled);
        setProxyInput(usePreferencesStore.getState().proxyServer || '');
        setIsProxyDialogOpen(true);
    }

    async function migrateLegacyVrcxData() {
        await promptLegacyVrcxForceMigration({ confirm, t, toast });
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
                toast.success(
                    t('prompt.proxy_settings.saved_restart_required')
                );
                setIsProxyDialogOpen(false);
            }
        } catch (error) {
            toast.error(
                proxySettingsErrorMessage(error) ||
                    t('view.auth.toast.failed_to_save_proxy_settings')
            );
        } finally {
            isSavingProxySettingsRef.current = false;
            setIsSavingProxySettings(false);
        }
    }

    async function testProxySettings() {
        setIsTestingProxySettings(true);
        try {
            const result = await testProxySettingsConnectivity(proxyInput);
            toast.success(
                t('prompt.proxy_settings.test_success', {
                    status: result.status
                })
            );
        } catch (error) {
            toast.error(
                t('prompt.proxy_settings.test_failed', {
                    message: proxySettingsErrorMessage(error)
                })
            );
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
            applySnapshot(nextSnapshot);
            toast.success(t('message.auth.account_removed'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('view.auth.toast.failed_to_remove_saved_account')
            );
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
            toast.error(
                t('common.status.database_initialization_is_still_pending')
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
                saveCredentials: loginForm.saveCredentials
            });
            applySnapshot(nextSnapshot);
            toast.success(
                t('common.label.authenticated_and_prepared_the_session')
            );
        } catch (error) {
            const snapshot = (error as { authSnapshot?: unknown })
                ?.authSnapshot;
            if (snapshot) {
                applySnapshot(snapshot);
            }
            toast.error(
                getErrorMessage(
                    error,
                    t('view.auth.toast.failed_to_authenticate')
                )
            );
        } finally {
            setIsSubmitting(false);
        }
    }

    async function handleSavedCredentialLogin(entry: any) {
        const userId = entry?.user?.id;
        if (!userId) {
            return;
        }

        if (!databaseReady) {
            toast.error(
                t('common.status.database_initialization_is_still_pending')
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
                    'view.auth.dynamic.authenticated_and_prepared_the_session_for_value',
                    { value: getUserDisplayName(entry.user) }
                )
            );
        } catch (error) {
            const snapshot = (error as { authSnapshot?: unknown })
                ?.authSnapshot;
            if (snapshot) {
                applySnapshot(snapshot);
            }
            toast.error(
                getErrorMessage(
                    error,
                    t('view.auth.toast.failed_to_restore_the_saved_account')
                )
            );
        } finally {
            setActiveSavedUserId('');
        }
    }

    const savedAccounts = Array.isArray(snapshot?.savedCredentialsList)
        ? snapshot.savedCredentialsList
        : [];
    const hasSavedAccounts = !isLoading && savedAccounts.length > 0;
    const showLegacyMigrationAction = shouldShowLegacyMigrationAction(
        isLoading,
        savedAccounts
    );

    function cancelAutoLoginCountdownFinished() {
        cancelPendingAutoLogin(
            t('view.auth.auto_login.skipped_countdown_finished')
        );
    }

    return {
        activeSavedUserId,
        autoLoginAlertVariant,
        autoLoginState,
        autoLoginTarget,
        cancelAutoLoginCountdownFinished,
        cancelPendingAutoLogin,
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
        locale,
        loginErrors,
        loginForm,
        migrateLegacyVrcxData,
        openExternalLink,
        openProxyDialog,
        proxyEnabledInput,
        proxyInput,
        retryAutoLogin,
        saveProxySettings,
        savedAccounts,
        setDeleteTarget,
        setIsProxyDialogOpen,
        setLoginErrors,
        setLoginForm,
        setProxyEnabledInput,
        setProxyInput,
        testProxySettings,
        shouldShowAutoLogin,
        showLegacyMigrationAction
    };
}
