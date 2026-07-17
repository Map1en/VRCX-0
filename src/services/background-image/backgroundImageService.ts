import { commands } from '@/platform/tauri/bindings';
import { BACKGROUND_IMAGE_CONFIG_KEYS } from '@/repositories/configKeys';
import configRepository from '@/repositories/configRepository';
import {
    disableCommunityThemesForBackgroundImage,
    registerBackgroundImageAppearanceHandlers
} from '@/services/appearanceConflictCoordinator';
import { useBackgroundImageStore } from '@/state/backgroundImageStore';

import {
    isCommunityAppearanceActive,
    syncBackgroundImageAppearance
} from './appearanceService';
import {
    createBackgroundImageFilesSource,
    createBackgroundImageFolderSource,
    normalizeBackgroundImageCustomSource,
    pickBackgroundImageFiles
} from './localSourceService';
import {
    loadBackgroundImageCustomSource,
    loadBackgroundImageSnapshots,
    persistBackgroundImageCustomSource,
    persistBackgroundImageState,
    resolveCustomSnapshot,
    resolveProviderSnapshot
} from './persistenceService';
import {
    backgroundImageRemoteProviders,
    DEFAULT_BACKGROUND_IMAGE_PROVIDER_ID,
    resolveBackgroundImageProvider
} from './remoteProviders';
import {
    normalizeBackgroundImageMode,
    normalizeBackgroundImageProviderId
} from './snapshotNormalization';
import type {
    BackgroundImageCustomSource,
    BackgroundImageMode,
    BackgroundImageProviderId,
    BackgroundImageRotationInterval,
    BackgroundImageSnapshot
} from './types';

let backgroundImageOperationId = 0;

function beginBackgroundImageOperation(): number {
    backgroundImageOperationId += 1;
    return backgroundImageOperationId;
}

function isCurrentBackgroundImageOperation(operationId: number): boolean {
    return operationId === backgroundImageOperationId;
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
    const mode = normalizeBackgroundImageMode(
        await configRepository.getString(
            BACKGROUND_IMAGE_CONFIG_KEYS.mode,
            enabled ? 'daily' : 'off'
        )
    );
    const providerId = normalizeBackgroundImageProviderId(
        await configRepository.getString(
            BACKGROUND_IMAGE_CONFIG_KEYS.providerId,
            await configRepository.getString(
                BACKGROUND_IMAGE_CONFIG_KEYS.legacyProviderId,
                DEFAULT_BACKGROUND_IMAGE_PROVIDER_ID
            )
        )
    );
    const customSource = await loadBackgroundImageCustomSource();
    let snapshot: BackgroundImageSnapshot | null = null;
    let nextEnabled = Boolean(enabled && mode !== 'off');
    let nextMode = mode;

    if (nextEnabled && mode === 'daily') {
        const snapshots = await loadBackgroundImageSnapshots();
        snapshot = await resolveProviderSnapshot(providerId).catch((error) => {
            console.warn('Unable to initialize Background Image:', error);
            return snapshots[providerId] ?? null;
        });
        nextEnabled = Boolean(snapshot && !isCommunityAppearanceActive());
    } else if (nextEnabled && mode === 'custom') {
        snapshot = await resolveCustomSnapshot(
            customSource,
            useBackgroundImageStore.getState().snapshot
        ).catch((error: unknown): null => {
            console.warn(
                'Unable to initialize custom Background Image:',
                error
            );
            return null;
        });
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
    await persistBackgroundImageState({
        enabled: nextEnabled,
        mode: nextMode,
        providerId
    });
    await syncBackgroundImageAppearance(refreshBackgroundImage, false);
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
        await persistBackgroundImageState({
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
        await syncBackgroundImageAppearance(refreshBackgroundImage);
        return false;
    }
    return enableBackgroundImageCustom();
}

export async function setBackgroundImageProvider(
    providerIdInput: unknown
): Promise<void> {
    const providerId = normalizeBackgroundImageProviderId(providerIdInput);
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
            await persistBackgroundImageState({
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
            await syncBackgroundImageAppearance(refreshBackgroundImage);
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
    const snapshots = await loadBackgroundImageSnapshots();
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
    await syncBackgroundImageAppearance(refreshBackgroundImage);
}

export async function enableBackgroundImageDaily(
    providerIdInput?: unknown
): Promise<boolean> {
    const operationId = beginBackgroundImageOperation();
    const providerId = normalizeBackgroundImageProviderId(
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
        await persistBackgroundImageState({
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
        await syncBackgroundImageAppearance(refreshBackgroundImage);
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
        (await loadBackgroundImageCustomSource());
    store.setLoading(true);
    store.setError(null);
    try {
        await persistBackgroundImageCustomSource(customSource);
        const snapshot = await resolveCustomSnapshot(customSource);
        if (!isCurrentBackgroundImageOperation(operationId)) {
            return false;
        }
        if (!snapshot || !customSource) {
            await persistBackgroundImageState({
                enabled: false,
                mode: 'custom',
                providerId
            });
            useBackgroundImageStore.getState().setStateSnapshot({
                mode: 'custom',
                enabled: false,
                providerId,
                customSource,
                snapshot: null
            });
            await syncBackgroundImageAppearance(refreshBackgroundImage);
            return false;
        }

        await disableCommunityThemesForBackgroundImage();
        await persistBackgroundImageState({
            enabled: true,
            mode: 'custom',
            providerId
        });
        useBackgroundImageStore.getState().setStateSnapshot({
            mode: 'custom',
            enabled: true,
            providerId,
            customSource,
            snapshot
        });
        await syncBackgroundImageAppearance(refreshBackgroundImage);
        return true;
    } catch (error) {
        if (!isCurrentBackgroundImageOperation(operationId)) {
            return false;
        }
        await persistBackgroundImageState({
            enabled: false,
            mode: 'off',
            providerId
        });
        useBackgroundImageStore.getState().setStateSnapshot({
            mode: 'off',
            enabled: false,
            providerId,
            customSource,
            snapshot: null
        });
        await syncBackgroundImageAppearance(refreshBackgroundImage);
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
    await persistBackgroundImageCustomSource(customSource);
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
    await persistBackgroundImageState({
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
    await syncBackgroundImageAppearance(
        refreshBackgroundImage,
        restoreAppTheme
    );
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
                ? await resolveCustomSnapshot(
                      state.customSource,
                      useBackgroundImageStore.getState().snapshot
                  )
                : await resolveProviderSnapshot(state.providerId, true);
        if (!isCurrentBackgroundImageOperation(operationId)) {
            return false;
        }

        if (!snapshot) {
            await disableBackgroundImage();
            return false;
        }

        await persistBackgroundImageState({
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
        await syncBackgroundImageAppearance(refreshBackgroundImage);
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
    await persistBackgroundImageState({
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
