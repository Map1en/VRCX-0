import { links } from '@/shared/constants/link';

import { useLoginPageState } from './useLoginPageState';

export function useLoginPageController() {
    const page = useLoginPageState();

    return {
        actions: {
            openDiscord: () => page.openExternalLink(links.discord),
            openForgotPassword: () =>
                page.openExternalLink(links.vrchatPassword),
            openGithub: () => page.openExternalLink(links.github),
            openRegister: () => page.openExternalLink(links.vrchatRegister)
        },
        autoLogin: {
            autoLoginState: page.autoLoginState,
            onCancel: page.cancelAutoLoginCountdownFinished,
            onRetry: page.retryAutoLogin,
            target: page.autoLoginTarget,
            variant: page.autoLoginAlertVariant,
            visible: page.shouldShowAutoLogin
        },
        deleteDialog: {
            deleteTarget: page.deleteTarget,
            isDeleting: page.isDeleting,
            onConfirm: page.handleDeleteSavedAccount,
            onOpenChange: (open: any) => {
                if (!open) {
                    page.setDeleteTarget(null);
                }
            }
        },
        form: {
            busy: page.isAuthBusy,
            loginErrors: page.loginErrors,
            loginForm: page.loginForm,
            onCancelAutoLogin: page.cancelPendingAutoLogin,
            onSubmit: page.handleManualLoginSubmit,
            setLoginErrors: page.setLoginErrors,
            setLoginForm: page.setLoginForm,
            submitting: page.isSubmitting
        },
        header: {
            disabled: page.isAuthBusy,
            locale: page.locale,
            onLanguageChange: page.handleLanguageChange,
            onMigrateLegacyVrcxData: page.migrateLegacyVrcxData,
            onOpenProxyDialog: page.openProxyDialog,
            showLegacyMigration: page.showLegacyMigrationAction
        },
        layout: {
            hasSavedAccounts: page.hasSavedAccounts
        },
        proxyDialog: {
            enabled: page.proxyEnabledInput,
            isSaving: page.isSavingProxySettings,
            isTesting: page.isTestingProxySettings,
            onOpenChange: page.setIsProxyDialogOpen,
            onProxyEnabledChange: page.setProxyEnabledInput,
            onProxyInputChange: page.setProxyInput,
            onSave: () => page.saveProxySettings(false),
            onSaveAndRestart: () => page.saveProxySettings(true),
            onTest: page.testProxySettings,
            open: page.isProxyDialogOpen,
            proxyInput: page.proxyInput
        },
        savedAccounts: {
            accounts: page.savedAccounts,
            activeSavedUserId: page.activeSavedUserId,
            isAuthBusy: page.isAuthBusy,
            isDeleting: page.isDeleting,
            onCancelAutoLogin: page.cancelPendingAutoLogin,
            onDeleteStart: page.setDeleteTarget,
            onLogin: page.handleSavedCredentialLogin,
            visible: page.hasSavedAccounts
        }
    };
}
