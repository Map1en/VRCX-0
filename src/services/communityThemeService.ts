import { registerCommunityThemeAppearanceHandlers } from './appearanceConflictCoordinator';
import { disableInstalledCommunityTheme } from './community-theme/installedThemes';
import { stopLocalCommunityThemePreview } from './community-theme/localPreview';

export { isCommunityThemeAccentControlled } from './community-theme/appearanceControl';
export {
    deleteInstalledCommunityTheme,
    disableInstalledCommunityTheme,
    enableInstalledCommunityTheme,
    initializeCommunityThemes,
    installCommunityTheme,
    loadCatalog
} from './community-theme/installedThemes';
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
    disableInstalledCommunityTheme,
    stopLocalCommunityThemePreview
});
