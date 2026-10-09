import { useCallback, useState } from 'react';

import { LoginPage } from '@/features/auth/LoginPage';
import { DevKitPanel } from '@/features/devkit/DevKitPanel';

import { AppBootstrap } from './bootstrap/AppBootstrap';
import { AppProviders } from './providers/AppProviders';
import { AppRouter } from './router';

export function App() {
    const [connected, setConnected] = useState(false);
    const onBackendConnected = useCallback(() => setConnected(true), []);
    return (
        <AppProviders>
            {connected ? (
                <>
                    <AppBootstrap />
                    <AppRouter />
                    <DevKitPanel />
                </>
            ) : (
                <LoginPage
                    backendConnected={connected}
                    onBackendConnected={onBackendConnected}
                />
            )}
        </AppProviders>
    );
}
