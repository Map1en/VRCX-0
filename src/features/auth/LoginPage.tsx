import { cn } from '@/lib/utils';

import { DeleteSavedAccountDialog } from './components/DeleteSavedAccountDialog';
import { LoginAutoLoginAlert } from './components/LoginAutoLoginAlert';
import { LoginFormCard } from './components/LoginFormCard';
import { LoginPageFooter } from './components/LoginPageFooter';
import { LoginPageHeader } from './components/LoginPageHeader';
import { LoginProxySettingsDialog } from './components/LoginProxySettingsDialog';
import { SavedAccountsCard } from './components/SavedAccountsCard';
import { useLoginPageController } from './useLoginPageController';

export function LoginPage() {
    const {
        actions,
        autoLogin,
        deleteDialog,
        form,
        header,
        layout,
        proxyDialog,
        savedAccounts
    } = useLoginPageController();

    return (
        <div
            data-vrcx-0-surface="login-page"
            className="vrcx-0-main-shell relative flex min-h-full w-full flex-col overflow-y-auto p-6"
        >
            <div className="flex flex-1 items-center justify-center">
                <div className="flex w-full max-w-4xl flex-col gap-4">
                    <LoginPageHeader
                        locale={header.locale}
                        disabled={header.disabled}
                        onLanguageChange={(value: any) => {
                            header.onLanguageChange(value);
                        }}
                        onOpenProxyDialog={() => {
                            header.onOpenProxyDialog();
                        }}
                        showLegacyMigration={header.showLegacyMigration}
                        onMigrateLegacyVrcxData={() => {
                            header.onMigrateLegacyVrcxData();
                        }}
                    />
                    <div
                        className={cn(
                            'grid min-h-0 items-stretch gap-2',
                            layout.hasSavedAccounts &&
                                'md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]'
                        )}
                    >
                        <div className="flex min-h-0 flex-col gap-3">
                            <LoginAutoLoginAlert
                                visible={autoLogin.visible}
                                variant={autoLogin.variant}
                                target={autoLogin.target}
                                autoLoginState={autoLogin.autoLoginState}
                                onCancel={autoLogin.onCancel}
                                onRetry={autoLogin.onRetry}
                            />
                            <LoginFormCard
                                busy={form.busy}
                                submitting={form.submitting}
                                loginForm={form.loginForm}
                                loginErrors={form.loginErrors}
                                setLoginForm={form.setLoginForm}
                                setLoginErrors={form.setLoginErrors}
                                onSubmit={form.onSubmit}
                                onCancelAutoLogin={form.onCancelAutoLogin}
                                onOpenRegister={() => {
                                    actions.openRegister();
                                }}
                                onOpenForgotPassword={() => {
                                    actions.openForgotPassword();
                                }}
                            />
                        </div>
                        <SavedAccountsCard
                            visible={savedAccounts.visible}
                            accounts={savedAccounts.accounts}
                            activeSavedUserId={savedAccounts.activeSavedUserId}
                            isDeleting={savedAccounts.isDeleting}
                            isAuthBusy={savedAccounts.isAuthBusy}
                            onLogin={savedAccounts.onLogin}
                            onDeleteStart={savedAccounts.onDeleteStart}
                            onCancelAutoLogin={savedAccounts.onCancelAutoLogin}
                        />
                    </div>
                </div>
            </div>
            <LoginPageFooter
                onOpenGithub={() => {
                    actions.openGithub();
                }}
                onOpenDiscord={() => {
                    actions.openDiscord();
                }}
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
