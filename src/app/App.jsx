import { AppBootstrap } from './bootstrap/AppBootstrap.jsx';
import { AppProviders } from './providers/AppProviders.jsx';
import { AppRouter } from './router.jsx';

export function App() {
    return (
        <AppProviders>
            <AppBootstrap />
            <AppRouter />
        </AppProviders>
    );
}
