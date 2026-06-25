import { links } from '@/shared/constants/link';

import { useLoginPageState } from './useLoginPageState';

export function useLoginPageController() {
    const page = useLoginPageState();

    return {
        actions: {
            openDiscord: () => page.openExternalLink(links.discord),
            openForgotPassword: () =>
                page.openExternalLink('https://vrchat.com/home/password'),
            openGithub: () => page.openExternalLink(links.github),
            openRegister: () =>
                page.openExternalLink('https://vrchat.com/register')
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
            isSaving: page.isSavingProxySettings,
            onOpenChange: page.setIsProxyDialogOpen,
            onProxyInputChange: page.setProxyInput,
            onSubmit: page.saveProxySettings,
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
