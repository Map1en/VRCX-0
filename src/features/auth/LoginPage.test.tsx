// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    controller: vi.fn(),
    restore: vi.fn()
}));

vi.mock('./useLoginPageController', () => ({
    useLoginPageController: mocks.controller
}));

vi.mock('./components/LoginPageHeader', () => ({
    LoginPageHeader: () => <div>language</div>
}));

vi.mock('./components/LoginServerStatusAlert', () => ({
    LoginServerStatusAlert: ({ indicator }: { indicator: string }) =>
        indicator ? <div>server-status</div> : null
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
        onRestoreProfileBackup
    }: {
        onRestoreProfileBackup: () => void;
    }) => <button onClick={onRestoreProfileBackup}>restore-backup</button>
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

function controllerValue(
    hasSavedAccounts: boolean,
    serverStatusIndicator = ''
) {
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
            onCancelAutoLogin: noop,
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
            indicator: serverStatusIndicator,
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
        mocks.restore.mockReset();
    });

    afterEach(cleanup);

    it('defaults to saved accounts and switches to manual login on demand', () => {
        mocks.controller.mockReturnValue(controllerValue(true));
        render(<LoginPage />);

        expect(screen.queryByText('manual-login')).toBeNull();
        fireEvent.click(screen.getByText('use-other-account'));
        expect(screen.getByText('manual-login')).toBeTruthy();

        fireEvent.click(screen.getByText('back-to-accounts'));
        expect(screen.queryByText('manual-login')).toBeNull();
    });

    it('shows manual login immediately without saved accounts', () => {
        mocks.controller.mockReturnValue(controllerValue(false));
        render(<LoginPage />);

        expect(screen.getByText('manual-login')).toBeTruthy();
        expect(screen.queryByText('back-to-accounts')).toBeNull();
    });

    it('keeps restore available as a direct utility action', () => {
        mocks.controller.mockReturnValue(controllerValue(true));
        render(<LoginPage />);

        fireEvent.click(screen.getByText('restore-backup'));
        expect(mocks.restore).toHaveBeenCalledTimes(1);
    });

    it('surfaces an active server incident before login', () => {
        mocks.controller.mockReturnValue(controllerValue(true, 'major'));
        render(<LoginPage />);

        expect(screen.getByText('server-status')).toBeTruthy();
    });
});
