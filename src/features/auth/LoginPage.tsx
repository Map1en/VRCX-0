import { useState } from 'react';

import { DeleteSavedAccountDialog } from './components/DeleteSavedAccountDialog';
import { LoginFormCard } from './components/LoginFormCard';
import { LoginPageFooter } from './components/LoginPageFooter';
import { LoginPageHeader } from './components/LoginPageHeader';
import { LoginPageUtilities } from './components/LoginPageUtilities';
import { LoginProxySettingsDialog } from './components/LoginProxySettingsDialog';
import { LoginServerStatusAlert } from './components/LoginServerStatusAlert';
import { SavedAccountsCard } from './components/SavedAccountsCard';
import { useLoginPageController } from './useLoginPageController';

export function LoginPage() {
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
        <div
            data-vrcx-0-surface="login-page"
            className="vrcx-0-main-shell relative flex min-h-full w-full flex-col overflow-y-auto p-6"
        >
            <div className="flex flex-1 items-center justify-center">
                <div className="flex w-full max-w-lg flex-col gap-4">
                    <LoginPageHeader
                        locale={header.locale}
                        onLanguageChange={header.onLanguageChange}
                    />
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
                        onRestoreProfileBackup={
                            utilities.onRestoreProfileBackup
                        }
                        showLegacyMigration={utilities.showLegacyMigration}
                        onMigrateLegacyVrcxData={
                            utilities.onMigrateLegacyVrcxData
                        }
                    />
                </div>
            </div>
            <LoginPageFooter
                onOpenGithub={actions.openGithub}
                onOpenDiscord={actions.openDiscord}
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
        </div>
    );
}
