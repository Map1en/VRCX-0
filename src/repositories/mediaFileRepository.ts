import { commands } from '@/platform/tauri/bindings';
import type { ScreenshotLibraryScanStatus } from '@/platform/tauri/bindings';
import { safeJsonParse } from '@/repositories/baseRepository';

export type ScreenshotLibraryStatus = ScreenshotLibraryScanStatus;

function parseResponseValue(data: string): unknown {
    if (data === '') {
        return '';
    }

    return safeJsonParse(data, data);
}

async function resizeImageToFitLimits(base64Body: string): Promise<string> {
    return commands.appResizeImageToFitLimits(base64Body);
}

async function getFileBase64(path: string): Promise<string> {
    return commands.appGetFileBase64(path);
}

async function getScreenshotMetadata(path: string) {
    return parseResponseValue(await commands.appGetScreenshotMetadata(path));
}

async function deleteScreenshotMetadata(path: string) {
    return commands.appDeleteScreenshotMetadata(path);
}

async function deleteScreenshotFile(path: string) {
    return commands.appDeleteScreenshotFile(path);
}

async function exportScreenshotsZip(paths: string[], groupByFolder: boolean) {
    return commands.appExportScreenshotsZip(paths, groupByFolder);
}

async function cancelScreenshotExport() {
    return commands.appCancelScreenshotExport();
}

async function addScreenshotMetadata(
    path: string,
    metadataString: string,
    worldId: string,
    changeFilename = false
): Promise<string> {
    return commands.appAddScreenshotMetadata(
        path,
        metadataString,
        worldId,
        changeFilename
    );
}

async function getExtraScreenshotData(path: string, carouselCache = false) {
    return parseResponseValue(
        await commands.appGetExtraScreenshotData(path, carouselCache)
    );
}

async function findScreenshotsBySearch(
    searchQuery: string,
    searchType: number
) {
    return commands.appFindScreenshotsBySearch(searchQuery, searchType);
}

async function startScreenshotLibraryScan(
    force = false
): Promise<ScreenshotLibraryStatus> {
    return commands.appStartScreenshotLibraryScan(force);
}

async function getScreenshotLibraryStatus(): Promise<ScreenshotLibraryStatus> {
    return commands.appGetScreenshotLibraryStatus();
}

async function getScreenshotFolderTree() {
    return commands.appGetScreenshotFolderTree();
}

async function getScreenshotFolderImages(folderPath: string) {
    return commands.appGetScreenshotFolderImages(folderPath);
}

async function getWorldScreenshots(worldId: string) {
    return commands.appGetWorldScreenshots(worldId);
}

async function ensureScreenshotThumbnail(path: string) {
    return commands.appEnsureScreenshotThumbnail(path);
}

async function getLastScreenshot() {
    return commands.appGetLastScreenshot();
}

async function getVrchatPhotosLocation(): Promise<string> {
    return commands.appGetVrchatPhotosLocation();
}

async function getUgcPhotoLocation(path = '') {
    return commands.appGetUgcPhotoLocation(path);
}

async function openFileSelectorDialog(
    defaultPath = '',
    defaultExt = '',
    defaultFilter = ''
) {
    return commands.appOpenFileSelectorDialog(
        defaultPath,
        defaultExt,
        defaultFilter
    );
}

async function openFolderAndSelectItem(path: string, isFolder = false) {
    return commands.appOpenFolderAndSelectItem(path, isFolder);
}

async function copyImageToClipboard(path: string) {
    return commands.appCopyImageToClipboard(path);
}

async function saveImageFile(
    defaultName: string,
    base64Data: string
): Promise<string> {
    return commands.appSaveImageFile(defaultName, base64Data);
}

async function savePrintToFile(
    url: string,
    ugcFolderPath: string,
    monthFolder: string,
    fileName: string
): Promise<string> {
    return commands.appSavePrintToFile(
        url,
        ugcFolderPath,
        monthFolder,
        fileName
    );
}

async function saveStickerToFile(
    url: string,
    ugcFolderPath: string,
    monthFolder: string,
    fileName: string
): Promise<string> {
    return commands.appSaveStickerToFile(
        url,
        ugcFolderPath,
        monthFolder,
        fileName
    );
}

async function saveEmojiToFile(
    url: string,
    ugcFolderPath: string,
    monthFolder: string,
    fileName: string
): Promise<string> {
    return commands.appSaveEmojiToFile(
        url,
        ugcFolderPath,
        monthFolder,
        fileName
    );
}

async function cropPrintImage(path: string): Promise<boolean> {
    return commands.appCropPrintImage(path);
}

async function cropAllPrints(ugcFolderPath: string) {
    return commands.appCropAllPrints(ugcFolderPath);
}

const mediaFileRepository = Object.freeze({
    resizeImageToFitLimits,
    getFileBase64,
    getScreenshotMetadata,
    deleteScreenshotMetadata,
    deleteScreenshotFile,
    exportScreenshotsZip,
    cancelScreenshotExport,
    addScreenshotMetadata,
    getExtraScreenshotData,
    findScreenshotsBySearch,
    startScreenshotLibraryScan,
    getScreenshotLibraryStatus,
    getScreenshotFolderTree,
    getScreenshotFolderImages,
    getWorldScreenshots,
    ensureScreenshotThumbnail,
    getLastScreenshot,
    getVrchatPhotosLocation,
    getUgcPhotoLocation,
    openFileSelectorDialog,
    openFolderAndSelectItem,
    copyImageToClipboard,
    saveImageFile,
    savePrintToFile,
    saveStickerToFile,
    saveEmojiToFile,
    cropPrintImage,
    cropAllPrints
});

export { openFileSelectorDialog, openFolderAndSelectItem };

export default mediaFileRepository;
