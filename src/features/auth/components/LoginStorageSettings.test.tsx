// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    appBootstrapChooseLocal: vi.fn(),
    appBootstrapConnect: vi.fn(),
    appBootstrapRetrySaved: vi.fn(),
    appBootstrapSaveStorage: vi.fn(),
    appBootstrapStatusGet: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: mocks
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key })
}));

vi.mock('@/ui/shadcn/dialog', () => ({
    Dialog: ({ children, open }: { children: ReactNode; open: boolean }) =>
        open ? <div role="dialog">{children}</div> : null,
    DialogContent: ({ children }: { children: ReactNode }) => (
        <div>{children}</div>
    ),
    DialogDescription: ({ children }: { children: ReactNode }) => (
        <p>{children}</p>
    ),
    DialogFooter: ({ children }: { children: ReactNode }) => (
        <div>{children}</div>
    ),
    DialogHeader: ({ children }: { children: ReactNode }) => (
        <div>{children}</div>
    ),
    DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>
}));

import { LoginStorageSettings } from './LoginStorageSettings';

const disconnectedRemote = {
    connected: false,
    hasSavedChoice: true,
    isRemote: true,
    serverUrl: 'https://vrcx.example.com',
    connecting: false,
    error: null
};

const connectedLocal = {
    ...disconnectedRemote,
    connected: true,
    isRemote: false,
    serverUrl: null
};

describe('LoginStorageSettings', () => {
    afterEach(() => {
        cleanup();
        vi.useRealTimers();
        vi.resetAllMocks();
    });

    it('keeps recovery optional and does not drop the open dialog when local initialization completes', async () => {
        vi.useFakeTimers();
        mocks.appBootstrapStatusGet
            .mockResolvedValueOnce(disconnectedRemote)
            .mockResolvedValue(connectedLocal);
        mocks.appBootstrapSaveStorage.mockResolvedValue(null);
        const onBackendConnected = vi.fn();
        render(
            <LoginStorageSettings
                backendConnected={false}
                onBackendConnected={onBackendConnected}
                variant="bootstrap"
            />
        );

        expect(screen.queryByRole('dialog')).toBeNull();
        fireEvent.click(screen.getByText('view.login.storage.configure'));
        expect(screen.getByRole('dialog')).toBeTruthy();

        await vi.advanceTimersByTimeAsync(1500);
        expect(onBackendConnected).not.toHaveBeenCalled();

        fireEvent.click(screen.getByLabelText('view.login.storage.local'));
        await vi.advanceTimersByTimeAsync(1500);
        expect(
            (
                screen.getByLabelText(
                    'view.login.storage.local'
                ) as HTMLInputElement
            ).checked
        ).toBe(true);

        fireEvent.click(screen.getByText('view.login.storage.useLocal'));
        await vi.waitFor(() => {
            expect(mocks.appBootstrapSaveStorage).toHaveBeenCalledWith(
                false,
                'https://vrcx.example.com',
                ''
            );
        });
        expect(onBackendConnected).toHaveBeenCalledTimes(1);
    });

    it('allows local recovery after the initial status request fails', async () => {
        mocks.appBootstrapStatusGet.mockRejectedValue(new Error('offline'));
        mocks.appBootstrapChooseLocal.mockResolvedValue(connectedLocal);
        const onBackendConnected = vi.fn();
        render(
            <LoginStorageSettings
                backendConnected={false}
                onBackendConnected={onBackendConnected}
                variant="bootstrap"
            />
        );

        fireEvent.click(screen.getByText('view.login.storage.configure'));
        fireEvent.click(screen.getByLabelText('view.login.storage.local'));
        fireEvent.click(screen.getByText('view.login.storage.useLocal'));

        await vi.waitFor(() => {
            expect(mocks.appBootstrapChooseLocal).toHaveBeenCalledTimes(1);
        });
        expect(onBackendConnected).toHaveBeenCalledTimes(1);
    });

    it('keeps the storage dialog open and reports a save failure without transitioning', async () => {
        mocks.appBootstrapStatusGet.mockResolvedValue(disconnectedRemote);
        mocks.appBootstrapSaveStorage.mockRejectedValue(
            new Error('could not save storage')
        );
        const onBackendConnected = vi.fn();
        render(
            <LoginStorageSettings
                backendConnected
                onBackendConnected={onBackendConnected}
            />
        );

        fireEvent.click(screen.getByText('view.login.storage.option'));
        fireEvent.click(screen.getByText('view.login.storage.saveRestart'));

        expect(await screen.findByText('could not save storage')).toBeTruthy();
        expect(screen.getByRole('dialog')).toBeTruthy();
        expect(onBackendConnected).not.toHaveBeenCalled();
    });

    it('persists the requested remote mode if local startup wins the connection race', async () => {
        mocks.appBootstrapStatusGet.mockResolvedValue(disconnectedRemote);
        mocks.appBootstrapConnect.mockResolvedValue(connectedLocal);
        mocks.appBootstrapSaveStorage.mockResolvedValue(null);
        const onBackendConnected = vi.fn();
        render(
            <LoginStorageSettings
                backendConnected={false}
                onBackendConnected={onBackendConnected}
                variant="bootstrap"
            />
        );

        fireEvent.click(screen.getByText('view.login.storage.configure'));
        fireEvent.click(screen.getByLabelText('view.login.storage.remote'));
        await screen.findByLabelText('view.login.storage.accessToken');
        fireEvent.change(
            screen.getByLabelText('view.login.storage.accessToken'),
            {
                target: { value: 'server-token' }
            }
        );
        fireEvent.click(screen.getByText('view.login.storage.connect'));

        await vi.waitFor(() => {
            expect(mocks.appBootstrapConnect).toHaveBeenCalledWith(
                'https://vrcx.example.com',
                'server-token'
            );
            expect(mocks.appBootstrapSaveStorage).toHaveBeenCalledWith(
                true,
                'https://vrcx.example.com',
                'server-token'
            );
        });
        expect(onBackendConnected).toHaveBeenCalledTimes(1);
    });

    it('closes storage recovery and transitions after a successful saved-server retry', async () => {
        mocks.appBootstrapStatusGet.mockResolvedValue(disconnectedRemote);
        mocks.appBootstrapRetrySaved.mockResolvedValue({
            ...disconnectedRemote,
            connected: true
        });
        const onBackendConnected = vi.fn();
        render(
            <LoginStorageSettings
                backendConnected={false}
                onBackendConnected={onBackendConnected}
                variant="bootstrap"
            />
        );

        fireEvent.click(screen.getByText('view.login.storage.configure'));
        await screen.findByText('view.login.storage.retrySaved');
        fireEvent.click(screen.getByText('view.login.storage.retrySaved'));

        await vi.waitFor(() => {
            expect(mocks.appBootstrapRetrySaved).toHaveBeenCalledTimes(1);
            expect(onBackendConnected).toHaveBeenCalledTimes(1);
        });
        expect(screen.queryByRole('dialog')).toBeNull();
    });
});
