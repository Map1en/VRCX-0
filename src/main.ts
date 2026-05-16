// @ts-nocheck
import { createElement, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '@/styles/globals.css';
import { installDevPerformanceTimelineGuard } from '@/app/devPerformanceTimelineGuard.js';
import { installErrorLogging } from '@/services/errorLogService.js';

// only use in dev to prevent OOM from React dev tools User Timing measures
installDevPerformanceTimelineGuard();
installErrorLogging();

async function bootstrap() {
    await import('@/lib/dayjs.js');
    await import('@/services/i18nService.js');

    const { App } = await import('./app/App');

    const rootElement = document.getElementById('root');

    if (!rootElement) {
        throw new Error('Missing #root mount node');
    }

    createRoot(rootElement).render(
        createElement(StrictMode, null, createElement(App))
    );
}

void bootstrap().catch((error) => {
    console.error(error);
});
