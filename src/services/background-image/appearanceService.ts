import { APP_THEME_CONFIG_KEYS } from '@/repositories/configKeys';
import configRepository from '@/repositories/configRepository';
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
} from '../vrcx0CssLayerService';
import {
    clearBackgroundImageRotationTimer,
    scheduleBackgroundImageRotation
} from './rotationController';
import type { BackgroundImageSnapshot } from './types';

const BACKGROUND_IMAGE_LAYER = 'background-image';
const COMMUNITY_CSS_LAYERS: VrcxCssLayer[] = [
    'installed-theme',
    'local-theme-preview'
];

function toCssString(value: string): string {
    return `"${String(value || '')
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\A ')}"`;
}

export function buildBackgroundImageCss(
    snapshot: BackgroundImageSnapshot
): string {
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

export function isCommunityAppearanceActive(): boolean {
    const state = useCommunityThemeStore.getState();
    return communityThemeControlsAppearance(
        state.enabled,
        state.installedTheme,
        state.localPreview
    );
}

export async function syncBackgroundImageAppearance(
    refreshBackgroundImage: () => Promise<boolean>,
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
        scheduleBackgroundImageRotation(refreshBackgroundImage);
        return;
    }

    clearBackgroundImageRotationTimer();
    if (restoreAppTheme && !isCommunityAppearanceActive()) {
        await applySavedThemeMode();
        await applySavedThemeColor();
    }
}
