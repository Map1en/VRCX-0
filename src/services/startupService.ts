import { normalizeLanguageCode } from '@/localization/locales';
import { commands } from '@/platform/tauri/bindings';
import configRepository from '@/repositories/configRepository';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useSessionStore } from '@/state/sessionStore';
import { useShellStore } from '@/state/shellStore';

import { refreshSavedAuthSnapshot } from './authSnapshotService';
import { initializeBackgroundImage } from './background-image/backgroundImageService';
import { runStartupMaintenance } from './backgroundMaintenanceService';
import { initializeCommunityThemes } from './communityThemeService';
import { initializeDatabaseUpgradeFlow } from './databaseUpgradeService';
import { initializeHostCapabilities } from './hostCapabilityService';
import { loadPreferenceSnapshot } from './preferencesService';
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

async function runNonCriticalStartupSync(
    label: string,
    task: Promise<unknown> | unknown
) {
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
            savedAppLanguage,
            themeMode,
            zoomLevel,
            themeColor,
            fontFamily,
            customFontFamily,
            cjkFontPack
        ] = await Promise.all([
            configRepository.getRawValue('appLanguage'),
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

        const trimmedSavedAppLanguage = String(savedAppLanguage ?? '').trim();
        const localeSource = trimmedSavedAppLanguage
            ? trimmedSavedAppLanguage
            : await commands
                  .appSystemLanguage()
                  .catch(() => navigator.language || null);
        const normalizedLocale = normalizeLanguageCode(localeSource);
        shellStore.setLocale(normalizedLocale);
        if (
            trimmedSavedAppLanguage &&
            trimmedSavedAppLanguage !== normalizedLocale
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
        const databaseReady = await initializeDatabaseUpgradeFlow();
        sessionStore.setSessionState({ databaseReady });
        await loadPreferenceSnapshot();
        runtimeStore.setStartupTask(
            'config',
            'completed',
            'Config, locale, theme and zoom loaded.'
        );

        try {
            await commands.appSetUserAgent();
        } catch (error) {
            console.warn(
                'SetUserAgent is unavailable during application bootstrap:',
                error
            );
        }

        await refreshSavedAuthSnapshot();
        runStartupMaintenance().catch((error: unknown) => {
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
