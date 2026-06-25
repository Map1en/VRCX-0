import { useEffect } from 'react';

import {
    startI18nLanguageSync,
    startAuthenticatedRuntimeServices,
    startReactRuntimeServices,
    startThemeModeSync
} from '@/services/runtimeBootstrapService';
import { startTelemetryLifecycle } from '@/services/telemetry/telemetryService';

export function AppBootstrap(): null {
    useEffect(() => startReactRuntimeServices(), []);
    useEffect(() => startI18nLanguageSync(), []);
    useEffect(() => startThemeModeSync(), []);
    useEffect(() => startAuthenticatedRuntimeServices(), []);
    useEffect(() => startTelemetryLifecycle(), []);

    return null;
}
