import { createElement, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '@/styles/globals.css';
import { installDevPerformanceTimelineGuard } from '@/app/devPerformanceTimelineGuard';
import { installErrorLogging } from '@/services/errorLogService';
import { applyThemeModeLocally } from '@/services/themeService';

// only use in dev to prevent OOM from React dev tools User Timing measures
installDevPerformanceTimelineGuard();
installErrorLogging();
applyThemeModeLocally('system');

async function bootstrap() {
    const [, { App }] = await Promise.all([
        import('@/services/i18nService'),
        import('./app/App')
    ]);

    const rootElement = document.getElementById('root');

    if (!rootElement) {
        throw new Error('Missing #root mount node');
    }

    createRoot(rootElement).render(
        createElement(StrictMode, null, createElement(App))
    );
}

bootstrap().catch((error: unknown) => {
    console.error(error);
});
