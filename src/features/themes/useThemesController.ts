import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { commands } from '@/platform/tauri/bindings';
import type { CommunityThemeStatsById } from '@/repositories/communityThemeRepository';
import {
    loadCommunityThemeStats,
    reportCommunityThemeInstall
} from '@/repositories/communityThemeRepository';
import {
    disableBackgroundImage,
    setBackgroundImageMode
} from '@/services/background-image/backgroundImageService';
import type { BackgroundImageMode } from '@/services/background-image/types';
import {
    clearCommunityThemeOverrideCss,
    deleteInstalledCommunityTheme,
    disableCommunityThemeOverrideCss,
    disableInstalledCommunityTheme,
    enableInstalledCommunityTheme,
    getCommunityThemeOverrideCssSnapshot,
    installCommunityTheme,
    loadCatalog,
    loadLocalCommunityThemePreview,
    saveCommunityThemeOverrideCss,
    startLocalCommunityThemePreviewWatch,
    stopLocalCommunityThemePreview,
    stopLocalCommunityThemePreviewWatch
} from '@/services/communityThemeService';
import {
    setThemeColorPreference,
    setThemeModePreference
} from '@/services/preferencesService';
import { isDevToolsBuild } from '@/shared/buildLabel';
import { communityThemeControlsAccent } from '@/state/communityThemeStore';

import type {
    CommunityThemeInstallMetadata,
    CommunityThemeManifest
} from './communityThemeTypes';
import { resolveActiveThemeSource, type ThemeSource } from './themeHelpers';
import { useThemesRuntimeState } from './useThemesRuntimeState';

