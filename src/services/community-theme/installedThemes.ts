import type {
    CommunityThemeCatalog,
    CommunityThemeInstallMetadata,
    CommunityThemeManifest
} from '@/features/themes/communityThemeTypes';
import { commands } from '@/platform/tauri/bindings';
import {
    COMMUNITY_THEME_CATALOG_URL,
    COMMUNITY_THEME_CSS_FILE_NAME,
    loadCommunityThemeCatalog,
    loadCommunityThemeCss,
    resolveCommunityThemeAssetUrl
} from '@/repositories/communityThemeRepository';
import { COMMUNITY_THEME_CONFIG_KEYS } from '@/repositories/configKeys';
import configRepository from '@/repositories/configRepository';
import {
    disableBackgroundImageForCommunityTheme,
    migrateLegacyNasaApodCommunityThemeForBackgroundImage
} from '@/services/appearanceConflictCoordinator';
import { useCommunityThemeStore } from '@/state/communityThemeStore';

import {
    syncCommunityThemeAccentControl,
    syncCommunityThemeAppearanceControl
} from './appearanceControl';
import {
    clearStoredCommunityThemeInstallState,
    currentTimestamp,
    isInstallRecordCssSnapshotAllowed,
    isInstallRecordFromCurrentCatalog,
    isLegacyNasaApodWallpaperThemeId,
    mergeInstallRecords,
    normalizeInstallMetadata,
    normalizeInstallRecords,
    persistCommunityThemeInstallState,
    sha256Hex,
    stripCssSnapshot,
    type CommunityThemeInstalledSnapshot
} from './installRecords';
import {
    getInstalledThemeCssSnapshot,
    setCommunityThemeOverrideCssSnapshot,
    setInstalledThemeCssSnapshot,
    syncCommunityStyleLayers
} from './styleLayers';

async function refreshCommunityThemeTrayMenu(): Promise<void> {
    try {
        await commands.appRefreshTrayMenu();
    } catch (error) {
        console.warn('Unable to refresh community theme tray menu:', error);
    }
}

function currentCatalogInstallRecords(value: unknown) {
    return normalizeInstallRecords(value)
        .filter(isInstallRecordFromCurrentCatalog)
        .filter(isInstallRecordCssSnapshotAllowed);
}

export async function loadCatalog(): Promise<CommunityThemeCatalog> {
    const store = useCommunityThemeStore.getState();
    store.setLoading(true);
    store.setError(null);
    try {
        const catalog = await loadCommunityThemeCatalog(
            COMMUNITY_THEME_CATALOG_URL
        );
        store.setCatalog(catalog.sourceUrl, catalog.themes);
        return catalog;
    } catch (error) {
        const message =
            error instanceof Error
                ? error.message
                : 'Failed to load community themes.';
        store.setError(message);
        throw error;
    } finally {
        store.setLoading(false);
    }
}

