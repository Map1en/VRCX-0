import { useEffect } from 'react';

import {
    startAuthenticatedRuntimeServices,
    startReactRuntimeServices,
    startThemeModeSync
} from '@/services/runtimeBootstrapService.js';

export function AppBootstrap() {
    useEffect(() => startReactRuntimeServices(), []);
    useEffect(() => startThemeModeSync(), []);
    useEffect(() => startAuthenticatedRuntimeServices(), []);

    return null;
}
