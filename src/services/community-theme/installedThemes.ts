import type {
    CommunityThemeCatalog,
    CommunityThemeInstallMetadata,
    CommunityThemeManifest,
    CommunityThemeStatsById
} from '@/features/themes/communityThemeTypes';
import {
    commands,
    type CommunityThemeConfigureInput,
    type CommunityThemeProjection
} from '@/platform/tauri/bindings';
import { useCommunityThemeStore } from '@/state/communityThemeStore';

import {
    syncCommunityThemeAccentControl,
    syncCommunityThemeAppearanceControl
} from './appearanceControl';
import {
    setCommunityThemeOverrideCssSnapshot,
    setInstalledThemeCssSnapshot,
    syncCommunityStyleLayers
} from './styleLayers';

let lastAppliedProjectionRevision = -1;

async function refreshCommunityThemeTrayMenu(): Promise<void> {
    try {
        await commands.appRefreshTrayMenu();
    } catch (error) {
        console.warn('Unable to refresh community theme tray menu:', error);
    }
}

async function applyCommunityThemeProjection(
    projection: CommunityThemeProjection
): Promise<void> {
    if (projection.revision <= lastAppliedProjectionRevision) {
        return;
    }
    lastAppliedProjectionRevision = projection.revision;
    setInstalledThemeCssSnapshot(
        projection.enabled ? projection.installedCssSnapshot : ''
    );
    setCommunityThemeOverrideCssSnapshot(
        projection.overrideCss,
        projection.overrideCssEnabled
    );
    const store = useCommunityThemeStore.getState();
    store.setCatalog(projection.catalogUrl, store.catalog);
    store.setInstalledState({
        enabled: projection.enabled,
        installedTheme: projection.installedTheme,
        installedThemes: projection.installedThemes
    });
    store.setOverrideCssLength(
        projection.overrideCssEnabled ? projection.overrideCss.length : 0
    );
    syncCommunityStyleLayers();
    await syncCommunityThemeAppearanceControl();
    await syncCommunityThemeAccentControl();
}

export function applyCommunityThemeProjectionEvent(
    projection: CommunityThemeProjection
): void {
    void applyCommunityThemeProjection(projection).catch((error: unknown) => {
        console.warn(
            'Failed to apply community theme projection event:',
            error
        );
    });
}

export async function refreshCommunityThemeProjection(): Promise<void> {
    await applyCommunityThemeProjection(
        await commands.appCommunityThemeStateGet()
    );
}

async function runCommunityThemeCommand(
    input: CommunityThemeConfigureInput
): Promise<CommunityThemeProjection> {
    const store = useCommunityThemeStore.getState();
    store.setLoading(true);
    store.setError(null);
    try {
        const projection = await commands.appCommunityThemeConfigure(input);
        await applyCommunityThemeProjection(projection);
        await refreshCommunityThemeTrayMenu();
        return projection;
    } catch (error) {
        store.setError(
            error instanceof Error
                ? error.message
                : 'Failed to update community theme.'
        );
        throw error;
    } finally {
        store.setLoading(false);
    }
}

export async function loadCatalog(): Promise<CommunityThemeCatalog> {
    const store = useCommunityThemeStore.getState();
    store.setLoading(true);
    store.setError(null);
    try {
        const catalog = await commands.appCommunityThemeCatalogGet();
        store.setCatalog(catalog.sourceUrl, catalog.themes);
        return catalog;
    } catch (error) {
        store.setError(
            error instanceof Error
                ? error.message
                : 'Failed to load community themes.'
        );
        throw error;
    } finally {
        store.setLoading(false);
    }
}

export async function loadCommunityThemeStats(): Promise<CommunityThemeStatsById> {
    return commands.appCommunityThemeStatsGet();
}

export async function reportCommunityThemeInstall(
    themeId: string
): Promise<boolean> {
    return commands.appCommunityThemeInstallReport(themeId);
}

export async function initializeCommunityThemes(): Promise<void> {
    const store = useCommunityThemeStore.getState();
    store.setError(null);
    try {
        await refreshCommunityThemeProjection();
        await refreshCommunityThemeTrayMenu();
    } catch (error) {
        store.setError(
            error instanceof Error
                ? error.message
                : 'Failed to initialize community themes.'
        );
        throw error;
    }
}

export async function installCommunityTheme(
    theme: CommunityThemeManifest
): Promise<CommunityThemeInstallMetadata> {
    const projection = await runCommunityThemeCommand({
        kind: 'install',
        themeId: theme.id
    });
    if (!projection.installedTheme) {
        throw new Error(`Community theme was not installed: ${theme.id}.`);
    }
    return projection.installedTheme;
}

export async function enableInstalledCommunityTheme(
    themeId?: string
): Promise<void> {
    await runCommunityThemeCommand({
        kind: 'enable',
        themeId: themeId ?? null
    });
}

export async function disableInstalledCommunityTheme(): Promise<void> {
    await runCommunityThemeCommand({ kind: 'disable' });
}

export async function deleteInstalledCommunityTheme(
    themeId?: string
): Promise<void> {
    await runCommunityThemeCommand({
        kind: 'delete',
        themeId: themeId ?? null
    });
}

export async function saveCommunityThemeOverrideProjection(
    cssText: string
): Promise<void> {
    await runCommunityThemeCommand({ kind: 'setOverride', cssText });
}

export async function disableCommunityThemeOverrideProjection(): Promise<void> {
    await runCommunityThemeCommand({ kind: 'disableOverride' });
}
