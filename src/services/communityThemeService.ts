import type {
    CommunityThemeCatalog,
    CommunityThemeInstallMetadata,
    CommunityThemeLocalPreview,
    CommunityThemeManifest
} from '@/features/themes/communityThemeTypes';
import { convertFileSrc } from '@/platform/tauri/assets';
import { commands } from '@/platform/tauri/bindings';
import {
    COMMUNITY_THEME_CATALOG_URL,
    COMMUNITY_THEME_CSS_FILE_NAME,
    loadCommunityThemeCss,
    loadCommunityThemeCatalog,
    resolveCommunityThemeAssetUrl
} from '@/repositories/communityThemeRepository';
import {
    APP_THEME_CONFIG_KEYS,
    COMMUNITY_THEME_CONFIG_KEYS
} from '@/repositories/configKeys';
import configRepository from '@/repositories/configRepository';
import {
    disableBackgroundImageForCommunityTheme,
    isBackgroundImageAppearanceActive,
    migrateLegacyNasaApodCommunityThemeForBackgroundImage,
    registerCommunityThemeAppearanceHandlers
} from '@/services/appearanceConflictCoordinator';
import { isDevToolsBuild } from '@/shared/buildLabel';
import {
    communityThemeControlsAccent,
    communityThemeControlsAppearance,
    resolveCommunityThemeBaseMode,
    useCommunityThemeStore
} from '@/state/communityThemeStore';

import {
    applyThemeColor,
    resolveThemeMode,
    clearThemeColorInlineProperties,
    resolveThemeColor,
    setCommunityThemeAppearanceControl
} from './themeService';
import { setVrcxCssLayers } from './vrcxCssLayerService';

const INSTALLED_THEME_LAYER = 'installed-theme';
const LOCAL_PREVIEW_LAYER = 'local-theme-preview';
const USER_OVERRIDE_LAYER = 'user-override';
const COMMUNITY_THEME_ACCENT_ATTR = 'data-vrcx-0-community-theme-accent';
const LEGACY_NASA_APOD_WALLPAPER_THEME_ID = 'nasa-apod-wallpaper';
const CSS_URL_PATTERN = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;
const LOCAL_PREVIEW_WATCH_INTERVAL_MS = 1200;

type CommunityThemeInstalledSnapshot = CommunityThemeInstallMetadata & {
    cssSnapshot: string;
};

let installedThemeCssSnapshot = '';
let localPreviewCssSnapshot = '';
let overrideCssSnapshot = '';
let overrideCssEnabled = false;
let localPreviewWatchTimer: number | null = null;
let localPreviewWatchFolderPath = '';
let localPreviewWatchReloading = false;
let localPreviewWatchGeneration = 0;

async function refreshCommunityThemeTrayMenu(): Promise<void> {
    try {
        await commands.appRefreshTrayMenu();
    } catch (error) {
        console.warn('Unable to refresh community theme tray menu:', error);
    }
}

function currentTimestamp(): string {
    return new Date().toISOString();
}

function syncCommunityStyleLayers(): void {
    setVrcxCssLayers({
        [INSTALLED_THEME_LAYER]: installedThemeCssSnapshot,
        [LOCAL_PREVIEW_LAYER]: localPreviewCssSnapshot,
        [USER_OVERRIDE_LAYER]: overrideCssEnabled ? overrideCssSnapshot : ''
    });
}

async function applySavedThemeColor(): Promise<void> {
    const savedThemeColor = await configRepository.getString(
        APP_THEME_CONFIG_KEYS.themeColor,
        'default'
    );
    applyThemeColor(resolveThemeColor(savedThemeColor));
}

async function applySavedThemeMode(): Promise<void> {
    const savedThemeMode = await configRepository.getString(
        APP_THEME_CONFIG_KEYS.themeMode,
        'system'
    );
    await setCommunityThemeAppearanceControl(
        false,
        resolveThemeMode(savedThemeMode)
    );
}

