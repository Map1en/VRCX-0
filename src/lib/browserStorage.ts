import { safeJsonParse } from '@/shared/utils/json';

export const STORAGE_KEYS = {
    activityJourneyDensity: 'VRCX_0_ActivityJourneyDensity',
    dataTablePrefix: 'vrcx-0:table:',
    devkitI18nFilePath: 'devkit:i18n:filePath',
    devkitI18nTargetLang: 'devkit:i18n:targetLang',
    devkitThemeFolderPath: 'devkit:theme:folderPath',
    favoritesAvatarDensity: 'VRCX_0_FavoritesAvatarDensity',
    favoritesAvatarSplitter: 'VRCX_0_FavoritesAvatarSplitter',
    favoritesFriendDensity: 'VRCX_0_FavoritesFriendDensity',
    favoritesFriendSplitter: 'VRCX_0_FavoritesFriendSplitter',
    favoritesWorldDensity: 'VRCX_0_FavoritesWorldDensity',
    favoritesWorldSplitter: 'VRCX_0_FavoritesWorldSplitter',
    feedColumnsDensity: 'VRCX_0_FeedColumnsDensity',
    friendLocationDensity: 'VRCX_0_FriendLocationDensity',
    galleryGridDensity: 'VRCX_0_GalleryGridDensity',
    instanceActivityBarWidth: 'VRCX_0_InstanceActivityBarWidth',
    inventoryGridDensity: 'VRCX_0_InventoryGridDensity',
    mutualGraphCommunitySeparation: 'VRCX_0_MutualGraphCommunitySeparation',
    mutualGraphEdgeCurvature: 'VRCX_0_MutualGraphEdgeCurvature',
    mutualGraphExcludedFriends: 'VRCX_MutualGraphExcludedFriends',
    mutualGraphLayoutIterations: 'VRCX_0_MutualGraphLayoutIterations',
    mutualGraphLayoutSpacing: 'VRCX_0_MutualGraphLayoutSpacing',
    myAvatarsGridDensity: 'VRCX_0_MyAvatarsGridDensity',
    navPanelWidth: 'VRCX_0_NavPanelWidth',
    normalWindowBounds: 'VRCX_0_NormalWindowBounds',
    profileBackupNotifiedOutcomeRevision:
        'vrcx-0.profile-backup.notified-outcome-revision',
    recentActions: 'VRCX_recentActions',
    rgbEnabled: 'vrcx-0-rgb-enabled',
    rightSidebarRouteOpenState: 'VRCX_0_RightSidebarRouteOpenState',
    rightSidebarWidth: 'VRCX_0_RightSidebarWidth',
    screenshotDetailsVisible: 'VRCX_0_ScreenshotDetailsVisible',
    screenshotGalleryScrollPositions: 'VRCX_0_ScreenshotGalleryScrollPositions',
    screenshotGridDensity: 'VRCX_0_ScreenshotGridDensity',
    screenshotGridSort: 'VRCX_0_ScreenshotGridSort',
    searchPageSizes: 'VRCX_0_SearchPageSizes',
    sidebarWindowWidth: 'VRCX_0_SidebarWindowWidth',
    userDialogMutualView: 'VRCX_0_UserDialogMutualView',
    vrchatLogViewerPrefs: 'VRCX_0_VrchatLogViewerPrefs',
    windowAlwaysOnTop: 'VRCX_0_WindowAlwaysOnTop',
    windowDisplayMode: 'VRCX_0_WindowDisplayMode'
} as const;

export function readStoredText(key: string): string | null {
    return localStorage.getItem(key);
}

export function writeStoredText(key: string, value: string): void {
    localStorage.setItem(key, value);
}

export function removeStored(key: string): void {
    localStorage.removeItem(key);
}

export function readStoredJson(key: string): unknown {
    return safeJsonParse(localStorage.getItem(key));
}

export function readSessionText(key: string): string | null {
    return sessionStorage.getItem(key);
}

export function writeSessionText(key: string, value: string): void {
    sessionStorage.setItem(key, value);
}
