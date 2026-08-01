import type { CommunityThemeLocalPreview } from '@/features/themes/communityThemeTypes';
import { commands } from '@/platform/tauri/bindings';
import { disableBackgroundImageForCommunityTheme } from '@/services/appearanceConflictCoordinator';
import { isDevToolsBuild } from '@/shared/buildLabel';
import { useCommunityThemeStore } from '@/state/communityThemeStore';

import {
    syncCommunityThemeAccentControl,
    syncCommunityThemeAppearanceControl
} from './appearanceControl';
import {
    rewriteLocalThemeAssetUrls,
    setLocalPreviewCssSnapshot,
    syncCommunityStyleLayers
} from './styleLayers';

const LOCAL_PREVIEW_WATCH_INTERVAL_MS = 1200;

let localPreviewWatchTimer: number | null = null;
let localPreviewWatchFolderPath = '';
let localPreviewWatchReloading = false;
let localPreviewWatchGeneration = 0;

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
    const loadedAt = new Date().toISOString();
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
    setLocalPreviewCssSnapshot(cssText);

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
    setLocalPreviewCssSnapshot('');
    useCommunityThemeStore.getState().setLocalPreview(null);
    syncCommunityStyleLayers();
    await syncCommunityThemeAppearanceControl();
    await syncCommunityThemeAccentControl();
}
