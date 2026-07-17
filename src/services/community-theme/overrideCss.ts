import { COMMUNITY_THEME_CONFIG_KEYS } from '@/repositories/configKeys';
import configRepository from '@/repositories/configRepository';
import { useCommunityThemeStore } from '@/state/communityThemeStore';

import {
    setCommunityThemeOverrideCssEnabled,
    setCommunityThemeOverrideCssSnapshot,
    syncCommunityStyleLayers
} from './styleLayers';

export async function saveCommunityThemeOverrideCss(
    cssText: string
): Promise<void> {
    const cssSnapshot = String(cssText || '');
    const enabled = Boolean(cssSnapshot.trim());
    setCommunityThemeOverrideCssSnapshot(cssSnapshot, enabled);
    await Promise.all([
        configRepository.setString(
            COMMUNITY_THEME_CONFIG_KEYS.overrideCss,
            cssSnapshot
        ),
        configRepository.setBool(
            COMMUNITY_THEME_CONFIG_KEYS.overrideCssEnabled,
            enabled
        )
    ]);
    useCommunityThemeStore
        .getState()
        .setOverrideCssLength(enabled ? cssSnapshot.length : 0);
    syncCommunityStyleLayers();
}

export async function clearCommunityThemeOverrideCss(): Promise<void> {
    await saveCommunityThemeOverrideCss('');
}

export async function disableCommunityThemeOverrideCss(): Promise<void> {
    setCommunityThemeOverrideCssEnabled(false);
    await configRepository.setBool(
        COMMUNITY_THEME_CONFIG_KEYS.overrideCssEnabled,
        false
    );
    useCommunityThemeStore.getState().setOverrideCssLength(0);
    syncCommunityStyleLayers();
}

export { getCommunityThemeOverrideCssSnapshot } from './styleLayers';
