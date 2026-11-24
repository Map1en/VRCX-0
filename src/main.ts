import { createElement, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '@/styles/globals.css';
import { installDevPerformanceTimelineGuard } from '@/app/devPerformanceTimelineGuard';
import { installErrorLogging } from '@/services/errorLogService';

// only use in dev to prevent OOM from React dev tools User Timing measures
installDevPerformanceTimelineGuard();
installErrorLogging();

async function bootstrap() {
    const [, { App }, { installLongFrameTelemetry }] = await Promise.all([
        import('@/services/i18nService'),
        import('./app/App'),
        import('@/services/telemetry/telemetryLongFrames')
    ]);
    installLongFrameTelemetry();

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
