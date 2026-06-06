import { createElement, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '@/styles/globals.css';
import { installDevPerformanceTimelineGuard } from '@/app/devPerformanceTimelineGuard';
import { installErrorLogging } from '@/services/errorLogService';
import { loadBundledCjkFonts } from '@/styles/cjkFonts';

// only use in dev to prevent OOM from React dev tools User Timing measures
installDevPerformanceTimelineGuard();
installErrorLogging();

async function bootstrap() {
    await Promise.all([
        loadBundledCjkFonts(),
        import('@/services/i18nService')
    ]);

    const { App } = await import('./app/App');

    const rootElement = document.getElementById('root');

    if (!rootElement) {
        throw new Error('Missing #root mount node');
    }

    createRoot(rootElement).render(
        createElement(StrictMode, null, createElement(App))
    );
}

bootstrap().catch((error: any) => {
    console.error(error);
});