async function syncCommunityThemeAppearanceControl(): Promise<void> {
    const { enabled, installedTheme, localPreview } =
        useCommunityThemeStore.getState();
    const controlsAppearance = communityThemeControlsAppearance(
        enabled,
        installedTheme,
        localPreview
    );

    if (controlsAppearance) {
        await setCommunityThemeAppearanceControl(
            true,
            undefined,
            resolveCommunityThemeBaseMode(enabled, installedTheme, localPreview)
        );
        return;
    }

    if (!isBackgroundImageAppearanceActive()) {
        await applySavedThemeMode();
    }
}

async function syncCommunityThemeAccentControl(): Promise<void> {
    if (typeof document === 'undefined') {
        return;
    }

    const { enabled, installedTheme, localPreview } =
        useCommunityThemeStore.getState();
    const controlsAccent = communityThemeControlsAccent(
        enabled,
        installedTheme,
        localPreview
    );
    const root = document.documentElement;
    if (controlsAccent) {
        root.setAttribute(COMMUNITY_THEME_ACCENT_ATTR, 'theme');
        clearThemeColorInlineProperties();
        return;
    }

    root.removeAttribute(COMMUNITY_THEME_ACCENT_ATTR);
    await applySavedThemeColor();
}

function shouldRewriteCssUrl(url: string): boolean {
    if (!url || url.startsWith('#')) {
        return false;
    }
    return !/^(?:[a-z][a-z0-9+.-]*:|\/|\\\\)/i.test(url);
}

function rewriteLocalThemeAssetUrls(
    cssText: string,
    cssPath: string,
    cacheKey?: string
): string {
    const baseCssUrl = convertFileSrc(cssPath);
    return cssText.replace(
        CSS_URL_PATTERN,
        (match: string, quote: string, rawUrl: string) => {
            const url = String(rawUrl || '').trim();
            if (!shouldRewriteCssUrl(url)) {
                return match;
            }

            try {
                const resolvedUrl = new URL(url, baseCssUrl);
                if (cacheKey) {
                    resolvedUrl.searchParams.set('vrcx0ThemePreview', cacheKey);
                }
                const nextQuote = quote || '"';
                return `url(${nextQuote}${resolvedUrl.toString()}${nextQuote})`;
            } catch {
                return match;
            }
        }
    );
}

async function sha256Hex(value: string): Promise<string> {
    if (typeof crypto === 'undefined' || !crypto.subtle) {
        let hash = 0;
        for (let index = 0; index < value.length; index += 1) {
            hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
        }
        return hash.toString(16).padStart(8, '0');
    }

    const data = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return [...new Uint8Array(digest)]
        .map((byte: any) => byte.toString(16).padStart(2, '0'))
        .join('');
}

function normalizeInstallMetadata(
    value: unknown
): CommunityThemeInstallMetadata | null {
    if (!value || typeof value !== 'object') {
        return null;
    }
    const entry = value as Record<string, unknown>;
    if (!entry.themeId || !entry.themeName || !entry.version) {
        return null;
    }
    return {
        themeId: String(entry.themeId),
        themeName: String(entry.themeName),
        version: String(entry.version),
        sourceUrl: String(entry.sourceUrl || ''),
        sha256: String(entry.sha256 || ''),
        installedAt: String(entry.installedAt || ''),
        updatedAt: String(entry.updatedAt || ''),
        darkMode: entry.darkMode !== false,
        accentMode: entry.accentMode === true || entry.accentMode === 'app'
    };
}

function normalizeInstallRecord(
    value: unknown
): CommunityThemeInstalledSnapshot | null {
    const metadata = normalizeInstallMetadata(value);
    if (!metadata || !value || typeof value !== 'object') {
        return null;
    }

    const entry = value as Record<string, unknown>;
    const cssSnapshot = String(entry.cssSnapshot || '');
    if (!cssSnapshot.trim()) {
        return null;
    }

    return {
        ...metadata,
        cssSnapshot
    };
}

function normalizeInstallRecords(
    value: unknown
): CommunityThemeInstalledSnapshot[] {
    if (!Array.isArray(value)) {
        return [];
    }

    return value
        .map((entry) => normalizeInstallRecord(entry))
        .filter(Boolean) as CommunityThemeInstalledSnapshot[];
}

function stripCssSnapshot(
    record: CommunityThemeInstalledSnapshot
): CommunityThemeInstallMetadata {
    const { cssSnapshot: _cssSnapshot, ...metadata } = record;
    return metadata;
}

