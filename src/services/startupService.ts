import { normalizeLanguageCode } from '@/localization/locales';
import { tauriClient } from '@/platform/tauri/client';
import configRepository from '@/repositories/configRepository';
import databaseMaintenanceRepository from '@/repositories/databaseMaintenanceRepository';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useSessionStore } from '@/state/sessionStore';
import { useShellStore } from '@/state/shellStore';

import { refreshSavedAuthSnapshot } from './authSnapshotService';
import { runStartupMaintenance } from './backgroundMaintenanceService';
import { initializeCommunityThemes } from './communityThemeService';
import { initializeDatabaseUpgradeFlow } from './databaseUpgradeService';
import { checkVRChatDebugLogging } from './gameStateService';
import {
    initializeHostCapabilities,
    isHostCapabilityAvailable
} from './hostCapabilityService';
import { loadPreferenceSnapshot } from './preferencesService';
import { initializeBackgroundImage } from './background-image/backgroundImageService';
import { showSQLiteErrorDialog } from './sqliteErrorDialogService';
import {
    APP_CJK_FONT_PACK_DEFAULT_KEY,
    APP_FONT_DEFAULT_KEY,
    applyAppFontPreferences,
    applyThemeColor,
    applyThemeMode,
    applyZoomLevel,
    resolveThemeColor,
    resolveThemeMode
} from './themeService';

async function runNonCriticalStartupSync(label: any, task: any) {
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

    try {
        sessionStore.setBootStatus('booting');
        await initializeHostCapabilities();
        runtimeStore.setStartupTask(
            'config',
            'running',
            'Loading config, locale, theme and zoom.'
        );
        await configRepository.init();

        const [
            locale,
            themeMode,
            zoomLevel,
            themeColor,
            fontFamily,
            customFontFamily,
            cjkFontPack
        ] = await Promise.all([
            configRepository.getString('appLanguage', 'en'),
            configRepository.getString('themeMode', 'system'),
            configRepository.getString('VRCX_ZoomLevel', null),
            configRepository.getString('VRCX_themeColor', 'default'),
            configRepository.getString('VRCX_fontFamily', APP_FONT_DEFAULT_KEY),
            configRepository.getString('customFontFamily', ''),
            configRepository.getString(
                'VRCX_cjkFontPack',
                APP_CJK_FONT_PACK_DEFAULT_KEY
            )
        ]);

        const normalizedLocale = normalizeLanguageCode(locale);
        shellStore.setLocale(normalizedLocale);
        if (
            String(locale || '').trim() &&
            String(locale).trim() !== normalizedLocale
        ) {
            await configRepository.setString('appLanguage', normalizedLocale);
        }
        const resolvedThemeMode = resolveThemeMode(themeMode);
        await runNonCriticalStartupSync(
            'theme',
            applyThemeMode(resolvedThemeMode)
        );
        applyThemeColor(resolveThemeColor(themeColor));
        await runNonCriticalStartupSync(
            'communityThemes',
            initializeCommunityThemes()
        );
        await runNonCriticalStartupSync(
            'backgroundImage',
            initializeBackgroundImage()
        );
        applyAppFontPreferences({
            fontFamily,
            customFontFamily,
            cjkFontPack,
            locale: normalizedLocale
        });
        await runNonCriticalStartupSync('zoom', applyZoomLevel(zoomLevel));
        await databaseMaintenanceRepository.initGlobalTables();
        const databaseReady = await initializeDatabaseUpgradeFlow();
        sessionStore.setSessionState({ databaseReady });
        await loadPreferenceSnapshot();
        runtimeStore.setStartupTask(
            'config',
            'completed',
            'Config, locale, theme and zoom loaded.'
        );

        try {
            await tauriClient.app.SetUserAgent();
        } catch (error) {
            console.warn(
                'SetUserAgent is unavailable during application bootstrap:',
                error
            );
        }

        await refreshSavedAuthSnapshot();
        if (isHostCapabilityAvailable('registryPrefs')) {
            checkVRChatDebugLogging().catch((error: any) => {
                console.warn(
                    'Startup VRChat debug logging check failed:',
                    error
                );
            });
        }
        runStartupMaintenance().catch((error: any) => {
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
