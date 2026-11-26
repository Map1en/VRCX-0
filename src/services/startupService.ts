import { normalizeLanguageCode } from '@/localization/locales';
import { commands } from '@/platform/tauri/bindings';
import type { StartupBootstrapSnapshot } from '@/platform/tauri/bindings';
import configRepository from '@/repositories/configRepository';
import storageRepository from '@/repositories/storageRepository';
import {
    APP_CJK_FONT_PACK_DEFAULT_KEY,
    APP_FONT_DEFAULT_KEY
} from '@/shared/constants/fonts';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useSessionStore } from '@/state/sessionStore';
import { useShellStore } from '@/state/shellStore';

import { refreshSavedAuthSnapshot } from './authSnapshotService';
import { runStartupMaintenance } from './backgroundMaintenanceService';
import { moveLayoutPreferencesToBrowserStorage } from './browserStorageMigrationService';
import { initializeDatabaseUpgradeFlow } from './databaseUpgradeService';
import { initializeHostCapabilities } from './hostCapabilityService';
import { loadPreferenceSnapshot } from './preferencesService';
import { showSQLiteErrorDialog } from './sqliteErrorDialogService';
import { primeStartupBootstrapSystemCulture } from './startupBootstrapSnapshot';
import {
    applyAppFontPreferences,
    applyThemeColor,
    applyThemeMode,
    applyZoomLevel,
    resolveThemeColor,
    resolveThemeMode
} from './themeService';

async function runNonCriticalStartupSync(label: string, task: Promise<void>) {
    try {
        await task;
    } catch (error) {
        console.warn(`Startup ${label} sync failed:`, error);
    }
}

async function loadStartupBootstrapSnapshot(): Promise<StartupBootstrapSnapshot | null> {
    try {
        return await commands.appStartupBootstrapSnapshotGet();
    } catch (error) {
        console.warn(
            'Startup bootstrap snapshot failed, falling back to individual host requests:',
            error
        );
        return null;
    }
}

async function resolveSystemLanguage(
    bootstrapSnapshot: StartupBootstrapSnapshot | null
): Promise<string | null> {
    if (bootstrapSnapshot) {
        return bootstrapSnapshot.systemLanguage || navigator.language || null;
    }
    return commands.appSystemLanguage().catch(() => navigator.language || null);
}

export async function initializeReactRuntime() {
    const sessionStore = useSessionStore.getState();
    const shellStore = useShellStore.getState();
    const runtimeStore = useRuntimeStore.getState();

    try {
        sessionStore.setBootStatus('booting');

        const bootstrapSnapshot = await loadStartupBootstrapSnapshot();
        if (bootstrapSnapshot) {
            primeStartupBootstrapSystemCulture(bootstrapSnapshot.systemCulture);
        }

        await initializeHostCapabilities(bootstrapSnapshot?.hostCapabilities);
        runtimeStore.setStartupTask(
            'config',
            'running',
            'Loading config, locale, theme and zoom.'
        );
        await Promise.all([
            configRepository.init(bootstrapSnapshot?.configEntries),
            storageRepository.init()
        ]);
        await runNonCriticalStartupSync(
            'browser storage',
            moveLayoutPreferencesToBrowserStorage()
        );

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
        const localeSource =
            trimmedSavedAppLanguage ||
            (await resolveSystemLanguage(bootstrapSnapshot));
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