export async function initializeCommunityThemes(): Promise<void> {
    const [
        enabled,
        activeThemeId,
        legacyMetadata,
        legacyCssSnapshot,
        installedThemeRecords,
        overrideCss,
        overrideCssEnabledRaw
    ] = await Promise.all([
        configRepository.getBool(COMMUNITY_THEME_CONFIG_KEYS.enabled, false),
        configRepository.getString(COMMUNITY_THEME_CONFIG_KEYS.id, ''),
        configRepository.getObject(
            COMMUNITY_THEME_CONFIG_KEYS.installMetadata,
            null
        ),
        configRepository.getString(COMMUNITY_THEME_CONFIG_KEYS.cssSnapshot, ''),
        configRepository.getObject(
            COMMUNITY_THEME_CONFIG_KEYS.installedThemes,
            null
        ),
        configRepository.getString(COMMUNITY_THEME_CONFIG_KEYS.overrideCss, ''),
        configRepository.getRawValue(
            COMMUNITY_THEME_CONFIG_KEYS.overrideCssEnabled
        ),
        configRepository.remove(
            COMMUNITY_THEME_CONFIG_KEYS.legacyMarketplaceCatalogUrl
        )
    ]);

    const legacyInstallMetadata = normalizeInstallMetadata(legacyMetadata);
    const legacyInstallRecord: CommunityThemeInstalledSnapshot | null =
        legacyInstallMetadata && String(legacyCssSnapshot || '').trim()
            ? {
                  ...legacyInstallMetadata,
                  cssSnapshot: String(legacyCssSnapshot || '')
              }
            : null;
    const rawRecords = mergeInstallRecords([
        ...normalizeInstallRecords(installedThemeRecords),
        ...(legacyInstallRecord ? [legacyInstallRecord] : [])
    ]);
    const legacyApodWasActive = Boolean(
        enabled &&
        (isLegacyNasaApodWallpaperThemeId(activeThemeId) ||
            isLegacyNasaApodWallpaperThemeId(
                legacyInstallMetadata?.themeId ?? ''
            ))
    );
    const records = rawRecords
        .filter(isInstallRecordFromCurrentCatalog)
        .filter(isInstallRecordCssSnapshotAllowed);
    const activeRecord =
        records.find((record) => record.themeId === activeThemeId) ??
        records.find(
            (record) => record.themeId === legacyInstallMetadata?.themeId
        ) ??
        null;

    if (
        (legacyInstallMetadata || Array.isArray(installedThemeRecords)) &&
        !records.length
    ) {
        await clearStoredCommunityThemeInstallState();
    } else {
        await persistCommunityThemeInstallState({
            records,
            enabled: Boolean(enabled && activeRecord),
            activeRecord: enabled && activeRecord ? activeRecord : null
        });
    }
    setInstalledThemeCssSnapshot(
        enabled && activeRecord ? activeRecord.cssSnapshot : ''
    );
    const nextOverrideCss = String(overrideCss || '');
    const nextOverrideCssEnabled = nextOverrideCss.trim()
        ? overrideCssEnabledRaw === null || overrideCssEnabledRaw === 'true'
        : false;
    setCommunityThemeOverrideCssSnapshot(
        nextOverrideCss,
        nextOverrideCssEnabled
    );
    if (legacyApodWasActive) {
        await migrateLegacyNasaApodCommunityThemeForBackgroundImage();
    }

    useCommunityThemeStore.getState().hydrate({
        catalogUrl: COMMUNITY_THEME_CATALOG_URL,
        enabled: Boolean(enabled && activeRecord),
        installedTheme:
            enabled && activeRecord ? stripCssSnapshot(activeRecord) : null,
        installedThemes: records.map(stripCssSnapshot),
        overrideCssLength: nextOverrideCssEnabled ? nextOverrideCss.length : 0,
        localPreview: null
    });
    syncCommunityStyleLayers();
    await syncCommunityThemeAppearanceControl();
    await syncCommunityThemeAccentControl();
    await refreshCommunityThemeTrayMenu();
}

export async function installCommunityTheme(
    theme: CommunityThemeManifest
): Promise<CommunityThemeInstallMetadata> {
    const store = useCommunityThemeStore.getState();
    store.setLoading(true);
    store.setError(null);
    try {
        const catalogUrl = COMMUNITY_THEME_CATALOG_URL;
        const cssText = await loadCommunityThemeCss(catalogUrl, theme);
        await disableBackgroundImageForCommunityTheme({
            restoreAppTheme: false
        });
        const now = currentTimestamp();
        const previous = store.installedThemes.find(
            (installedTheme) => installedTheme.themeId === theme.id
        );
        const metadata: CommunityThemeInstallMetadata = {
            themeId: theme.id,
            themeName: theme.name,
            version: theme.version,
            sourceUrl: resolveCommunityThemeAssetUrl(
                catalogUrl,
                theme.id,
                COMMUNITY_THEME_CSS_FILE_NAME
            ),
            sha256: await sha256Hex(cssText),
            installedAt:
                previous?.themeId === theme.id && previous.installedAt
                    ? previous.installedAt
                    : now,
            updatedAt: now,
            darkMode: theme.darkMode !== false,
            accentMode: theme.accentMode === true
        };
        const record: CommunityThemeInstalledSnapshot = {
            ...metadata,
            cssSnapshot: cssText
        };
        const records = mergeInstallRecords([
            ...store.installedThemes.map(
                (installedTheme): CommunityThemeInstalledSnapshot => ({
                    ...installedTheme,
                    cssSnapshot:
                        installedTheme.themeId === store.installedTheme?.themeId
                            ? getInstalledThemeCssSnapshot()
                            : ''
                })
            ),
            ...normalizeInstallRecords(
                await configRepository.getObject(
                    COMMUNITY_THEME_CONFIG_KEYS.installedThemes,
                    null
                )
            ),
            record
        ])
            .filter(isInstallRecordFromCurrentCatalog)
            .filter(isInstallRecordCssSnapshotAllowed);

        setInstalledThemeCssSnapshot(cssText);
        await persistCommunityThemeInstallState({
            records,
            enabled: true,
            activeRecord: record
        });
        store.setInstalledState({
            enabled: true,
            installedTheme: metadata,
            installedThemes: records.map(stripCssSnapshot)
        });
        syncCommunityStyleLayers();
        await syncCommunityThemeAppearanceControl();
        await syncCommunityThemeAccentControl();
        await refreshCommunityThemeTrayMenu();
        return metadata;
    } catch (error) {
        const message =
            error instanceof Error
                ? error.message
                : 'Failed to install community theme.';
        store.setError(message);
        throw error;
    } finally {
        store.setLoading(false);
    }
}

