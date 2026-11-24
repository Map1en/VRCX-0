import { safeJsonParse } from '@/shared/utils/json';

export const STORAGE_KEYS = {
    dataTablePrefix: 'vrcx-0:table:',
    devkitI18nFilePath: 'devkit:i18n:filePath',
    devkitI18nTargetLang: 'devkit:i18n:targetLang',
    devkitThemeFolderPath: 'devkit:theme:folderPath',
    galleryGridDensity: 'VRCX_0_GalleryGridDensity',
    inventoryGridDensity: 'VRCX_0_InventoryGridDensity',
    mutualGraphExcludedFriends: 'VRCX_MutualGraphExcludedFriends',
    normalWindowBounds: 'VRCX_0_NormalWindowBounds',
    profileBackupNotifiedOutcomeRevision:
        'vrcx-0.profile-backup.notified-outcome-revision',
    recentActions: 'VRCX_recentActions',
    rgbEnabled: 'vrcx-0-rgb-enabled',
    rightSidebarRouteOpenState: 'VRCX_0_RightSidebarRouteOpenState',
    rightSidebarWidth: 'VRCX_0_RightSidebarWidth',
    screenshotDetailsVisible: 'VRCX_0_ScreenshotDetailsVisible',
    screenshotGridDensity: 'VRCX_0_ScreenshotGridDensity',
    screenshotGridSort: 'VRCX_0_ScreenshotGridSort',
    searchPageSizes: 'VRCX_0_SearchPageSizes',
    sidebarWindowWidth: 'VRCX_0_SidebarWindowWidth',
    userDialogMutualView: 'VRCX_0_UserDialogMutualView',
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