function mergeInstallRecords(
    records: CommunityThemeInstalledSnapshot[]
): CommunityThemeInstalledSnapshot[] {
    const merged = new Map<string, CommunityThemeInstalledSnapshot>();
    records.forEach((record) => {
        if (record.themeId && record.cssSnapshot.trim()) {
            merged.set(record.themeId, record);
        }
    });
    return Array.from(merged.values());
}

function resolveCurrentCatalogThemeCssUrl(themeId: string): string {
    return resolveCommunityThemeAssetUrl(
        COMMUNITY_THEME_CATALOG_URL,
        themeId,
        COMMUNITY_THEME_CSS_FILE_NAME
    );
}

function isInstallRecordFromCurrentCatalog(
    record: CommunityThemeInstalledSnapshot
): boolean {
    return (
        record.sourceUrl === resolveCurrentCatalogThemeCssUrl(record.themeId)
    );
}

async function clearStoredCommunityThemeInstallState(): Promise<void> {
    await Promise.all([
        configRepository.setBool(COMMUNITY_THEME_CONFIG_KEYS.enabled, false),
        configRepository.remove(COMMUNITY_THEME_CONFIG_KEYS.id),
        configRepository.remove(COMMUNITY_THEME_CONFIG_KEYS.version),
        configRepository.remove(COMMUNITY_THEME_CONFIG_KEYS.cssSnapshot),
        configRepository.remove(COMMUNITY_THEME_CONFIG_KEYS.installMetadata),
        configRepository.remove(COMMUNITY_THEME_CONFIG_KEYS.installedThemes)
    ]);
}

async function persistCommunityThemeInstallState({
    records,
    enabled,
    activeRecord
}: {
    records: CommunityThemeInstalledSnapshot[];
    enabled: boolean;
    activeRecord: CommunityThemeInstalledSnapshot | null;
}): Promise<void> {
    const installedThemesJson = JSON.stringify(records);
    if (enabled && activeRecord) {
        await configRepository.setMany([
            [COMMUNITY_THEME_CONFIG_KEYS.enabled, 'true'],
            [COMMUNITY_THEME_CONFIG_KEYS.id, activeRecord.themeId],
            [COMMUNITY_THEME_CONFIG_KEYS.version, activeRecord.version],
            [COMMUNITY_THEME_CONFIG_KEYS.cssSnapshot, activeRecord.cssSnapshot],
            [
                COMMUNITY_THEME_CONFIG_KEYS.installMetadata,
                JSON.stringify(stripCssSnapshot(activeRecord))
            ],
            [COMMUNITY_THEME_CONFIG_KEYS.installedThemes, installedThemesJson]
        ]);
        return;
    }

    await Promise.all([
        configRepository.setBool(COMMUNITY_THEME_CONFIG_KEYS.enabled, false),
        configRepository.setString(
            COMMUNITY_THEME_CONFIG_KEYS.installedThemes,
            installedThemesJson
        ),
        configRepository.remove(COMMUNITY_THEME_CONFIG_KEYS.id),
        configRepository.remove(COMMUNITY_THEME_CONFIG_KEYS.version),
        configRepository.remove(COMMUNITY_THEME_CONFIG_KEYS.cssSnapshot),
        configRepository.remove(COMMUNITY_THEME_CONFIG_KEYS.installMetadata)
    ]);
}

