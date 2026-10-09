// @vitest-environment jsdom

import {
    act,
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    bootstrap: vi.fn(),
    database: vi.fn(),
    authStatus: vi.fn(),
    authLogin: vi.fn(),
    t: (key: string) => key
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: mocks.t })
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appBootstrapStatusGet: mocks.bootstrap,
        appRemoteDatabaseConnectionCheck: mocks.database,
        appCollectorAuthStatusGet: mocks.authStatus,
        appCollectorAuthLogin: mocks.authLogin,
        appCollectorAuthCancel: vi.fn(),
        appCollectorAuthVerify: vi.fn()
    }
}));

vi.mock('@/lib/queryClient', () => ({
    queryClient: { invalidateQueries: vi.fn() }
}));
vi.mock('@/state/friendLogStore', () => ({
    useFriendLogStore: { getState: () => ({ bumpRevision: vi.fn() }) }
}));
vi.mock('@/state/modalStore', () => ({
    useModalStore: { getState: () => ({ otpPrompt: vi.fn() }) }
}));
vi.mock('@/services/authExecutionService', () => ({
    getLocalizedAuthPrompt: vi.fn(),
    normalizeTwoFactorMode: (mode: string) => mode
}));

import { RemoteRuntimeStatus } from './RemoteRuntimeStatus';

function remoteConnected() {
    mocks.bootstrap.mockResolvedValue({ isRemote: true });
    mocks.database.mockResolvedValue({
        isRemote: true,
        state: 'connected',
        error: null
    });
}

function auth(status: string, collectorReady = false) {
    return { status, collectorReady };
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

describe('RemoteRuntimeStatus', () => {
    beforeEach(() => {
        mocks.bootstrap.mockResolvedValue({ isRemote: true });
        mocks.database.mockResolvedValue({
            isRemote: true,
            state: 'connected',
            error: null
        });
        mocks.authStatus.mockResolvedValue(auth('needsLogin'));
        mocks.authLogin.mockReset();
    });

    afterEach(() => {
        cleanup();
        vi.useRealTimers();
        vi.resetAllMocks();
    });

    it('does not infer login is required while the initial database probe is pending', async () => {
        const probe = deferred<{
            isRemote: boolean;
            state: 'connected' | 'disconnected';
            error: null;
        }>();
        mocks.database.mockReturnValue(probe.promise);
        render(<RemoteRuntimeStatus />);

        await waitFor(() => expect(mocks.database).toHaveBeenCalledTimes(1));
        expect(mocks.authStatus).not.toHaveBeenCalled();
        expect(screen.queryByText('view.collector.authRequired')).toBeNull();
        expect(screen.queryByText('view.collector.signIn')).toBeNull();
    });

    it('shows an unavailable status with retry after an auth status transport error', async () => {
        remoteConnected();
        mocks.authStatus.mockRejectedValue(new Error('connection refused'));
        render(<RemoteRuntimeStatus />);

        expect(
            await screen.findByText('view.collector.authStatusUnavailable')
        ).toBeTruthy();
        expect(screen.queryByText('view.collector.authRequired')).toBeNull();
        expect(screen.queryByText('view.collector.signIn')).toBeNull();
        expect(
            screen.getByRole('button', { name: 'common.action.retry' })
        ).toBeTruthy();
    });

    it('ignores an auth response that arrives after the database disconnects', async () => {
        vi.useFakeTimers();
        const probe = deferred<ReturnType<typeof auth>>();
        remoteConnected();
        mocks.authStatus.mockReturnValue(probe.promise);
        mocks.database
            .mockResolvedValueOnce({
                isRemote: true,
                state: 'connected',
                error: null
            })
            .mockResolvedValueOnce({
                isRemote: true,
                state: 'disconnected',
                error: null
            });
        render(<RemoteRuntimeStatus />);
        await act(async () => Promise.resolve());
        expect(mocks.authStatus).toHaveBeenCalledTimes(1);

        await act(async () => {
            await vi.advanceTimersByTimeAsync(15_000);
        });
        expect(
            screen.getByText('view.collector.remoteDisconnected')
        ).toBeTruthy();

        await act(async () => {
            probe.resolve(auth('needsLogin'));
            await probe.promise;
        });
        expect(screen.queryByText('view.collector.authRequired')).toBeNull();
        expect(screen.queryByText('view.collector.signIn')).toBeNull();
    });

    it('recovers on reconnect and then shows an explicitly reported needsLogin status', async () => {
        mocks.bootstrap.mockResolvedValue({ isRemote: true });
        mocks.database
            .mockResolvedValueOnce({
                isRemote: true,
                state: 'disconnected',
                error: null
            })
            .mockResolvedValueOnce({
                isRemote: true,
                state: 'connected',
                error: null
            });
        mocks.authStatus.mockResolvedValue(auth('needsLogin'));
        render(<RemoteRuntimeStatus />);
        expect(
            await screen.findByText('view.collector.remoteDisconnected')
        ).toBeTruthy();

        fireEvent.click(
            screen.getByRole('button', { name: 'common.action.retry' })
        );
        expect(
            await screen.findByText('view.collector.authRequired')
        ).toBeTruthy();
        expect(
            screen.getByRole('button', { name: 'view.collector.signIn' })
        ).toBeTruthy();
    });

    it('shows a genuine needsLogin status only after the database is confirmed connected', async () => {
        remoteConnected();
        mocks.authStatus.mockResolvedValue(auth('needsLogin'));
        render(<RemoteRuntimeStatus />);

        expect(
            await screen.findByText('view.collector.authRequired')
        ).toBeTruthy();
        expect(
            screen.getByRole('button', { name: 'view.collector.signIn' })
        ).toBeTruthy();
    });

    it('does not keep a login-required notice when sign-in itself loses transport', async () => {
        remoteConnected();
        mocks.authStatus.mockResolvedValue(auth('needsLogin'));
        mocks.authLogin.mockRejectedValue(new Error('collector unreachable'));
        render(<RemoteRuntimeStatus />);

        fireEvent.click(
            await screen.findByRole('button', { name: 'view.collector.signIn' })
        );
        fireEvent.change(screen.getByLabelText('view.login.field.username'), {
            target: { value: 'user' }
        });
        fireEvent.change(screen.getByLabelText('view.login.field.password'), {
            target: { value: 'password' }
        });
        fireEvent.submit(
            screen.getByLabelText('view.login.field.password').closest('form')!
        );

        expect(
            await screen.findByText('view.collector.authStatusUnavailable')
        ).toBeTruthy();
        expect(screen.queryByText('view.collector.authRequired')).toBeNull();
        expect(screen.getByText('collector unreachable')).toBeTruthy();
    });
});
