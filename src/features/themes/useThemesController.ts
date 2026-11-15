import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type {
    CommunityThemeInstallMetadata,
    CommunityThemeManifest,
    CommunityThemeStatsById
} from '@/domain/themes/types';
import { commands } from '@/platform/tauri/bindings';
import {
    type BackgroundImageSelectionMode,
    disableBackgroundImage,
    setBackgroundImageMode
} from '@/services/background-image/backgroundImageService';
import {
    clearCommunityThemeOverrideCss,
    deleteInstalledCommunityTheme,
    disableCommunityThemeOverrideCss,
    disableInstalledCommunityTheme,
    enableInstalledCommunityTheme,
    getCommunityThemeOverrideCssSnapshot,
    installCommunityTheme,
    loadCatalog,
    loadCommunityThemeStats,
    loadLocalCommunityThemePreview,
    reportCommunityThemeInstall,
    saveCommunityThemeOverrideCss,
    setCommunityThemeAccentOverride,
    startLocalCommunityThemePreviewWatch,
    stopLocalCommunityThemePreview,
    stopLocalCommunityThemePreviewWatch
} from '@/services/communityThemeService';
import {
    setThemeColorPreference,
    setThemeModePreference
} from '@/services/preferencesService';
import { toast } from '@/services/toastService';
import { isDevToolsBuild } from '@/shared/buildLabel';
import { communityThemeControlsAccent } from '@/state/communityThemeStore';
import { useModalStore } from '@/state/modalStore';
import type { ThemeMode } from '@/state/shellStore';

