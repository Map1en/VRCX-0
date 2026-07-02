import { commands } from '@/platform/tauri/bindings';
import {
    APP_THEME_CONFIG_KEYS,
    BACKGROUND_IMAGE_CONFIG_KEYS
} from '@/repositories/configKeys';
import configRepository from '@/repositories/configRepository';
import {
    disableCommunityThemesForBackgroundImage,
    registerBackgroundImageAppearanceHandlers
} from '@/services/appearanceConflictCoordinator';
import { HOUR_MS } from '@/shared/constants/time';
import { useBackgroundImageStore } from '@/state/backgroundImageStore';
import {
    communityThemeControlsAppearance,
    useCommunityThemeStore
} from '@/state/communityThemeStore';

import {
    applyThemeColor,
    resolveThemeColor,
    resolveThemeMode,
    setCommunityThemeAppearanceControl
} from '../themeService';
import {
    type VrcxCssLayer,
    setVrcxCssLayer,
    setVrcxCssLayersSuppressed
} from '../vrcxCssLayerService';
import {
    createBackgroundImageFilesSource,
    createBackgroundImageFolderSource,
    isBackgroundImageCustomSourceRotating,
    normalizeBackgroundImageCustomSource,
    pickBackgroundImageFiles,
    resolveBackgroundImageCustomSnapshot
} from './localSourceService';
import {
    backgroundImageRemoteProviders,
    DEFAULT_BACKGROUND_IMAGE_PROVIDER_ID,
    resolveBackgroundImageProvider
} from './remoteProviders';
import type {
    BackgroundImageCustomSource,
    BackgroundImageMode,
    BackgroundImageProviderId,
    BackgroundImageRotationInterval,
    BackgroundImageSnapshot
} from './types';

const BACKGROUND_IMAGE_LAYER = 'background-image';
const COMMUNITY_CSS_LAYERS: VrcxCssLayer[] = [
    'installed-theme',
    'local-theme-preview'
];

type SnapshotMap = Partial<
    Record<BackgroundImageProviderId, BackgroundImageSnapshot>
>;

let backgroundImageOperationId = 0;
let rotationTimer: ReturnType<typeof setTimeout> | null = null;

function normalizeMode(value: unknown): BackgroundImageMode {
    return value === 'daily' || value === 'custom' ? value : 'off';
}

function normalizeProviderId(value: unknown): BackgroundImageProviderId {
    return resolveBackgroundImageProvider(value).id;
}

function normalizeSnapshot(
    value: unknown,
    expectedProviderId?: BackgroundImageProviderId
): BackgroundImageSnapshot | null {
    if (!value || typeof value !== 'object') {
        return null;
    }

    const entry = value as Record<string, unknown>;
    const providerId = normalizeProviderId(entry.providerId);
    if (expectedProviderId && providerId !== expectedProviderId) {
        return null;
    }
    const imageUrl = String(entry.imageUrl || '').trim();
    if (!imageUrl) {
        return null;
    }

    return {
        mode: 'daily',
        providerId,
        imageUrl,
        title: String(entry.title || ''),
        author: String(entry.author || ''),
        license: String(entry.license || ''),
        source: String(entry.source || ''),
        resolvedAt: String(entry.resolvedAt || ''),
        resolvedForKey: String(
            entry.resolvedForKey || entry.resolvedForDate || ''
        )
    };
}

function normalizeSnapshots(value: unknown): SnapshotMap {
    if (!value || typeof value !== 'object') {
        return {};
    }

    const snapshots: SnapshotMap = {};
    backgroundImageRemoteProviders.forEach((provider) => {
        const snapshot = normalizeSnapshot(
            (value as Record<string, unknown>)[provider.id],
            provider.id
        );
        if (snapshot) {
            snapshots[provider.id] = snapshot;
        }
    });
    return snapshots;
}

function isSnapshotFresh(snapshot: BackgroundImageSnapshot | null): boolean {
    if (!snapshot?.providerId || !snapshot.resolvedAt) {
        return false;
    }

    const provider = resolveBackgroundImageProvider(snapshot.providerId);
    const resolvedAt = Date.parse(snapshot.resolvedAt);
    if (!Number.isFinite(resolvedAt)) {
        return false;
    }

    const ageMs = Date.now() - resolvedAt;
    return ageMs >= 0 && ageMs < provider.cacheTtlHours * HOUR_MS;
}

function toCssString(value: string): string {
    return `"${String(value || '')
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\A ')}"`;
}

