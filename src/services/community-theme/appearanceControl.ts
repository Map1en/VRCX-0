import { APP_THEME_CONFIG_KEYS } from '@/repositories/configKeys';
import configRepository from '@/repositories/configRepository';
import { isBackgroundImageAppearanceActive } from '@/services/appearanceConflictCoordinator';
import {
    communityThemeControlsAccent,
    communityThemeControlsAppearance,
    resolveCommunityThemeBaseMode,
    useCommunityThemeStore
} from '@/state/communityThemeStore';

import {
    applyThemeColor,
    clearThemeColorInlineProperties,
    resolveThemeColor,
    resolveThemeMode,
    setCommunityThemeAppearanceControl
} from '../themeService';

const COMMUNITY_THEME_ACCENT_ATTR = 'data-vrcx-0-community-theme-accent';

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

export async function syncCommunityThemeAppearanceControl(): Promise<void> {
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

export async function syncCommunityThemeAccentControl(): Promise<void> {
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

export function isCommunityThemeAccentControlled(): boolean {
    const state = useCommunityThemeStore.getState();
    return communityThemeControlsAccent(
        state.enabled,
        state.installedTheme,
        state.localPreview
    );
}
