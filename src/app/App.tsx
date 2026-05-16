// @ts-nocheck
import { AppBootstrap } from './bootstrap/AppBootstrap';
import { AppProviders } from './providers/AppProviders';
import { AppRouter } from './router';

export function App() {
    return (
        <AppProviders>
            <AppBootstrap />
            <AppRouter />
        </AppProviders>
    );
}
