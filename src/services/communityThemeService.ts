import { registerCommunityThemeAppearanceHandlers } from './appearanceConflictCoordinator';
import { refreshCommunityThemeProjection } from './community-theme/installedThemes';
import { stopLocalCommunityThemePreview } from './community-theme/localPreview';

export {
    deleteInstalledCommunityTheme,
    disableInstalledCommunityTheme,
    enableInstalledCommunityTheme,
    initializeCommunityThemes,
    installCommunityTheme,
    loadCatalog,
    loadCommunityThemeStats,
    reportCommunityThemeInstall,
    updateInstalledCommunityTheme
} from './community-theme/installedThemes';
export { setCommunityThemeAccentOverride } from './community-theme/appearanceControl';
export {
    loadLocalCommunityThemePreview,
    startLocalCommunityThemePreviewWatch,
    stopLocalCommunityThemePreview,
    stopLocalCommunityThemePreviewWatch
} from './community-theme/localPreview';
export {
    clearCommunityThemeOverrideCss,
    disableCommunityThemeOverrideCss,
    getCommunityThemeOverrideCssSnapshot,
    saveCommunityThemeOverrideCss
} from './community-theme/overrideCss';

registerCommunityThemeAppearanceHandlers({
    refreshInstalledCommunityTheme: refreshCommunityThemeProjection,
    stopLocalCommunityThemePreview
});
