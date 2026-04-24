import { useEffect } from 'react';

import {
    startI18nLanguageSync,
    startAuthenticatedRuntimeServices,
    startReactRuntimeServices,
    startThemeModeSync
} from '@/services/runtimeBootstrapService.js';

export function AppBootstrap() {
    useEffect(() => startReactRuntimeServices(), []);
    useEffect(() => startI18nLanguageSync(), []);
    useEffect(() => startThemeModeSync(), []);
    useEffect(() => startAuthenticatedRuntimeServices(), []);

    return null;
}
