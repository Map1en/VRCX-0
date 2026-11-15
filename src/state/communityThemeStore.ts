import { create } from 'zustand';

import type {
    CommunityThemeInstallMetadata,
    CommunityThemeLocalPreview,
    CommunityThemeManifest
} from '@/domain/themes/types';
import type { CommunityThemeUpdate } from '@/platform/tauri/bindings';

interface CommunityThemeLocalPreviewWatch {
    enabled: boolean;
    folderPath: string;
    error: string | null;
}

interface CommunityThemeStore {
    catalogUrl: string;
    catalog: CommunityThemeManifest[];
    enabled: boolean;
    installedTheme: CommunityThemeInstallMetadata | null;
    installedThemes: CommunityThemeInstallMetadata[];
    updates: CommunityThemeUpdate[];
    localPreview: CommunityThemeLocalPreview | null;
    localPreviewWatch: CommunityThemeLocalPreviewWatch;
    overrideCssLength: number;
    accentOverride: boolean;
    loading: boolean;
    error: string | null;
    setCatalog(catalogUrl: string, catalog: CommunityThemeManifest[]): void;
    hydrate(options: {
        catalogUrl: string;
        enabled: boolean;
        installedTheme: CommunityThemeInstallMetadata | null;
        installedThemes?: CommunityThemeInstallMetadata[];
        overrideCssLength: number;
        localPreview?: CommunityThemeLocalPreview | null;
    }): void;
    setInstalledState(options: {
        enabled: boolean;
        installedTheme: CommunityThemeInstallMetadata | null;
        installedThemes?: CommunityThemeInstallMetadata[];
        updates?: CommunityThemeUpdate[];
    }): void;
    setLocalPreview(localPreview: CommunityThemeLocalPreview | null): void;
    setLocalPreviewWatch(
        localPreviewWatch: Partial<CommunityThemeLocalPreviewWatch>
    ): void;
    setOverrideCssLength(length: number): void;
    setAccentOverride(accentOverride: boolean): void;
    setLoading(loading: boolean): void;
    setError(error: string | null): void;
}

export function communityThemeControlsAccent(
    enabled: boolean,
    installedTheme: CommunityThemeInstallMetadata | null,
    localPreview: CommunityThemeLocalPreview | null = null
): boolean {
    if (localPreview) {
        return !localPreview.accentMode;
    }
    return enabled && installedTheme !== null && !installedTheme.accentMode;
}

export function communityThemeControlsAppearance(
    enabled: boolean,
    installedTheme: CommunityThemeInstallMetadata | null,
    localPreview: CommunityThemeLocalPreview | null = null
): boolean {
    return localPreview !== null || (enabled && installedTheme !== null);
}

export function resolveCommunityThemeBaseMode(
    enabled: boolean,
    installedTheme: CommunityThemeInstallMetadata | null,
    localPreview: CommunityThemeLocalPreview | null = null
): 'dark' | 'light' {
    if (localPreview) {
        return localPreview.darkMode ? 'dark' : 'light';
    }
    if (enabled && installedTheme) {
        return installedTheme.darkMode ? 'dark' : 'light';
    }
    return 'dark';
}

export const useCommunityThemeStore = create<CommunityThemeStore>((set) => ({
    catalogUrl: '',
    catalog: [],
    enabled: false,
    installedTheme: null,
    installedThemes: [],
    updates: [],
    localPreview: null,
    localPreviewWatch: {
        enabled: false,
        folderPath: '',
        error: null
    },
    overrideCssLength: 0,
    accentOverride: false,
    loading: false,
    error: null,
    setCatalog(catalogUrl, catalog) {
        set({ catalogUrl, catalog });
    },
    hydrate({
        catalogUrl,
        enabled,
        installedTheme,
        installedThemes,
        overrideCssLength,
        localPreview
    }) {
        set({
            catalogUrl,
            enabled: enabled && installedTheme !== null,
            installedTheme,
            installedThemes:
                installedThemes ??
                (installedTheme !== null ? [installedTheme] : []),
            localPreview: localPreview ?? null,
            localPreviewWatch: {
                enabled: false,
                folderPath: '',
                error: null
            },
            overrideCssLength: Math.max(0, overrideCssLength || 0)
        });
    },
    setInstalledState({ enabled, installedTheme, installedThemes, updates }) {
        set({
            enabled: enabled && installedTheme !== null,
            installedTheme,
            ...(installedThemes !== undefined ? { installedThemes } : {}),
            ...(updates !== undefined ? { updates } : {})
        });
    },
    setLocalPreview(localPreview) {
        set({ localPreview });
    },
    setLocalPreviewWatch(localPreviewWatch) {
        set((state) => ({
            localPreviewWatch: {
                ...state.localPreviewWatch,
                ...localPreviewWatch
            }
        }));
    },
    setOverrideCssLength(length) {
        set({ overrideCssLength: Math.max(0, length || 0) });
    },
    setAccentOverride(accentOverride) {
        set({ accentOverride });
    },
    setLoading(loading) {
        set({ loading });
    },
    setError(error) {
        set({ error });
    }
}));
