import { TriangleAlertIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { usePendingLoginAccountStore } from '@/state/pendingLoginAccountStore';
import { Alert, AlertDescription, AlertTitle } from '@/ui/shadcn/alert';

import { DeleteSavedAccountDialog } from './components/DeleteSavedAccountDialog';
import { LoginFormCard } from './components/LoginFormCard';
import { LoginPageFooter } from './components/LoginPageFooter';
import { LoginPageHeader } from './components/LoginPageHeader';
import { LoginPageUtilities } from './components/LoginPageUtilities';
import { LoginProxySettingsDialog } from './components/LoginProxySettingsDialog';
import { LoginServerStatusAlert } from './components/LoginServerStatusAlert';
import { QrLoginCard } from './components/QrLoginCard';
import { SavedAccountsCard } from './components/SavedAccountsCard';
import { getLoginUserDisplayName } from './loginDisplay';
import { useLoginPageController } from './useLoginPageController';

export function LoginPage() {
    const { t } = useTranslation();
    const [manualLoginSelected, setManualLoginSelected] = useState(false);
    const {
        actions,
        deleteDialog,
        form,
        header,
        proxyDialog,
        qrLogin,
        savedAccounts,
        serverStatus,
        utilities
    } = useLoginPageController();
    const showQrLogin =
        qrLogin.view.status !== 'closed' || qrLogin.pending !== null;
    const [preparedAccountExpired, setPreparedAccountExpired] = useState(false);
    const pendingLoginAccount = usePendingLoginAccountStore(
        (state) => state.pending
    );
    const { onCancelAutoLogin, onPrepareSavedAccount } = form;

    useEffect(() => {
        if (!pendingLoginAccount) {
            return;
        }
        usePendingLoginAccountStore.getState().take();
        onCancelAutoLogin();
        onPrepareSavedAccount(pendingLoginAccount.account);
        setPreparedAccountExpired(pendingLoginAccount.reason === 'expired');
        setManualLoginSelected(true);
    }, [pendingLoginAccount, onCancelAutoLogin, onPrepareSavedAccount]);
    const showSavedAccounts = savedAccounts.visible && !manualLoginSelected;
    const expiredAccount = preparedAccountExpired ? form.preparedAccount : null;

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
                    {expiredAccount ? (
                        <Alert>
                            <TriangleAlertIcon />
                            <AlertTitle>
                                {t('view.login.expired_account.title', {
                                    name: getLoginUserDisplayName(
                                        expiredAccount.user
                                    )
                                })}
                            </AlertTitle>
                            <AlertDescription>
                                {t('view.login.expired_account.description')}
                            </AlertDescription>
                        </Alert>
                    ) : null}
                    {showQrLogin ? (
                        <QrLoginCard
                            view={qrLogin.view}
                            pending={qrLogin.pending}
                            onCancel={() => {
                                void qrLogin.onCancel();
                            }}
                            onRetry={() => {
                                void qrLogin.onRetry();
                            }}
                            onUsePassword={() => {
                                qrLogin.onUsePassword();
                                setManualLoginSelected(true);
                            }}
                        />
                    ) : showSavedAccounts ? (
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
                                setPreparedAccountExpired(false);
                                if (entry) {
                                    form.onPrepareSavedAccount(entry);
                                } else {
                                    form.onClearPreparedAccount();
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
                                form.onClearPreparedAccount();
                                setManualLoginSelected(false);
                            }}
                            showBackToSavedAccounts={savedAccounts.visible}
                            onOpenRegister={actions.openRegister}
                            onOpenForgotPassword={actions.openForgotPassword}
                            onStartQrLogin={() => {
                                void form.onStartQrLogin();
                            }}
                            preparedAccount={
                                preparedAccountExpired
                                    ? null
                                    : form.preparedAccount
                            }
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