function buildBackgroundImageCss(snapshot: BackgroundImageSnapshot): string {
    return `:root {
  --vrcx-0-wallpaper-image: url(${toCssString(snapshot.imageUrl)});
  --vrcx-0-wallpaper-size: cover;
  --vrcx-0-wallpaper-position: center;
  --vrcx-0-wallpaper-repeat: no-repeat;
  --vrcx-0-wallpaper-opacity: 1;
  --vrcx-0-wallpaper-filter: saturate(1.08) contrast(0.96);
  --vrcx-0-app-surface: transparent;
  --vrcx-0-titlebar-surface: color-mix(in oklch, var(--background) 38%, transparent);
  --vrcx-0-main-surface: transparent;
  --vrcx-0-main-content-surface: color-mix(in oklch, var(--background) 20%, transparent);
  --vrcx-0-sidebar-surface: color-mix(in oklch, var(--sidebar) 40%, transparent);
  --vrcx-0-sidebar-inset-surface: color-mix(in oklch, var(--background) 22%, transparent);
  --vrcx-0-side-panel-surface: color-mix(in oklch, var(--background) 38%, transparent);
  --vrcx-0-statusbar-surface: color-mix(in oklch, var(--background) 36%, transparent);
  --vrcx-0-table-surface: color-mix(in oklch, var(--background) 46%, transparent);
  --vrcx-0-table-header-surface: color-mix(in oklch, var(--background) 52%, transparent);
}

[data-slot='dialog-content'],
[data-slot='popover-content'] {
  background: color-mix(in oklch, var(--popover) 56%, transparent);
  backdrop-filter: blur(18px) saturate(1.05);
}

[data-slot='dialog-footer'],
[data-slot='card-footer'] {
  background: color-mix(in oklch, var(--muted) 34%, transparent);
}

[data-slot='card'] {
  background: color-mix(in oklch, var(--card) 46%, transparent);
  backdrop-filter: blur(14px) saturate(1.03);
}
`;
}

function beginBackgroundImageOperation(): number {
    backgroundImageOperationId += 1;
    return backgroundImageOperationId;
}

function isCurrentBackgroundImageOperation(operationId: number): boolean {
    return operationId === backgroundImageOperationId;
}

function clearRotationTimer(): void {
    if (rotationTimer) {
        window.clearTimeout(rotationTimer);
        rotationTimer = null;
    }
}

function msUntilNextRotation(
    interval: BackgroundImageRotationInterval
): number {
    const now = new Date();
    const next = new Date(now);
    if (interval === 'hourly') {
        next.setHours(now.getHours() + 1, 0, 2, 0);
        return Math.max(1_000, next.getTime() - now.getTime());
    }

    next.setDate(now.getDate() + 1);
    next.setHours(0, 0, 2, 0);
    return Math.max(1_000, next.getTime() - now.getTime());
}

