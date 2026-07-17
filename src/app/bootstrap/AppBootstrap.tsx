import { useEffect } from 'react';

import {
    startI18nLanguageSync,
    startReactRuntimeServices,
    startThemeModeSync
} from '@/services/runtimeBootstrapService';

export function AppBootstrap(): null {
    useEffect(() => startReactRuntimeServices(), []);
    useEffect(() => startI18nLanguageSync(), []);
    useEffect(() => startThemeModeSync(), []);
    return null;
}
