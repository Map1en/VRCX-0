import { useShallow } from 'zustand/react/shallow';

import { links } from '@/shared/constants/link';
import { useRuntimeStore } from '@/state/runtimeStore';

import { useLoginPageState } from './useLoginPageState';

export function useLoginPageController() {
    const page = useLoginPageState();
    const serverStatus = useRuntimeStore(
        useShallow((state) => ({
            indicator: state.vrcStatus.indicator,
            status: state.vrcStatus.status,
            summary: state.vrcStatus.summary
        }))
    );

    return {
        actions: {
            openDiscord: () => page.openExternalLink(links.discord),
            openForgotPassword: () =>
                page.openExternalLink(links.vrchatPassword),
            openGithub: () => page.openExternalLink(links.github),
            openRegister: () => page.openExternalLink(links.vrchatRegister)
        },
        deleteDialog: {
            deleteTarget: page.deleteTarget,
            isDeleting: page.isDeleting,
            onConfirm: page.handleDeleteSavedAccount,
            onOpenChange: (open: boolean) => {
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
            onPrepareSavedAccount: page.prepareSavedAccountLogin,
            onSubmit: page.handleManualLoginSubmit,
            setLoginErrors: page.setLoginErrors,
            setLoginForm: page.setLoginForm,
            submitting: page.isSubmitting
        },
        header: {
            locale: page.locale,
            onLanguageChange: page.handleLanguageChange
        },
        utilities: {
            disabled: page.isAuthBusy,
            isValidatingRestore: page.isValidatingRestore,
            onMigrateLegacyVrcxData: page.migrateLegacyVrcxData,
            onOpenProxyDialog: page.openProxyDialog,
            onRestoreProfileBackup: page.restoreProfileBackup,
            showLegacyMigration: page.showLegacyMigrationAction
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
        },
        serverStatus: {
            ...serverStatus,
            onOpenStatusPage: () => page.openExternalLink(links.vrchatStatus)
        }
    };
}
