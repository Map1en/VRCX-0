import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { openExternalLink } from '@/services/entityMediaService';
import { setAppLanguagePreference } from '@/services/preferencesService';
import { links } from '@/shared/constants/link';
import { useShellStore } from '@/state/shellStore';

import { DeleteSavedAccountDialog } from './components/DeleteSavedAccountDialog';
import { LoginFormCard } from './components/LoginFormCard';
import { LoginPageFooter } from './components/LoginPageFooter';
import { LoginPageHeader } from './components/LoginPageHeader';
import { LoginPageShell } from './components/LoginPageShell';
import { LoginPageUtilities } from './components/LoginPageUtilities';
import { LoginProxySettingsDialog } from './components/LoginProxySettingsDialog';
import { LoginServerStatusAlert } from './components/LoginServerStatusAlert';
import { LoginStorageSettings } from './components/LoginStorageSettings';
import { SavedAccountsCard } from './components/SavedAccountsCard';
import { useLoginPageController } from './useLoginPageController';

export function LoginPage({
    backendConnected = true,
    onBackendConnected
}: {
    backendConnected?: boolean;
    onBackendConnected?: () => void;
}) {
    if (!backendConnected) {
        return (
            <BootstrapLoginPage
                onBackendConnected={onBackendConnected ?? (() => undefined)}
            />
        );
    }
    return <ConnectedLoginPage />;
}

function BootstrapLoginPage({
    onBackendConnected
}: {
    onBackendConnected: () => void;
}) {
    const locale = useShellStore((state) => state.locale);
    const { i18n } = useTranslation();
    return (
        <LoginPageShell
            header={
                <LoginPageHeader
                    locale={locale}
                    onLanguageChange={(value) => {
                        void i18n.changeLanguage(value);
                        void setAppLanguagePreference(value).catch(() => {
                            // The language remains selected while storage reconnects.
                        });
                    }}
                />
            }
            footer={
                <LoginPageFooter
                    onOpenGithub={() => openExternalLink(links.github)}
                    onOpenDiscord={() => openExternalLink(links.discord)}
                />
            }
        >
            <LoginStorageSettings
                backendConnected={false}
                onBackendConnected={onBackendConnected}
                variant="bootstrap"
            />
        </LoginPageShell>
    );
}

function ConnectedLoginPage() {
    const [manualLoginSelected, setManualLoginSelected] = useState(false);
    const {
        actions,
        deleteDialog,
        form,
        header,
        proxyDialog,
        savedAccounts,
        serverStatus,
        utilities
    } = useLoginPageController();
    const showSavedAccounts = savedAccounts.visible && !manualLoginSelected;

    return (
        <LoginPageShell
            header={
                <LoginPageHeader
                    locale={header.locale}
                    onLanguageChange={header.onLanguageChange}
                />
            }
            footer={
                <LoginPageFooter
                    onOpenGithub={actions.openGithub}
                    onOpenDiscord={actions.openDiscord}
                />
            }
        >
            <LoginServerStatusAlert
                indicator={serverStatus.indicator}
                status={serverStatus.status}
                summary={serverStatus.summary}
                onOpenStatusPage={serverStatus.onOpenStatusPage}
            />
            {showSavedAccounts ? (
                <SavedAccountsCard
                    accounts={savedAccounts.accounts}
                    activeSavedUserId={savedAccounts.activeSavedUserId}
                    isDeleting={savedAccounts.isDeleting}
                    isAuthBusy={savedAccounts.isAuthBusy}
                    onLogin={savedAccounts.onLogin}
                    onDeleteStart={savedAccounts.onDeleteStart}
                    onCancelAutoLogin={savedAccounts.onCancelAutoLogin}
                    onUseOtherAccount={(entry) => {
                        form.onCancelAutoLogin();
                        if (entry) {
                            form.onPrepareSavedAccount(entry);
                        }
                        setManualLoginSelected(true);
                    }}
                />
            ) : (
                <LoginFormCard
                    busy={form.busy}
                    submitting={form.submitting}
                    loginForm={form.loginForm}
                    loginErrors={form.loginErrors}
                    setLoginForm={form.setLoginForm}
                    setLoginErrors={form.setLoginErrors}
                    onSubmit={form.onSubmit}
                    onCancelAutoLogin={form.onCancelAutoLogin}
                    onBackToSavedAccounts={() => {
                        setManualLoginSelected(false);
                    }}
                    showBackToSavedAccounts={savedAccounts.visible}
                    onOpenRegister={actions.openRegister}
                    onOpenForgotPassword={actions.openForgotPassword}
                />
            )}
            <LoginPageUtilities
                disabled={utilities.disabled}
                isValidatingRestore={utilities.isValidatingRestore}
                onOpenProxyDialog={utilities.onOpenProxyDialog}
                onRestoreProfileBackup={utilities.onRestoreProfileBackup}
                showLegacyMigration={utilities.showLegacyMigration}
                onMigrateLegacyVrcxData={utilities.onMigrateLegacyVrcxData}
                storageSettings={
                    <LoginStorageSettings
                        backendConnected
                        onBeforeOpen={form.onCancelAutoLogin}
                    />
                }
            />
            <LoginProxySettingsDialog
                open={proxyDialog.open}
                enabled={proxyDialog.enabled}
                proxyInput={proxyDialog.proxyInput}
                isSaving={proxyDialog.isSaving}
                isTesting={proxyDialog.isTesting}
                onOpenChange={proxyDialog.onOpenChange}
                onProxyEnabledChange={proxyDialog.onProxyEnabledChange}
                onProxyInputChange={proxyDialog.onProxyInputChange}
                onSave={proxyDialog.onSave}
                onSaveAndRestart={proxyDialog.onSaveAndRestart}
                onTest={proxyDialog.onTest}
            />
            <DeleteSavedAccountDialog
                deleteTarget={deleteDialog.deleteTarget}
                isDeleting={deleteDialog.isDeleting}
                onOpenChange={deleteDialog.onOpenChange}
                onConfirm={deleteDialog.onConfirm}
            />
        </LoginPageShell>
    );
}
