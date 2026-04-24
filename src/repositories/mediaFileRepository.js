import { normalizePlatformError } from '@/platform/tauri/errors.js';
import { backend } from '@/platform/tauri/index.js';
import { safeJsonParse } from '@/repositories/baseRepository.js';

function parseResponseValue(data) {
    if (data === null || data === undefined || data === '') {
        return data ?? null;
    }

    if (typeof data !== 'string') {
        return data;
    }

    return safeJsonParse(data, data);
}

async function invokeApp(methodName, ...args) {
    try {
        return await backend.app[methodName](...args);
    } catch (error) {
        throw normalizePlatformError(
            error,
            `App command failed: ${methodName}`
        );
    }
}

async function resizeImageToFitLimits(base64Body) {
    return invokeApp('ResizeImageToFitLimits', base64Body);
}

async function getFileBase64(path) {
    return invokeApp('GetFileBase64', path);
}

async function getScreenshotMetadata(path) {
    return parseResponseValue(await invokeApp('GetScreenshotMetadata', path));
}

async function deleteScreenshotMetadata(path) {
    return invokeApp('DeleteScreenshotMetadata', path);
}

async function addScreenshotMetadata(
    path,
    metadataString,
    worldId,
    changeFilename = false
) {
    return invokeApp(
        'AddScreenshotMetadata',
        path,
        metadataString,
        worldId,
        changeFilename
    );
}

async function getExtraScreenshotData(path, carouselCache = false) {
    return parseResponseValue(
        await invokeApp('GetExtraScreenshotData', path, carouselCache)
    );
}

async function findScreenshotsBySearch(searchQuery, searchType) {
    return parseResponseValue(
        await invokeApp('FindScreenshotsBySearch', searchQuery, searchType)
    );
}

async function getLastScreenshot() {
    return invokeApp('GetLastScreenshot');
}

async function getVrchatPhotosLocation() {
    return invokeApp('GetVrchatPhotosLocation');
}

async function getUgcPhotoLocation(path = '') {
    return invokeApp('GetUGCPhotoLocation', path);
}

async function openFileSelectorDialog(
    defaultPath = '',
    defaultExt = '',
    defaultFilter = ''
) {
    return invokeApp(
        'OpenFileSelectorDialog',
        defaultPath,
        defaultExt,
        defaultFilter
    );
}

async function openFolderAndSelectItem(path, isFolder = false) {
    return invokeApp('OpenFolderAndSelectItem', path, isFolder);
}

async function copyImageToClipboard(path) {
    return invokeApp('CopyImageToClipboard', path);
}

async function saveImageFile(defaultName, base64Data) {
    return invokeApp('SaveImageFile', defaultName, base64Data);
}

async function savePrintToFile(url, ugcFolderPath, monthFolder, fileName) {
    return invokeApp(
        'SavePrintToFile',
        url,
        ugcFolderPath,
        monthFolder,
        fileName
    );
}

async function saveStickerToFile(url, ugcFolderPath, monthFolder, fileName) {
    return invokeApp(
        'SaveStickerToFile',
        url,
        ugcFolderPath,
        monthFolder,
        fileName
    );
}

async function saveEmojiToFile(url, ugcFolderPath, monthFolder, fileName) {
    return invokeApp(
        'SaveEmojiToFile',
        url,
        ugcFolderPath,
        monthFolder,
        fileName
    );
}

async function cropPrintImage(path) {
    return invokeApp('CropPrintImage', path);
}

async function cropAllPrints(ugcFolderPath) {
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