import { updateCommunityTheme } from './communityThemeUpdate';
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
        updates,
        localPreview,
        localPreviewWatch,
        overrideCssLength,
        accentOverride,
        loading,
        error
    } = useThemesRuntimeState();
    const confirm = useModalStore((state) => state.confirm);
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
        loadCatalog().catch(() => {});
        setOverrideDraft(getCommunityThemeOverrideCssSnapshot());
    }, []);

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
            toast.add({
                type: 'success',
                title: t('view.community_themes.toast.theme_enabled')
            });
        } catch (installError) {
            toast.add({
                type: 'error',
                title:
                    installError instanceof Error
                        ? installError.message
                        : t('view.community_themes.toast.theme_failed')
            });
        }
    }

    async function disableTheme() {
        try {
            await disableInstalledCommunityTheme();
            toast.add({
                type: 'success',
                title: t('view.community_themes.toast.theme_disabled')
            });
        } catch (disableError) {
            toast.add({
                type: 'error',
                title:
                    disableError instanceof Error
                        ? disableError.message
                        : t('view.community_themes.toast.disable_failed')
            });
        }
    }

    async function deleteTheme(themeId?: string) {
        const result = await confirm({
            title: t('view.community_themes.confirm.delete_theme_title'),
            description: t(
                'view.community_themes.confirm.delete_theme_description'
            ),
            confirmText: t('common.actions.delete'),
            cancelText: t('common.actions.cancel'),
            destructive: true
        });
        if (!result.ok) {
            return;
        }
        try {
            await deleteInstalledCommunityTheme(themeId);
            toast.add({
                type: 'success',
                title: t('view.community_themes.toast.theme_deleted')
            });
        } catch (deleteError) {
            toast.add({
                type: 'error',
                title:
                    deleteError instanceof Error
                        ? deleteError.message
                        : t('view.community_themes.toast.disable_failed')
            });
        }
    }

    function updateTheme(themeId: string) {
        void updateCommunityTheme(themeId, t);
    }

    async function enableTheme(themeId?: string) {
        try {
            await enableInstalledCommunityTheme(themeId);
            toast.add({
                type: 'success',
                title: t('view.community_themes.toast.theme_enabled')
            });
        } catch (enableError) {
            toast.add({
                type: 'error',
                title:
                    enableError instanceof Error
                        ? enableError.message
                        : t('view.community_themes.toast.theme_failed')
            });
        }
    }

    async function saveOverride() {
        try {
            await saveCommunityThemeOverrideCss(overrideDraft);
            toast.add({
                type: 'success',
                title: t('view.community_themes.toast.override_saved')
            });
        } catch (saveError) {
            toast.add({
                type: 'error',
                title:
                    saveError instanceof Error
                        ? saveError.message
                        : t('view.community_themes.toast.theme_failed')
            });
        }
    }

    async function clearOverride() {
        const result = await confirm({
            title: t('view.community_themes.confirm.clear_override_title'),
            description: t(
                'view.community_themes.confirm.clear_override_description'
            ),
            confirmText: t('common.actions.clear'),
            cancelText: t('common.actions.cancel'),
            destructive: true
        });
        if (!result.ok) {
            return;
        }
        try {
            await clearCommunityThemeOverrideCss();
            setOverrideDraft('');
            toast.add({
                type: 'success',
                title: t('view.community_themes.toast.override_cleared')
            });
        } catch (clearError) {
            toast.add({
                type: 'error',
                title:
                    clearError instanceof Error
                        ? clearError.message
                        : t('view.community_themes.toast.disable_failed')
            });
        }
    }

    async function disableOverride() {
        try {
            await disableCommunityThemeOverrideCss();
            toast.add({
                type: 'success',
                title: t('view.community_themes.toast.override_disabled')
            });
        } catch (disableError) {
            toast.add({
                type: 'error',
                title:
                    disableError instanceof Error
                        ? disableError.message
                        : t('view.community_themes.toast.disable_failed')
            });
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
            toast.add({
                type: 'error',
                title:
                    sourceError instanceof Error
                        ? sourceError.message
                        : t('view.themes.toast.source_failed')
            });
        }
    }

    async function selectBackgroundSource() {
        setSelectedSource('background');
        try {
            let nextMode: BackgroundImageSelectionMode = 'daily';
            if (
                backgroundImageMode === 'custom' &&
                backgroundImageCustomSource
            ) {
                nextMode = 'custom';
            } else if (backgroundImageMode === 'decoration') {
                nextMode = 'decoration';
            }
            if (nextMode === 'decoration') {
                if (enabled) {
                    await disableInstalledCommunityTheme();
                }
                if (localPreview) {
                    await stopLocalCommunityThemePreview();
                }
            }
            await setBackgroundImageMode(nextMode);
        } catch (sourceError) {
            toast.add({
                type: 'error',
                title:
                    sourceError instanceof Error
                        ? sourceError.message
                        : t('view.background_image.toast.failed')
            });
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
            toast.add({
                type: 'error',
                title:
                    sourceError instanceof Error
                        ? sourceError.message
                        : t('view.community_themes.toast.theme_failed')
            });
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
            toast.add({
                type: 'success',
                title: t('view.community_themes.developer.loaded')
            });
        } catch (loadError) {
            const message =
                loadError instanceof Error
                    ? loadError.message
                    : t('view.community_themes.developer.load_failed');
            toast.add({ type: 'error', title: message });
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
            toast.add({
                type: 'error',
                title:
                    pickError instanceof Error
                        ? pickError.message
                        : t('view.community_themes.developer.load_failed')
            });
        }
    }

    async function stopLocalPreview() {
        try {
            stopLocalCommunityThemePreviewWatch();
            await stopLocalCommunityThemePreview();
            toast.add({
                type: 'success',
                title: t('view.community_themes.developer.stopped')
            });
        } catch (stopError) {
            toast.add({
                type: 'error',
                title:
                    stopError instanceof Error
                        ? stopError.message
                        : t('view.community_themes.toast.disable_failed')
            });
        }
    }

    const themeControlsAccent = communityThemeControlsAccent(
        enabled,
        installedTheme,
        localPreview
    );
    const accentControlled = themeControlsAccent && !accentOverride;
    const accentThemeName =
        localPreview?.themeName ?? installedTheme?.themeName ?? '';
    const installedThemeById = new Map<string, CommunityThemeInstallMetadata>(
        installedThemes.map((theme: CommunityThemeInstallMetadata) => [
            theme.themeId,
            theme
        ])
    );
    const updateByThemeId = new Map(
        updates.map((update) => [update.themeId, update])
    );
    const appearanceControlled = activeSource !== 'built-in';
    const customCssBadge = overrideCssLength
        ? t('view.themes.summary.custom_css_on')
        : '';

    async function updateThemeMode(nextThemeMode: ThemeMode) {
        if (appearanceControlled) {
            return;
        }
        try {
            await setThemeModePreference(nextThemeMode);
        } catch (modeError) {
            toast.add({
                type: 'error',
                title:
                    modeError instanceof Error
                        ? modeError.message
                        : t('view.themes.toast.source_failed')
            });
        }
    }

    async function updateThemeColor(nextThemeColor: string) {
        if (accentControlled) {
            return;
        }
        try {
            await setThemeColorPreference(nextThemeColor);
        } catch (colorError) {
            toast.add({
                type: 'error',
                title:
                    colorError instanceof Error
                        ? colorError.message
                        : t('view.themes.toast.source_failed')
            });
        }
    }

    async function updateAccentOverride(nextAccentOverride: boolean) {
        try {
            await setCommunityThemeAccentOverride(nextAccentOverride);
        } catch (overrideError) {
            toast.add({
                type: 'error',
                title:
                    overrideError instanceof Error
                        ? overrideError.message
                        : t('view.themes.toast.source_failed')
            });
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
        updateByThemeId,
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
        themeControlsAccent,
        accentOverride,
        accentThemeName,
        customCssBadge,
        installTheme,
        disableTheme,
        deleteTheme,
        enableTheme,
        updateTheme,
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
        updateThemeColor,
        updateAccentOverride
    };
}