export function useThemesController() {
    const { t } = useTranslation();
    const {
        themeMode,
        themeColor,
        backgroundImageEnabled,
        backgroundImageMode,
        backgroundImageCustomSource,
        catalog,
        enabled,
        installedTheme,
        installedThemes,
        localPreview,
        localPreviewWatch,
        overrideCssLength,
        loading,
        error
    } = useThemesRuntimeState();
    const [overrideDraft, setOverrideDraft] = useState('');
    const [customCssOpen, setCustomCssOpen] = useState(
        Boolean(overrideCssLength)
    );
    const [devFolderPath, setDevFolderPath] = useState(
        localPreview?.folderPath || localPreviewWatch.folderPath || ''
    );
    const [devLoading, setDevLoading] = useState(false);
    const [devSectionOpen, setDevSectionOpen] = useState(false);
    const [themeStatsById, setThemeStatsById] =
        useState<CommunityThemeStatsById>({});
    const devWatchEnabled = Boolean(localPreviewWatch.enabled);
    const devError = localPreviewWatch.error;
    const developerToolsAvailable = isDevToolsBuild();
    const activeSource = resolveActiveThemeSource(
        backgroundImageEnabled,
        enabled,
        localPreview
    );
    const [selectedSource, setSelectedSource] =
        useState<ThemeSource>(activeSource);
    const visibleSource =
        activeSource === 'built-in' ? selectedSource : activeSource;

    useEffect(() => {
        loadCatalog().catch((loadError: any) => {
            toast.error(
                loadError instanceof Error
                    ? loadError.message
                    : t('view.community_themes.toast.catalog_failed')
            );
        });
        setOverrideDraft(getCommunityThemeOverrideCssSnapshot());
    }, [t]);

    useEffect(() => {
        let disposed = false;
        loadCommunityThemeStats()
            .then((stats) => {
                if (!disposed) {
                    setThemeStatsById(stats);
                }
            })
            .catch(() => {
                if (!disposed) {
                    setThemeStatsById({});
                }
            });

        return () => {
            disposed = true;
        };
    }, []);

    useEffect(() => {
        if (activeSource !== 'built-in') {
            setSelectedSource(activeSource);
        }
    }, [activeSource]);

    useEffect(() => {
        if (localPreview?.folderPath) {
            setDevFolderPath(localPreview.folderPath);
            return;
        }
        if (localPreviewWatch.folderPath) {
            setDevFolderPath(localPreviewWatch.folderPath);
        }
    }, [localPreview?.folderPath, localPreviewWatch.folderPath]);

    useEffect(() => {
        if (overrideCssLength) {
            setCustomCssOpen(true);
        }
    }, [overrideCssLength]);

    async function installTheme(theme: CommunityThemeManifest) {
        try {
            await installCommunityTheme(theme);
            void reportCommunityThemeInstall(theme.id).then((reported) => {
                if (!reported) {
                    return;
                }
                setThemeStatsById((currentStats) => ({
                    ...currentStats,
                    [theme.id]: {
                        downloads: (currentStats[theme.id]?.downloads ?? 0) + 1
                    }
                }));
            });
            toast.success(t('view.community_themes.toast.theme_enabled'));
        } catch (installError) {
            toast.error(
                installError instanceof Error
                    ? installError.message
                    : t('view.community_themes.toast.theme_failed')
            );
        }
    }

    async function disableTheme() {
        try {
            await disableInstalledCommunityTheme();
            toast.success(t('view.community_themes.toast.theme_disabled'));
        } catch (disableError) {
            toast.error(
                disableError instanceof Error
                    ? disableError.message
                    : t('view.community_themes.toast.disable_failed')
            );
        }
    }

    async function deleteTheme(themeId?: string) {
        try {
            await deleteInstalledCommunityTheme(themeId);
            toast.success(t('view.community_themes.toast.theme_deleted'));
        } catch (deleteError) {
            toast.error(
                deleteError instanceof Error
                    ? deleteError.message
                    : t('view.community_themes.toast.disable_failed')
            );
        }
    }

    async function enableTheme(themeId?: string) {
        try {
            await enableInstalledCommunityTheme(themeId);
            toast.success(t('view.community_themes.toast.theme_enabled'));
        } catch (enableError) {
            toast.error(
                enableError instanceof Error
                    ? enableError.message
                    : t('view.community_themes.toast.theme_failed')
            );
        }
    }

    async function saveOverride() {
        try {
            await saveCommunityThemeOverrideCss(overrideDraft);
            toast.success(t('view.community_themes.toast.override_saved'));
        } catch (saveError) {
            toast.error(
                saveError instanceof Error
                    ? saveError.message
                    : t('view.community_themes.toast.theme_failed')
            );
        }
    }

    async function clearOverride() {
        try {
            await clearCommunityThemeOverrideCss();
            setOverrideDraft('');
            toast.success(t('view.community_themes.toast.override_cleared'));
        } catch (clearError) {
            toast.error(
                clearError instanceof Error
                    ? clearError.message
                    : t('view.community_themes.toast.disable_failed')
            );
        }
    }

    async function disableOverride() {
        try {
            await disableCommunityThemeOverrideCss();
            toast.success(t('view.community_themes.toast.override_disabled'));
        } catch (disableError) {
            toast.error(
                disableError instanceof Error
                    ? disableError.message
                    : t('view.community_themes.toast.disable_failed')
            );
        }
    }

    async function selectBuiltInSource() {
        setSelectedSource('built-in');
        try {
            if (backgroundImageEnabled) {
                await disableBackgroundImage();
            }
            if (enabled) {
                await disableInstalledCommunityTheme();
            }
            if (localPreview) {
                await stopLocalCommunityThemePreview();
            }
        } catch (sourceError) {
            toast.error(
                sourceError instanceof Error
                    ? sourceError.message
                    : t('view.themes.toast.source_failed')
            );
        }
    }

    async function selectBackgroundSource() {
        setSelectedSource('background');
        try {
            const nextMode: BackgroundImageMode =
                backgroundImageMode === 'custom' && backgroundImageCustomSource
                    ? 'custom'
                    : 'daily';
            await setBackgroundImageMode(nextMode);
        } catch (sourceError) {
            toast.error(
                sourceError instanceof Error
                    ? sourceError.message
                    : t('view.background_image.toast.failed')
            );
        }
    }

    async function selectCommunitySource() {
        setSelectedSource('community');
        try {
            if (backgroundImageEnabled) {
                await disableBackgroundImage({ restoreAppTheme: false });
            }
            if (!enabled && installedTheme) {
                await enableInstalledCommunityTheme(installedTheme.themeId);
            }
        } catch (sourceError) {
            toast.error(
                sourceError instanceof Error
                    ? sourceError.message
                    : t('view.community_themes.toast.theme_failed')
            );
        }
    }

    async function loadLocalPreview(folderPath = devFolderPath) {
        const nextFolderPath = folderPath.trim();
        if (!nextFolderPath) {
            return;
        }
        setDevLoading(true);
        try {
            await loadLocalCommunityThemePreview(nextFolderPath);
            if (devWatchEnabled) {
                startLocalCommunityThemePreviewWatch(nextFolderPath);
            }
            toast.success(t('view.community_themes.developer.loaded'));
        } catch (loadError) {
            const message =
                loadError instanceof Error
                    ? loadError.message
                    : t('view.community_themes.developer.load_failed');
            toast.error(message);
        } finally {
            setDevLoading(false);
        }
    }

    function toggleLocalPreviewWatch() {
        if (devWatchEnabled) {
            stopLocalCommunityThemePreviewWatch();
            return;
        }

        const nextFolderPath = devFolderPath.trim();
        if (!nextFolderPath) {
            return;
        }
        startLocalCommunityThemePreviewWatch(nextFolderPath);
    }

    async function pickLocalThemeFolder() {
        try {
            const folderPath = await commands.appOpenFolderSelectorDialog(
                devFolderPath || localPreview?.folderPath || null
            );
            if (!folderPath) {
                return;
            }
            setDevFolderPath(folderPath);
            await loadLocalPreview(folderPath);
        } catch (pickError) {
            toast.error(
                pickError instanceof Error
                    ? pickError.message
                    : t('view.community_themes.developer.load_failed')
            );
        }
    }

    async function stopLocalPreview() {
        try {
            stopLocalCommunityThemePreviewWatch();
            await stopLocalCommunityThemePreview();
            toast.success(t('view.community_themes.developer.stopped'));
        } catch (stopError) {
            toast.error(
                stopError instanceof Error
                    ? stopError.message
                    : t('view.community_themes.toast.disable_failed')
            );
        }
    }

    const accentControlled = communityThemeControlsAccent(
        enabled,
        installedTheme,
        localPreview
    );
    const installedThemeById = new Map<string, CommunityThemeInstallMetadata>(
        installedThemes.map((theme: CommunityThemeInstallMetadata) => [
            theme.themeId,
            theme
        ])
    );
    const appearanceControlled = activeSource !== 'built-in';
    const customCssBadge = overrideCssLength
        ? t('view.themes.summary.custom_css_on')
        : '';

    async function updateThemeMode(nextThemeMode: string) {
        if (appearanceControlled) {
            return;
        }
        try {
            await setThemeModePreference(nextThemeMode);
        } catch (modeError) {
            toast.error(
                modeError instanceof Error
                    ? modeError.message
                    : t('view.themes.toast.source_failed')
            );
        }
    }

    async function updateThemeColor(nextThemeColor: string) {
        if (accentControlled) {
            return;
        }
        try {
            await setThemeColorPreference(nextThemeColor);
        } catch (colorError) {
            toast.error(
                colorError instanceof Error
                    ? colorError.message
                    : t('view.themes.toast.source_failed')
            );
        }
    }

    return {
        themeMode,
        themeColor,
        catalog,
        enabled,
        installedTheme,
        installedThemes,
        installedThemeById,
        localPreview,
        overrideCssLength,
        loading,
        error,
        overrideDraft,
        setOverrideDraft,
        customCssOpen,
        setCustomCssOpen,
        devFolderPath,
        devLoading,
        devSectionOpen,
        setDevSectionOpen,
        themeStatsById,
        devWatchEnabled,
        devError,
        developerToolsAvailable,
        visibleSource,
        accentControlled,
        customCssBadge,
        installTheme,
        disableTheme,
        deleteTheme,
        enableTheme,
        saveOverride,
        clearOverride,
        disableOverride,
        selectBuiltInSource,
        selectBackgroundSource,
        selectCommunitySource,
        loadLocalPreview,
        toggleLocalPreviewWatch,
        pickLocalThemeFolder,
        stopLocalPreview,
        updateThemeMode,
        updateThemeColor
    };
}