function isInstallRecordCssSnapshotAllowed(
    record: CommunityThemeInstalledSnapshot
): boolean {
    return record.themeId !== LEGACY_NASA_APOD_WALLPAPER_THEME_ID;
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
    const legacyInstallRecord =
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
        (activeThemeId === LEGACY_NASA_APOD_WALLPAPER_THEME_ID ||
            legacyInstallMetadata?.themeId ===
                LEGACY_NASA_APOD_WALLPAPER_THEME_ID)
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
    installedThemeCssSnapshot =
        enabled && activeRecord ? activeRecord.cssSnapshot : '';
    overrideCssSnapshot = String(overrideCss || '');
    overrideCssEnabled = overrideCssSnapshot.trim()
        ? overrideCssEnabledRaw === null || overrideCssEnabledRaw === 'true'
        : false;
    if (legacyApodWasActive) {
        await migrateLegacyNasaApodCommunityThemeForBackgroundImage();
    }

    useCommunityThemeStore.getState().hydrate({
        catalogUrl: COMMUNITY_THEME_CATALOG_URL,
        enabled: Boolean(enabled && activeRecord),
        installedTheme:
            enabled && activeRecord ? stripCssSnapshot(activeRecord) : null,
        installedThemes: records.map(stripCssSnapshot),
        overrideCssLength: overrideCssEnabled ? overrideCssSnapshot.length : 0,
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
                (installedTheme) =>
                    ({
                        ...installedTheme,
                        cssSnapshot:
                            installedTheme.themeId ===
                            store.installedTheme?.themeId
                                ? installedThemeCssSnapshot
                                : ''
                    }) as CommunityThemeInstalledSnapshot
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

        installedThemeCssSnapshot = cssText;
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
    const records = normalizeInstallRecords(
        await configRepository.getObject(
            COMMUNITY_THEME_CONFIG_KEYS.installedThemes,
            null
        )
    )
        .filter(isInstallRecordFromCurrentCatalog)
        .filter(isInstallRecordCssSnapshotAllowed);
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
    installedThemeCssSnapshot = activeRecord.cssSnapshot;
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
    const records = normalizeInstallRecords(
        await configRepository.getObject(
            COMMUNITY_THEME_CONFIG_KEYS.installedThemes,
            null
        )
    )
        .filter(isInstallRecordFromCurrentCatalog)
        .filter(isInstallRecordCssSnapshotAllowed);
    installedThemeCssSnapshot = '';
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
    const records = normalizeInstallRecords(
        await configRepository.getObject(
            COMMUNITY_THEME_CONFIG_KEYS.installedThemes,
            null
        )
    )
        .filter(isInstallRecordFromCurrentCatalog)
        .filter(isInstallRecordCssSnapshotAllowed)
        .filter((record) => record.themeId !== targetThemeId);
    const activeRecord =
        store.enabled && store.installedTheme?.themeId !== targetThemeId
            ? (records.find(
                  (record) => record.themeId === store.installedTheme?.themeId
              ) ?? null)
            : null;
    installedThemeCssSnapshot = activeRecord ? activeRecord.cssSnapshot : '';
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

export async function saveCommunityThemeOverrideCss(
    cssText: string
): Promise<void> {
    overrideCssSnapshot = String(cssText || '');
    overrideCssEnabled = Boolean(overrideCssSnapshot.trim());
    await Promise.all([
        configRepository.setString(
            COMMUNITY_THEME_CONFIG_KEYS.overrideCss,
            overrideCssSnapshot
        ),
        configRepository.setBool(
            COMMUNITY_THEME_CONFIG_KEYS.overrideCssEnabled,
            overrideCssEnabled
        )
    ]);
    useCommunityThemeStore
        .getState()
        .setOverrideCssLength(
            overrideCssEnabled ? overrideCssSnapshot.length : 0
        );
    syncCommunityStyleLayers();
}

export async function clearCommunityThemeOverrideCss(): Promise<void> {
    await saveCommunityThemeOverrideCss('');
}

export async function disableCommunityThemeOverrideCss(): Promise<void> {
    overrideCssEnabled = false;
    await configRepository.setBool(
        COMMUNITY_THEME_CONFIG_KEYS.overrideCssEnabled,
        false
    );
    useCommunityThemeStore.getState().setOverrideCssLength(0);
    syncCommunityStyleLayers();
}

export function getCommunityThemeOverrideCssSnapshot(): string {
    return overrideCssSnapshot;
}

export async function loadLocalCommunityThemePreview(
    folderPath: string,
    shouldApply?: () => boolean
): Promise<CommunityThemeLocalPreview> {
    if (!isDevToolsBuild()) {
        throw new Error(
            'Local theme preview is only available in dev or Theme Dev Kit builds.'
        );
    }

    const output =
        await commands.appCommunityThemeDebugLoadLocalTheme(folderPath);
    if (shouldApply && !shouldApply()) {
        throw new Error('Local theme preview load was cancelled.');
    }
    const loadedAt = currentTimestamp();
    const cssText = rewriteLocalThemeAssetUrls(
        output.css,
        output.cssPath,
        loadedAt
    );
    if (shouldApply && !shouldApply()) {
        throw new Error('Local theme preview load was cancelled.');
    }
    await disableBackgroundImageForCommunityTheme({ restoreAppTheme: false });
    if (shouldApply && !shouldApply()) {
        throw new Error('Local theme preview load was cancelled.');
    }
    localPreviewCssSnapshot = cssText;

    const preview: CommunityThemeLocalPreview = {
        folderPath: output.folderPath,
        cssPath: output.cssPath,
        manifestPath: output.manifestPath,
        themeName: output.themeName,
        version: output.version,
        darkMode: output.darkMode !== false,
        accentMode: output.accentMode === true,
        cssLength: cssText.length,
        loadedAt
    };
    useCommunityThemeStore.getState().setLocalPreview(preview);
    syncCommunityStyleLayers();
    await syncCommunityThemeAppearanceControl();
    await syncCommunityThemeAccentControl();
    return preview;
}

function resolveLocalPreviewWatchError(error: unknown): string {
    return error instanceof Error
        ? error.message
        : 'Failed to load local community theme preview.';
}

async function reloadLocalCommunityThemePreviewForWatch(
    generation: number
): Promise<void> {
    if (
        localPreviewWatchReloading ||
        generation !== localPreviewWatchGeneration ||
        !localPreviewWatchFolderPath
    ) {
        return;
    }

    localPreviewWatchReloading = true;
    const folderPath = localPreviewWatchFolderPath;
    try {
        await loadLocalCommunityThemePreview(
            folderPath,
            () => generation === localPreviewWatchGeneration
        );
        if (generation === localPreviewWatchGeneration) {
            useCommunityThemeStore.getState().setLocalPreviewWatch({
                enabled: true,
                folderPath,
                error: null
            });
        }
    } catch (error) {
        if (generation === localPreviewWatchGeneration) {
            useCommunityThemeStore.getState().setLocalPreviewWatch({
                enabled: true,
                folderPath,
                error: resolveLocalPreviewWatchError(error)
            });
        }
    } finally {
        if (generation === localPreviewWatchGeneration) {
            localPreviewWatchReloading = false;
        }
    }
}

export function startLocalCommunityThemePreviewWatch(folderPath: string): void {
    const nextFolderPath = folderPath.trim();
    if (!nextFolderPath) {
        return;
    }

    stopLocalCommunityThemePreviewWatch();
    localPreviewWatchGeneration += 1;
    localPreviewWatchFolderPath = nextFolderPath;
    useCommunityThemeStore.getState().setLocalPreviewWatch({
        enabled: true,
        folderPath: nextFolderPath,
        error: null
    });

    const generation = localPreviewWatchGeneration;
    void reloadLocalCommunityThemePreviewForWatch(generation);
    localPreviewWatchTimer = window.setInterval(() => {
        void reloadLocalCommunityThemePreviewForWatch(generation);
    }, LOCAL_PREVIEW_WATCH_INTERVAL_MS);
}

export function stopLocalCommunityThemePreviewWatch(): void {
    localPreviewWatchGeneration += 1;
    localPreviewWatchFolderPath = '';
    localPreviewWatchReloading = false;
    if (localPreviewWatchTimer !== null) {
        window.clearInterval(localPreviewWatchTimer);
        localPreviewWatchTimer = null;
    }
    useCommunityThemeStore.getState().setLocalPreviewWatch({
        enabled: false,
        error: null
    });
}

export async function stopLocalCommunityThemePreview(): Promise<void> {
    stopLocalCommunityThemePreviewWatch();
    localPreviewCssSnapshot = '';
    useCommunityThemeStore.getState().setLocalPreview(null);
    syncCommunityStyleLayers();
    await syncCommunityThemeAppearanceControl();
    await syncCommunityThemeAccentControl();
}

export function isCommunityThemeAccentControlled(): boolean {
    const state = useCommunityThemeStore.getState();
    return communityThemeControlsAccent(
        state.enabled,
        state.installedTheme,
        state.localPreview
    );
}

registerCommunityThemeAppearanceHandlers({
    disableInstalledCommunityTheme,
    stopLocalCommunityThemePreview
});
