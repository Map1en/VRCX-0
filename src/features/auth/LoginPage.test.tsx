// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    controller: vi.fn(),
    cancelAutoLogin: vi.fn(),
    restore: vi.fn()
}));

vi.mock('./useLoginPageController', () => ({
    useLoginPageController: mocks.controller
}));

vi.mock('./components/LoginPageHeader', () => ({
    LoginPageHeader: () => <div>language</div>
}));

vi.mock('./components/LoginServerStatusAlert', () => ({
    LoginServerStatusAlert: () => null
}));

vi.mock('./components/SavedAccountsCard', () => ({
    SavedAccountsCard: ({
        onUseOtherAccount
    }: {
        onUseOtherAccount: () => void;
    }) => <button onClick={() => onUseOtherAccount()}>use-other-account</button>
}));

vi.mock('./components/LoginFormCard', () => ({
    LoginFormCard: ({
        onBackToSavedAccounts,
        showBackToSavedAccounts
    }: {
        onBackToSavedAccounts: () => void;
        showBackToSavedAccounts: boolean;
    }) => (
        <div>
            <span>manual-login</span>
            {showBackToSavedAccounts ? (
                <button onClick={onBackToSavedAccounts}>
                    back-to-accounts
                </button>
            ) : null}
        </div>
    )
}));

vi.mock('./components/LoginPageUtilities', () => ({
    LoginPageUtilities: ({
        onRestoreProfileBackup,
        storageSettings
    }: {
        onRestoreProfileBackup: () => void;
        storageSettings: ReactNode;
    }) => (
        <div>
            <button onClick={onRestoreProfileBackup}>restore-backup</button>
            {storageSettings}
        </div>
    )
}));

vi.mock('./components/LoginStorageSettings', () => ({
    LoginStorageSettings: ({
        onBackendConnected,
        onBeforeOpen,
        variant
    }: {
        onBackendConnected?: () => void;
        onBeforeOpen?: () => void;
        variant?: string;
    }) => (
        <div>
            <span>storage-settings-{variant || 'button'}</span>
            {onBackendConnected ? (
                <button onClick={onBackendConnected}>backend-connected</button>
            ) : null}
            {onBeforeOpen ? (
                <button onClick={onBeforeOpen}>open-storage-settings</button>
            ) : null}
        </div>
    )
}));

vi.mock('./components/LoginPageFooter', () => ({
    LoginPageFooter: () => null
}));

vi.mock('./components/LoginProxySettingsDialog', () => ({
    LoginProxySettingsDialog: () => null
}));

vi.mock('./components/DeleteSavedAccountDialog', () => ({
    DeleteSavedAccountDialog: () => null
}));

import { LoginPage } from './LoginPage';

function controllerValue(hasSavedAccounts: boolean) {
    const noop = () => undefined;
    return {
        actions: {
            openDiscord: noop,
            openForgotPassword: noop,
            openGithub: noop,
            openRegister: noop
        },
        deleteDialog: {
            deleteTarget: null,
            isDeleting: false,
            onConfirm: noop,
            onOpenChange: noop
        },
        form: {
            busy: false,
            loginErrors: {},
            loginForm: {},
            onCancelAutoLogin: mocks.cancelAutoLogin,
            onPrepareSavedAccount: noop,
            onSubmit: noop,
            setLoginErrors: noop,
            setLoginForm: noop,
            submitting: false
        },
        header: {
            locale: 'en',
            onLanguageChange: noop
        },
        proxyDialog: {
            enabled: false,
            isSaving: false,
            isTesting: false,
            onOpenChange: noop,
            onProxyEnabledChange: noop,
            onProxyInputChange: noop,
            onSave: noop,
            onSaveAndRestart: noop,
            onTest: noop,
            open: false,
            proxyInput: ''
        },
        savedAccounts: {
            accounts: hasSavedAccounts ? [{}] : [],
            activeSavedUserId: '',
            isAuthBusy: false,
            isDeleting: false,
            onCancelAutoLogin: noop,
            onDeleteStart: noop,
            onLogin: noop,
            visible: hasSavedAccounts
        },
        serverStatus: {
            indicator: '',
            onOpenStatusPage: noop,
            status: '',
            summary: ''
        },
        utilities: {
            disabled: false,
            isValidatingRestore: false,
            onMigrateLegacyVrcxData: noop,
            onOpenProxyDialog: noop,
            onRestoreProfileBackup: mocks.restore,
            showLegacyMigration: false
        }
    };
}

describe('LoginPage', () => {
    beforeEach(() => {
        mocks.controller.mockReset();
        mocks.cancelAutoLogin.mockReset();
        mocks.restore.mockReset();
    });

    afterEach(cleanup);

    it('keeps storage recovery in the original login shell before backend initialization', () => {
        const onBackendConnected = vi.fn();
        render(
            <LoginPage
                backendConnected={false}
                onBackendConnected={onBackendConnected}
            />
        );

        expect(screen.getByText('storage-settings-bootstrap')).toBeTruthy();
        expect(
            document.querySelector('[data-vrcx-0-surface="login-page"]')
        ).toBeTruthy();
        expect(mocks.controller).not.toHaveBeenCalled();
        fireEvent.click(screen.getByText('backend-connected'));
        expect(onBackendConnected).toHaveBeenCalledTimes(1);
    });

    it('defaults to saved accounts and switches to manual login on demand', () => {
        mocks.controller.mockReturnValue(controllerValue(true));
        render(<LoginPage backendConnected onBackendConnected={() => {}} />);

        expect(screen.queryByText('manual-login')).toBeNull();
        fireEvent.click(screen.getByText('use-other-account'));
        expect(screen.getByText('manual-login')).toBeTruthy();

        fireEvent.click(screen.getByText('back-to-accounts'));
        expect(screen.queryByText('manual-login')).toBeNull();
    });

    it('shows manual login immediately without saved accounts', () => {
        mocks.controller.mockReturnValue(controllerValue(false));
        render(<LoginPage backendConnected onBackendConnected={() => {}} />);

        expect(screen.getByText('manual-login')).toBeTruthy();
        expect(screen.queryByText('back-to-accounts')).toBeNull();
    });

    it('keeps restore available as a direct utility action', () => {
        mocks.controller.mockReturnValue(controllerValue(true));
        render(<LoginPage backendConnected onBackendConnected={() => {}} />);

        fireEvent.click(screen.getByText('restore-backup'));
        expect(mocks.restore).toHaveBeenCalledTimes(1);
    });

    it('cancels pending saved-account auto-login before opening storage settings', () => {
        mocks.controller.mockReturnValue(controllerValue(true));
        render(<LoginPage backendConnected onBackendConnected={() => {}} />);

        fireEvent.click(screen.getByText('open-storage-settings'));

        expect(mocks.cancelAutoLogin).toHaveBeenCalledTimes(1);
    });
});
