import { invokeAppCommand } from '@/platform/tauri/dynamicCommand';
import { safeJsonParse } from '@/repositories/baseRepository';

type AppCommandName = string;

export interface ScreenshotLibraryStatus {
    running?: boolean;
    ready?: boolean;
    error?: string;
    [key: string]: unknown;
}

function parseResponseValue(data: unknown): unknown {
    if (data === null || data === undefined || data === '') {
        return data ?? null;
    }

    if (typeof data !== 'string') {
        return data;
    }

    return safeJsonParse(data, data);
}

async function invokeApp<TReturn = unknown>(
    methodName: AppCommandName,
    ...args: unknown[]
): Promise<TReturn> {
    return invokeAppCommand<TReturn>(methodName, ...args);
}

async function resizeImageToFitLimits(base64Body: string): Promise<string> {
    return invokeApp<string>('ResizeImageToFitLimits', base64Body);
}

async function getFileBase64(path: string): Promise<string> {
    return invokeApp<string>('GetFileBase64', path);
}

async function getScreenshotMetadata(path: string) {
    return parseResponseValue(await invokeApp('GetScreenshotMetadata', path));
}

async function deleteScreenshotMetadata(path: string) {
    return invokeApp('DeleteScreenshotMetadata', path);
}

async function addScreenshotMetadata(
    path: string,
    metadataString: string,
    worldId: string,
    changeFilename = false
): Promise<string> {
    return invokeApp<string>(
        'AddScreenshotMetadata',
        path,
        metadataString,
        worldId,
        changeFilename
    );
}

async function getExtraScreenshotData(path: string, carouselCache = false) {
    return parseResponseValue(
        await invokeApp('GetExtraScreenshotData', path, carouselCache)
    );
}

async function findScreenshotsBySearch(
    searchQuery: string,
    searchType: number
) {
    return parseResponseValue(
        await invokeApp('FindScreenshotsBySearch', searchQuery, searchType)
    );
}

async function startScreenshotLibraryScan(
    force = false
): Promise<ScreenshotLibraryStatus> {
    return invokeApp<ScreenshotLibraryStatus>(
        'StartScreenshotLibraryScan',
        force
    );
}

async function getScreenshotLibraryStatus(): Promise<ScreenshotLibraryStatus> {
    return invokeApp<ScreenshotLibraryStatus>('GetScreenshotLibraryStatus');
}

async function getScreenshotFolderTree() {
    return invokeApp('GetScreenshotFolderTree');
}

async function getScreenshotFolderImages(folderPath: string) {
    return invokeApp('GetScreenshotFolderImages', folderPath);
}

async function getWorldScreenshots(worldId: string) {
    return invokeApp('GetWorldScreenshots', worldId);
}

async function ensureScreenshotThumbnail(path: string) {
    return invokeApp('EnsureScreenshotThumbnail', path);
}

async function getLastScreenshot() {
    return invokeApp('GetLastScreenshot');
}

async function getVrchatPhotosLocation(): Promise<string> {
    return invokeApp<string>('GetVrchatPhotosLocation');
}

async function getUgcPhotoLocation(path = '') {
    return invokeApp<string>('GetUGCPhotoLocation', path);
}

async function openFileSelectorDialog(
    defaultPath = '',
    defaultExt = '',
    defaultFilter = ''
) {
    return invokeApp<string | null>(
        'OpenFileSelectorDialog',
        defaultPath,
        defaultExt,
        defaultFilter
    );
}

async function openFolderAndSelectItem(path: string, isFolder = false) {
    return invokeApp('OpenFolderAndSelectItem', path, isFolder);
}

async function copyImageToClipboard(path: string) {
    return invokeApp('CopyImageToClipboard', path);
}

async function saveImageFile(
    defaultName: string,
    base64Data: string
): Promise<string> {
    return invokeApp<string>('SaveImageFile', defaultName, base64Data);
}

async function savePrintToFile(
    url: string,
    ugcFolderPath: string,
    monthFolder: string,
    fileName: string
): Promise<string> {
    return invokeApp<string>(
        'SavePrintToFile',
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
    return invokeApp<string>(
        'SaveStickerToFile',
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
    return invokeApp<string>(
        'SaveEmojiToFile',
        url,
        ugcFolderPath,
        monthFolder,
        fileName
    );
}

async function cropPrintImage(path: string): Promise<boolean> {
    return invokeApp<boolean>('CropPrintImage', path);
}

async function cropAllPrints(ugcFolderPath: string) {
    return invokeApp('CropAllPrints', ugcFolderPath);
}

const mediaFileRepository = Object.freeze({
    invokeApp,
    resizeImageToFitLimits,
    getFileBase64,
    getScreenshotMetadata,
    deleteScreenshotMetadata,
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

export {
    invokeApp,
    resizeImageToFitLimits,
    getFileBase64,
    getScreenshotMetadata,
    deleteScreenshotMetadata,
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
};

export default mediaFileRepository;
