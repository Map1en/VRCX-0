import { backend } from '@/platform/index.js';
import { configRepository } from '@/repositories/index.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { useSessionStore } from '@/state/sessionStore.js';
import { useShellStore } from '@/state/shellStore.js';

import { refreshSavedAuthSnapshot } from './authSnapshotService.js';
import { runStartupMaintenance } from './backgroundMaintenanceService.js';
import { initializeDatabaseUpgradeFlow } from './databaseUpgradeService.js';
import { checkVRChatDebugLogging } from './gameStateService.js';
import { loadPreferenceSnapshot } from './preferencesService.js';
import { showSQLiteErrorDialog } from './sqliteErrorDialogService.js';
import {
    APP_CJK_FONT_PACK_DEFAULT_KEY,
    APP_FONT_DEFAULT_KEY,
    applyAppFontPreferences,
    applyThemeMode,
    applyZoomLevel,
    resolveThemeMode
} from './themeService.js';

async function runNonCriticalStartupSync(label, task) {
    try {
        await task;
    } catch (error) {
        console.warn(`Startup ${label} sync failed:`, error);
    }
}

export async function initializeReactRuntime() {
    const sessionStore = useSessionStore.getState();
    const shellStore = useShellStore.getState();
    const runtimeStore = useRuntimeStore.getState();

    sessionStore.setBootStatus('booting');
    runtimeStore.setStartupTask(
        'config',
        'running',
        'Loading config, locale, theme and zoom.'
    );

    try {
        await configRepository.init();

        const [
            locale,
            themeMode,
            zoomLevel,
            fontFamily,
            customFontFamily,
            cjkFontPack
        ] = await Promise.all([
            configRepository.getString('appLanguage', 'en'),
            configRepository.getString('themeMode', 'system'),
            configRepository.getString('VRCX_ZoomLevel', null),
            configRepository.getString('VRCX_fontFamily', APP_FONT_DEFAULT_KEY),
            configRepository.getString('customFontFamily', ''),
            configRepository.getString(
                'VRCX_cjkFontPack',
                APP_CJK_FONT_PACK_DEFAULT_KEY
            )
        ]);

        shellStore.setLocale(locale || 'en');
        const resolvedThemeMode = resolveThemeMode(themeMode);
        await runNonCriticalStartupSync(
            'theme',
            applyThemeMode(resolvedThemeMode)
        );
        applyAppFontPreferences({ fontFamily, customFontFamily, cjkFontPack });
        await runNonCriticalStartupSync('zoom', applyZoomLevel(zoomLevel));
        const databaseReady = await initializeDatabaseUpgradeFlow();
        sessionStore.setSessionState({ databaseReady });
        await loadPreferenceSnapshot();
        runtimeStore.setStartupTask(
            'config',
            'completed',
            'Config, locale, theme and zoom loaded.'
        );

        try {
            await backend.app.SetUserAgent();
        } catch (error) {
            console.warn(
                'SetUserAgent is unavailable during application bootstrap:',
                error
            );
        }

        await refreshSavedAuthSnapshot();
        checkVRChatDebugLogging().catch((error) => {
            console.warn('Startup VRChat debug logging check failed:', error);
        });
        runStartupMaintenance().catch((error) => {
            console.warn('Startup maintenance failed:', error);
        });
        runtimeStore.setStartupTask(
            'services',
            'pending',
            'Runtime bootstrap is ready. Authenticated session services start after login.'
        );

        sessionStore.setBootStatus('partial');
        sessionStore.setTransportStatus('idle');
    } catch (error) {
        sessionStore.setBootStatus('error');
        sessionStore.setTransportStatus('error');
        runtimeStore.setStartupTask(
            'config',
            'error',
            error instanceof Error ? error.message : String(error)
        );
        await showSQLiteErrorDialog(error);
        console.error('Failed to initialize application runtime:', error);
        throw error;
    }
}