function scheduleCustomRotation(): void {
    clearRotationTimer();
    if (typeof window === 'undefined') {
        return;
    }

    const state = useBackgroundImageStore.getState();
    if (
        !state.enabled ||
        state.mode !== 'custom' ||
        !isBackgroundImageCustomSourceRotating(
            state.customSource,
            state.snapshot?.imageCount
        )
    ) {
        return;
    }

    const interval = state.customSource?.rotationInterval || 'daily';
    rotationTimer = window.setTimeout(() => {
        refreshBackgroundImage().catch((error) => {
            console.warn('Failed to refresh Background Image rotation:', error);
        });
    }, msUntilNextRotation(interval));
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

async function applySavedThemeColor(): Promise<void> {
    const savedThemeColor = await configRepository.getString(
        APP_THEME_CONFIG_KEYS.themeColor,
        'default'
    );
    applyThemeColor(resolveThemeColor(savedThemeColor));
}

function isCommunityAppearanceActive(): boolean {
    const state = useCommunityThemeStore.getState();
    return communityThemeControlsAppearance(
        state.enabled,
        state.installedTheme,
        state.localPreview
    );
}

async function syncBackgroundImageAppearance(
    restoreAppTheme = true
): Promise<void> {
    const state = useBackgroundImageStore.getState();
    const suppressCommunityLayers = Boolean(state.enabled);
    const shouldApply = Boolean(state.enabled && state.snapshot);
    setVrcxCssLayer(
        BACKGROUND_IMAGE_LAYER,
        shouldApply && state.snapshot
            ? buildBackgroundImageCss(state.snapshot)
            : ''
    );
    setVrcxCssLayersSuppressed(COMMUNITY_CSS_LAYERS, suppressCommunityLayers);

    if (shouldApply) {
        await setCommunityThemeAppearanceControl(true);
        scheduleCustomRotation();
        return;
    }

    clearRotationTimer();
    if (restoreAppTheme && !isCommunityAppearanceActive()) {
        await applySavedThemeMode();
        await applySavedThemeColor();
    }
}

async function loadSnapshots(): Promise<SnapshotMap> {
    const currentRaw = await configRepository.getRawValue(
        BACKGROUND_IMAGE_CONFIG_KEYS.snapshots
    );
    if (currentRaw !== null) {
        return normalizeSnapshots(
            await configRepository.getObject(
                BACKGROUND_IMAGE_CONFIG_KEYS.snapshots,
                null
            )
        );
    }

    return normalizeSnapshots(
        await configRepository.getObject(
            BACKGROUND_IMAGE_CONFIG_KEYS.legacySnapshots,
            null
        )
    );
}

async function persistSnapshot(
    snapshot: BackgroundImageSnapshot
): Promise<void> {
    if (!snapshot.providerId) {
        return;
    }
    const snapshots = await loadSnapshots();
    snapshots[snapshot.providerId] = snapshot;
    await configRepository.setObject(
        BACKGROUND_IMAGE_CONFIG_KEYS.snapshots,
        snapshots
    );
}

async function loadCustomSource(): Promise<BackgroundImageCustomSource | null> {
    return normalizeBackgroundImageCustomSource(
        await configRepository.getObject(
            BACKGROUND_IMAGE_CONFIG_KEYS.customSource,
            null
        )
    );
}

async function persistCustomSource(
    customSource: BackgroundImageCustomSource | null
): Promise<void> {
    if (!customSource) {
        await configRepository.remove(
            BACKGROUND_IMAGE_CONFIG_KEYS.customSource
        );
        return;
    }
    await configRepository.setObject(
        BACKGROUND_IMAGE_CONFIG_KEYS.customSource,
        customSource
    );
}

async function resolveProviderSnapshot(
    providerId: BackgroundImageProviderId,
    forceRefresh = false
): Promise<BackgroundImageSnapshot | null> {
    const snapshots = await loadSnapshots();
    const cached = snapshots[providerId] ?? null;
    if (!forceRefresh && isSnapshotFresh(cached)) {
        return cached;
    }

    try {
        const provider = resolveBackgroundImageProvider(providerId);
        const snapshot = await provider.resolveSnapshot();
        await persistSnapshot(snapshot);
        return snapshot;
    } catch (error) {
        if (cached) {
            console.warn(
                'Unable to refresh Background Image; using cached snapshot.',
                error
            );
            return cached;
        }
        throw error;
    }
}

async function resolveCustomSnapshot(
    source: BackgroundImageCustomSource | null,
    validatePreviousSnapshot = false
): Promise<BackgroundImageSnapshot | null> {
    if (!source) {
        return null;
    }
    return resolveBackgroundImageCustomSnapshot(
        source,
        validatePreviousSnapshot
            ? useBackgroundImageStore.getState().snapshot
            : null
    );
}

async function persistState({
    enabled,
    mode,
    providerId
}: {
    enabled: boolean;
    mode: BackgroundImageMode;
    providerId: BackgroundImageProviderId;
}): Promise<void> {
    await Promise.all([
        configRepository.setBool(BACKGROUND_IMAGE_CONFIG_KEYS.enabled, enabled),
        configRepository.setString(BACKGROUND_IMAGE_CONFIG_KEYS.mode, mode),
        configRepository.setString(
            BACKGROUND_IMAGE_CONFIG_KEYS.providerId,
            providerId
        )
    ]);
}

export async function initializeBackgroundImage(): Promise<void> {
    const legacyEnabled = await configRepository.getBool(
        BACKGROUND_IMAGE_CONFIG_KEYS.legacyEnabled,
        false
    );
    const enabled = await configRepository.getBool(
        BACKGROUND_IMAGE_CONFIG_KEYS.enabled,
        legacyEnabled
    );
    const mode = normalizeMode(
        await configRepository.getString(
            BACKGROUND_IMAGE_CONFIG_KEYS.mode,
            enabled ? 'daily' : 'off'
        )
    );
    const providerId = normalizeProviderId(
        await configRepository.getString(
            BACKGROUND_IMAGE_CONFIG_KEYS.providerId,
            await configRepository.getString(
                BACKGROUND_IMAGE_CONFIG_KEYS.legacyProviderId,
                DEFAULT_BACKGROUND_IMAGE_PROVIDER_ID
            )
        )
    );
    const customSource = await loadCustomSource();
    let snapshot: BackgroundImageSnapshot | null = null;
    let nextEnabled = Boolean(enabled && mode !== 'off');
    let nextMode = mode;

    if (nextEnabled && mode === 'daily') {
        const snapshots = await loadSnapshots();
        snapshot = await resolveProviderSnapshot(providerId).catch((error) => {
            console.warn('Unable to initialize Background Image:', error);
            return snapshots[providerId] ?? null;
        });
        nextEnabled = Boolean(snapshot && !isCommunityAppearanceActive());
    } else if (nextEnabled && mode === 'custom') {
        snapshot = await resolveCustomSnapshot(customSource, true).catch(
            (error: unknown): null => {
                console.warn(
                    'Unable to initialize custom Background Image:',
                    error
                );
                return null;
            }
        );
        if (!snapshot || isCommunityAppearanceActive()) {
            nextEnabled = false;
            nextMode = 'off';
        }
    } else {
        nextEnabled = false;
        nextMode = mode === 'custom' ? 'custom' : 'off';
    }

    useBackgroundImageStore.getState().hydrate({
        mode: nextMode,
        enabled: nextEnabled,
        providerId,
        customSource,
        snapshot
    });
    await persistState({
        enabled: nextEnabled,
        mode: nextMode,
        providerId
    });
    await syncBackgroundImageAppearance(false);
}

export async function setBackgroundImageMode(
    nextMode: BackgroundImageMode
): Promise<boolean> {
    if (nextMode === 'off') {
        await disableBackgroundImage();
        return true;
    }
    if (nextMode === 'daily') {
        return enableBackgroundImageDaily();
    }

    const state = useBackgroundImageStore.getState();
    if (!state.customSource) {
        await persistState({
            enabled: false,
            mode: 'custom',
            providerId: state.providerId
        });
        state.setStateSnapshot({
            mode: 'custom',
            enabled: false,
            providerId: state.providerId,
            customSource: state.customSource,
            snapshot: state.snapshot?.mode === 'custom' ? state.snapshot : null
        });
        await syncBackgroundImageAppearance();
        return false;
    }
    return enableBackgroundImageCustom();
}

export async function setBackgroundImageProvider(
    providerIdInput: unknown
): Promise<void> {
    const providerId = normalizeProviderId(providerIdInput);
    const state = useBackgroundImageStore.getState();
    if (state.providerId === providerId) {
        return;
    }

    if (state.enabled && state.mode === 'daily') {
        const operationId = beginBackgroundImageOperation();
        state.setLoading(true);
        state.setError(null);
        try {
            const snapshot = await resolveProviderSnapshot(providerId);
            if (!isCurrentBackgroundImageOperation(operationId)) {
                return;
            }
            await disableCommunityThemesForBackgroundImage();
            await persistState({
                enabled: Boolean(snapshot),
                mode: snapshot ? 'daily' : 'off',
                providerId
            });
            useBackgroundImageStore.getState().setStateSnapshot({
                mode: snapshot ? 'daily' : 'off',
                enabled: Boolean(snapshot),
                providerId,
                customSource: state.customSource,
                snapshot
            });
            await syncBackgroundImageAppearance();
        } catch (error) {
            if (!isCurrentBackgroundImageOperation(operationId)) {
                return;
            }
            const message =
                error instanceof Error
                    ? error.message
                    : 'Failed to update Background Image provider.';
            useBackgroundImageStore.getState().setError(message);
            useBackgroundImageStore.getState().setStateSnapshot({
                mode: state.mode,
                enabled: state.enabled,
                providerId: state.providerId,
                customSource: state.customSource,
                snapshot: state.snapshot
            });
            throw error;
        } finally {
            if (isCurrentBackgroundImageOperation(operationId)) {
                useBackgroundImageStore.getState().setLoading(false);
            }
        }
        return;
    }

    await configRepository.setString(
        BACKGROUND_IMAGE_CONFIG_KEYS.providerId,
        providerId
    );
    const snapshots = await loadSnapshots();
    useBackgroundImageStore.getState().setStateSnapshot({
        mode: state.mode === 'daily' ? 'daily' : state.mode,
        enabled: state.enabled,
        providerId,
        customSource: state.customSource,
        snapshot:
            state.snapshot?.providerId === providerId
                ? state.snapshot
                : (snapshots[providerId] ?? null)
    });
    await syncBackgroundImageAppearance();
}

export async function enableBackgroundImageDaily(
    providerIdInput?: unknown
): Promise<boolean> {
    const operationId = beginBackgroundImageOperation();
    const providerId = normalizeProviderId(
        providerIdInput || useBackgroundImageStore.getState().providerId
    );
    const store = useBackgroundImageStore.getState();
    store.setLoading(true);
    store.setError(null);
    try {
        const snapshot = await resolveProviderSnapshot(providerId);
        if (!isCurrentBackgroundImageOperation(operationId)) {
            return false;
        }
        const enabled = Boolean(snapshot);
        if (enabled) {
            await disableCommunityThemesForBackgroundImage();
        }
        await persistState({
            enabled,
            mode: enabled ? 'daily' : 'off',
            providerId
        });
        useBackgroundImageStore.getState().setStateSnapshot({
            mode: enabled ? 'daily' : 'off',
            enabled,
            providerId,
            customSource: store.customSource,
            snapshot
        });
        await syncBackgroundImageAppearance();
        return true;
    } catch (error) {
        if (!isCurrentBackgroundImageOperation(operationId)) {
            return false;
        }
        const message =
            error instanceof Error
                ? error.message
                : 'Failed to enable Background Image.';
        store.setError(message);
        throw error;
    } finally {
        if (isCurrentBackgroundImageOperation(operationId)) {
            store.setLoading(false);
        }
    }
}

export async function enableBackgroundImageCustom(
    customSourceInput?: BackgroundImageCustomSource | null
): Promise<boolean> {
    const operationId = beginBackgroundImageOperation();
    const store = useBackgroundImageStore.getState();
    const providerId = store.providerId;
    const customSource =
        normalizeBackgroundImageCustomSource(customSourceInput) ||
        store.customSource ||
        (await loadCustomSource());
    store.setLoading(true);
    store.setError(null);
    try {
        await persistCustomSource(customSource);
        const snapshot = await resolveCustomSnapshot(customSource);
        if (!isCurrentBackgroundImageOperation(operationId)) {
            return false;
        }
        if (!snapshot || !customSource) {
            await persistState({ enabled: false, mode: 'custom', providerId });
            useBackgroundImageStore.getState().setStateSnapshot({
                mode: 'custom',
                enabled: false,
                providerId,
                customSource,
                snapshot: null
            });
            await syncBackgroundImageAppearance();
            return false;
        }

        await disableCommunityThemesForBackgroundImage();
        await persistState({ enabled: true, mode: 'custom', providerId });
        useBackgroundImageStore.getState().setStateSnapshot({
            mode: 'custom',
            enabled: true,
            providerId,
            customSource,
            snapshot
        });
        await syncBackgroundImageAppearance();
        return true;
    } catch (error) {
        if (!isCurrentBackgroundImageOperation(operationId)) {
            return false;
        }
        await persistState({ enabled: false, mode: 'off', providerId });
        useBackgroundImageStore.getState().setStateSnapshot({
            mode: 'off',
            enabled: false,
            providerId,
            customSource,
            snapshot: null
        });
        await syncBackgroundImageAppearance();
        const message =
            error instanceof Error
                ? error.message
                : 'Failed to enable custom Background Image.';
        store.setError(message);
        throw error;
    } finally {
        if (isCurrentBackgroundImageOperation(operationId)) {
            store.setLoading(false);
        }
    }
}

export async function setBackgroundImageCustomFiles(
    paths: string[]
): Promise<boolean> {
    const source = createBackgroundImageFilesSource(
        paths,
        useBackgroundImageStore.getState().customSource?.rotationInterval ||
            'daily'
    );
    return enableBackgroundImageCustom(source);
}

export async function setBackgroundImageCustomFolder(
    folderPath: string
): Promise<boolean> {
    const source = createBackgroundImageFolderSource(
        folderPath,
        useBackgroundImageStore.getState().customSource?.rotationInterval ||
            'daily'
    );
    return enableBackgroundImageCustom(source);
}

export async function chooseBackgroundImageFiles(): Promise<boolean> {
    const state = useBackgroundImageStore.getState();
    const defaultPath =
        state.customSource?.kind === 'files'
            ? state.customSource.paths[0]
            : state.customSource?.folderPath;
    const paths = await pickBackgroundImageFiles(defaultPath || null);
    if (!paths.length) {
        return false;
    }
    return setBackgroundImageCustomFiles(paths);
}

export async function chooseBackgroundImageFolder(): Promise<boolean> {
    const state = useBackgroundImageStore.getState();
    const defaultPath =
        state.customSource?.kind === 'folder'
            ? state.customSource.folderPath
            : state.customSource?.paths[0];
    const folderPath = await commands.appOpenFolderSelectorDialog(
        defaultPath || null
    );
    if (!folderPath) {
        return false;
    }
    return setBackgroundImageCustomFolder(folderPath);
}

export async function setBackgroundImageCustomRotationInterval(
    rotationInterval: BackgroundImageRotationInterval
): Promise<boolean> {
    const state = useBackgroundImageStore.getState();
    if (!state.customSource) {
        return false;
    }
    const customSource = {
        ...state.customSource,
        rotationInterval
    };
    await persistCustomSource(customSource);
    useBackgroundImageStore.getState().setStateSnapshot({
        mode: state.mode,
        enabled: state.enabled,
        providerId: state.providerId,
        customSource,
        snapshot: state.snapshot
    });
    if (state.enabled && state.mode === 'custom') {
        return enableBackgroundImageCustom(customSource);
    }
    return true;
}

export async function disableBackgroundImage({
    restoreAppTheme = true
}: {
    restoreAppTheme?: boolean;
} = {}): Promise<void> {
    beginBackgroundImageOperation();
    const state = useBackgroundImageStore.getState();
    await persistState({
        enabled: false,
        mode: 'off',
        providerId: state.providerId
    });
    useBackgroundImageStore.getState().setStateSnapshot({
        mode: 'off',
        enabled: false,
        providerId: state.providerId,
        customSource: state.customSource,
        snapshot: state.snapshot
    });
    await syncBackgroundImageAppearance(restoreAppTheme);
    useBackgroundImageStore.getState().setLoading(false);
}

export async function refreshBackgroundImage(): Promise<boolean> {
    const operationId = beginBackgroundImageOperation();
    const state = useBackgroundImageStore.getState();
    const store = useBackgroundImageStore.getState();
    store.setLoading(true);
    store.setError(null);
    try {
        const snapshot =
            state.mode === 'custom'
                ? await resolveCustomSnapshot(state.customSource, true)
                : await resolveProviderSnapshot(state.providerId, true);
        if (!isCurrentBackgroundImageOperation(operationId)) {
            return false;
        }

        if (!snapshot) {
            await disableBackgroundImage();
            return false;
        }

        await persistState({
            enabled: true,
            mode: state.mode === 'custom' ? 'custom' : 'daily',
            providerId: state.providerId
        });
        useBackgroundImageStore.getState().setStateSnapshot({
            mode: state.mode === 'custom' ? 'custom' : 'daily',
            enabled: true,
            providerId: state.providerId,
            customSource: state.customSource,
            snapshot
        });
        await syncBackgroundImageAppearance();
        return true;
    } catch (error) {
        if (!isCurrentBackgroundImageOperation(operationId)) {
            return false;
        }
        if (state.mode === 'custom') {
            await disableBackgroundImage();
        }
        const message =
            error instanceof Error
                ? error.message
                : 'Failed to refresh Background Image.';
        store.setError(message);
        throw error;
    } finally {
        if (isCurrentBackgroundImageOperation(operationId)) {
            store.setLoading(false);
        }
    }
}

export async function migrateLegacyNasaApodCommunityTheme(): Promise<void> {
    const snapshot = useBackgroundImageStore.getState().snapshot;
    await persistState({
        enabled: true,
        mode: 'daily',
        providerId: 'nasa-apod-safe'
    });
    useBackgroundImageStore.getState().setStateSnapshot({
        mode: 'daily',
        enabled: true,
        providerId: 'nasa-apod-safe',
        customSource: useBackgroundImageStore.getState().customSource,
        snapshot: snapshot?.providerId === 'nasa-apod-safe' ? snapshot : null
    });
}

export function isBackgroundImageActive(): boolean {
    return useBackgroundImageStore.getState().enabled;
}

export function getBackgroundImageProviderLabel(
    providerId: BackgroundImageProviderId
): string {
    return resolveBackgroundImageProvider(providerId).name;
}

registerBackgroundImageAppearanceHandlers({
    disableBackgroundImage,
    isBackgroundImageActive,
    migrateLegacyNasaApodCommunityTheme
});

export { backgroundImageRemoteProviders };