export async function enableInstalledCommunityTheme(
    themeId?: string
): Promise<void> {
    const store = useCommunityThemeStore.getState();
    const records = currentCatalogInstallRecords(
        await configRepository.getObject(
            COMMUNITY_THEME_CONFIG_KEYS.installedThemes,
            null
        )
    );
    const targetThemeId =
        themeId || store.installedTheme?.themeId || records[0]?.themeId || '';
    const activeRecord =
        records.find((record) => record.themeId === targetThemeId) ?? null;
    if (!activeRecord) {
        return;
    }
    await disableBackgroundImageForCommunityTheme({ restoreAppTheme: false });
    const nextRecords = mergeInstallRecords([
        ...records.filter((record) => record.themeId !== activeRecord.themeId),
        activeRecord
    ])
        .filter(isInstallRecordFromCurrentCatalog)
        .filter(isInstallRecordCssSnapshotAllowed);
    setInstalledThemeCssSnapshot(activeRecord.cssSnapshot);
    await persistCommunityThemeInstallState({
        records: nextRecords,
        enabled: true,
        activeRecord
    });
    store.setInstalledState({
        enabled: true,
        installedTheme: stripCssSnapshot(activeRecord),
        installedThemes: nextRecords.map(stripCssSnapshot)
    });
    syncCommunityStyleLayers();
    await syncCommunityThemeAppearanceControl();
    await syncCommunityThemeAccentControl();
    await refreshCommunityThemeTrayMenu();
}

export async function disableInstalledCommunityTheme(): Promise<void> {
    const store = useCommunityThemeStore.getState();
    const records = currentCatalogInstallRecords(
        await configRepository.getObject(
            COMMUNITY_THEME_CONFIG_KEYS.installedThemes,
            null
        )
    );
    setInstalledThemeCssSnapshot('');
    await persistCommunityThemeInstallState({
        records,
        enabled: false,
        activeRecord: null
    });
    store.setInstalledState({
        enabled: false,
        installedTheme: null,
        installedThemes: records.map(stripCssSnapshot)
    });
    syncCommunityStyleLayers();
    await syncCommunityThemeAppearanceControl();
    await syncCommunityThemeAccentControl();
    await refreshCommunityThemeTrayMenu();
}

export async function deleteInstalledCommunityTheme(
    themeId?: string
): Promise<void> {
    const store = useCommunityThemeStore.getState();
    const targetThemeId = themeId || store.installedTheme?.themeId || '';
    if (!targetThemeId) {
        return;
    }
    const records = currentCatalogInstallRecords(
        await configRepository.getObject(
            COMMUNITY_THEME_CONFIG_KEYS.installedThemes,
            null
        )
    ).filter((record) => record.themeId !== targetThemeId);
    const activeRecord =
        store.enabled && store.installedTheme?.themeId !== targetThemeId
            ? (records.find(
                  (record) => record.themeId === store.installedTheme?.themeId
              ) ?? null)
            : null;
    setInstalledThemeCssSnapshot(activeRecord ? activeRecord.cssSnapshot : '');
    await persistCommunityThemeInstallState({
        records,
        enabled: Boolean(activeRecord),
        activeRecord
    });
    store.setInstalledState({
        enabled: Boolean(activeRecord),
        installedTheme: activeRecord ? stripCssSnapshot(activeRecord) : null,
        installedThemes: records.map(stripCssSnapshot)
    });
    syncCommunityStyleLayers();
    await syncCommunityThemeAppearanceControl();
    await syncCommunityThemeAccentControl();
    await refreshCommunityThemeTrayMenu();
}
