import { backend } from '../platform/tauri/index.js';
import { normalizePlatformError } from '../platform/tauri/errors.js';
import { getBase64ByteLength, md5Base64 } from '@/shared/utils/binary.js';
import { extractFileId } from '@/shared/utils/fileUtils.js';
import { safeJsonParse } from './baseRepository.js';
import webRepository from './webRepository.js';
import {
    entityQueryPolicies,
    fetchCachedData,
    queryKeys
} from '@/services/entityQueryCacheService.js';

const DEFAULT_ENDPOINT_DOMAIN = 'https://api.vrchat.cloud/api/1';

function getEndpointDomain(endpoint = '') {
    const endpointDomain = endpoint || globalThis?.$debug?.endpointDomain;
    if (typeof endpointDomain === 'string' && endpointDomain.trim()) {
        return endpointDomain;
    }
    return DEFAULT_ENDPOINT_DOMAIN;
}

function normalizeParams(params = {}) {
    if (!params || typeof params !== 'object') {
        return {};
    }
    return { ...params };
}

function appendParams(url, params) {
    if (!params || typeof params !== 'object') {
        return url;
    }

    for (const [key, value] of Object.entries(params)) {
        if (value === null || value === undefined) {
            continue;
        }

        if (Array.isArray(value)) {
            for (const item of value) {
                if (item === null || item === undefined) {
                    continue;
                }
                url.searchParams.append(key, String(item));
            }
            continue;
        }

        if (value instanceof Date) {
            url.searchParams.set(key, value.toISOString());
            continue;
        }

        if (typeof value === 'object') {
            url.searchParams.set(key, String(value));
            continue;
        }

        url.searchParams.set(key, String(value));
    }

    return url;
}

function buildUrl(path, params, endpoint = '') {
    const baseUrl = getEndpointDomain(endpoint).replace(/\/?$/, '/');
    const url = new URL(path, baseUrl);
    return appendParams(url, params);
}

function parseResponseValue(data) {
    if (data === null || data === undefined || data === '') {
        return data ?? null;
    }

    if (typeof data !== 'string') {
        return data;
    }

    return safeJsonParse(data, data);
}

function unwrapErrorMessage(json, status, fallbackMessage) {
    const message = json?.error?.message ?? json?.message;
    if (typeof message === 'string' && message.trim()) {
        return message.replace(/^"+|"+$/g, '');
    }
    return fallbackMessage ?? `Request failed (${status})`;
}

async function executeFilePut({ url, fileData, fileMIME, fileMD5 }) {
    const response = await webRepository.execute({
        url,
        uploadFilePUT: true,
        fileData,
        fileMIME,
        fileMD5
    });

    if (response.status < 200 || response.status >= 300) {
        throw new Error(`Media file upload failed (${response.status})`);
    }

    return response;
}

async function executeRequest(
    path,
    { method = 'GET', params = {}, endpoint = '' } = {}
) {
    try {
        const response = await webRepository.execute({
            url: buildUrl(
                path,
                method === 'GET' ? normalizeParams(params) : {},
                endpoint
            ).toString(),
            method,
            ...(method === 'GET'
                ? {}
                : {
                      headers: {
                          'Content-Type': 'application/json;charset=utf-8'
                      },
                      body: JSON.stringify(params ?? {})
                  })
        });
        const json = parseResponseValue(response.data);

        if (response.status >= 400) {
            throw new Error(
                unwrapErrorMessage(
                    json,
                    response.status,
                    'Media request failed'
                )
            );
        }

        if (json && typeof json === 'object' && 'error' in json) {
            throw new Error(
                unwrapErrorMessage(
                    json,
                    response.status,
                    'Media request failed'
                )
            );
        }

        return {
            json,
            params,
            status: response.status,
            raw: response.raw
        };
    } catch (error) {
        throw normalizePlatformError(error, 'Media request failed');
    }
}

async function executeGet(path, params = {}, extra = {}, options = {}) {
    const normalizedParams = normalizeParams(params);

    try {
        const response = await webRepository.execute({
            url: buildUrl(path, normalizedParams, options.endpoint).toString(),
            method: 'GET'
        });
        const json = parseResponseValue(response.data);

        if (response.status >= 400) {
            throw new Error(
                unwrapErrorMessage(
                    json,
                    response.status,
                    'Media request failed'
                )
            );
        }

        if (json && typeof json === 'object' && 'error' in json) {
            throw new Error(
                unwrapErrorMessage(
                    json,
                    response.status,
                    'Media request failed'
                )
            );
        }

        return {
            json,
            params: normalizedParams,
            ...extra,
            status: response.status,
            raw: response.raw
        };
    } catch (error) {
        throw normalizePlatformError(error, 'Media request failed');
    }
}

async function executeDelete(path, extra = {}, options = {}) {
    try {
        const response = await webRepository.execute({
            url: buildUrl(path, {}, options.endpoint).toString(),
            method: 'DELETE'
        });
        const json = parseResponseValue(response.data);

        if (response.status >= 400) {
            throw new Error(
                unwrapErrorMessage(
                    json,
                    response.status,
                    'Media request failed'
                )
            );
        }

        if (json && typeof json === 'object' && 'error' in json) {
            throw new Error(
                unwrapErrorMessage(
                    json,
                    response.status,
                    'Media request failed'
                )
            );
        }

        return {
            json,
            ...extra,
            status: response.status,
            raw: response.raw
        };
    } catch (error) {
        throw normalizePlatformError(error, 'Media request failed');
    }
}

async function uploadImage(path, imageData, params = {}, options = {}) {
    try {
        const response = await webRepository.execute({
            url: buildUrl(path, {}, options.endpoint).toString(),
            uploadImage: true,
            matchingDimensions: Boolean(options.matchingDimensions),
            postData: JSON.stringify(params ?? {}),
            imageData
        });
        const json = parseResponseValue(response.data);

        if (response.status >= 400) {
            throw new Error(
                unwrapErrorMessage(json, response.status, 'Media upload failed')
            );
        }

        if (json && typeof json === 'object' && 'error' in json) {
            throw new Error(
                unwrapErrorMessage(json, response.status, 'Media upload failed')
            );
        }

        return {
            json,
            params,
            status: response.status,
            raw: response.raw
        };
    } catch (error) {
        throw normalizePlatformError(error, 'Media upload failed');
    }
}

async function getFiles(params = {}, options = {}) {
    return executeGet('files', params, {}, options);
}

async function getFileList(params = {}, options = {}) {
    return getFiles(params, options);
}

async function deleteFile(fileId, options = {}) {
    const normalizedFileId =
        typeof fileId === 'string'
            ? fileId.trim()
            : String(fileId ?? '').trim();
    if (!normalizedFileId) {
        throw new Error('MediaRepository.deleteFile requires a file id.');
    }

    return executeDelete(
        `file/${encodeURIComponent(normalizedFileId)}`,
        {
            fileId: normalizedFileId
        },
        options
    );
}

async function uploadGalleryImage(imageData, options = {}) {
    return uploadImage(
        'file/image',
        imageData,
        {
            tag: 'gallery'
        },
        {
            matchingDimensions: false,
            endpoint: options.endpoint
        }
    );
}

async function uploadAvatarGalleryImage(imageData, avatarId, options = {}) {
    return uploadImage(
        'file/image',
        imageData,
        {
            tag: 'avatargallery',
            galleryId: avatarId
        },
        {
            matchingDimensions: false,
            endpoint: options.endpoint
        }
    );
}

async function uploadVrcPlusIcon(imageData, options = {}) {
    return uploadImage(
        'file/image',
        imageData,
        {
            tag: 'icon'
        },
        {
            matchingDimensions: true,
            endpoint: options.endpoint
        }
    );
}

async function uploadEmoji(imageData, params = {}, options = {}) {
    return uploadImage('file/image', imageData, params, {
        matchingDimensions: true,
        endpoint: options.endpoint
    });
}

async function uploadSticker(imageData, options = {}) {
    return uploadImage(
        'file/image',
        imageData,
        {
            tag: 'sticker',
            maskTag: 'square'
        },
        {
            matchingDimensions: true,
            endpoint: options.endpoint
        }
    );
}

async function uploadPrint(
    imageData,
    { endpoint = '', cropWhiteBorder = true, params = {} } = {}
) {
    try {
        const response = await webRepository.execute({
            url: buildUrl('prints', {}, endpoint).toString(),
            uploadImagePrint: true,
            cropWhiteBorder: Boolean(cropWhiteBorder),
            postData: JSON.stringify(params ?? {}),
            imageData
        });
        const json = parseResponseValue(response.data);

        if (response.status >= 400) {
            throw new Error(
                unwrapErrorMessage(json, response.status, 'Print upload failed')
            );
        }

        if (json && typeof json === 'object' && 'error' in json) {
            throw new Error(
                unwrapErrorMessage(json, response.status, 'Print upload failed')
            );
        }

        return {
            json,
            params,
            status: response.status,
            raw: response.raw
        };
    } catch (error) {
        throw normalizePlatformError(error, 'Print upload failed');
    }
}

async function getPrints({ userId, n = 100 } = {}, options = {}) {
    const normalizedUserId =
        typeof userId === 'string'
            ? userId.trim()
            : String(userId ?? '').trim();
    if (!normalizedUserId) {
        throw new Error('MediaRepository.getPrints requires a user id.');
    }

    return executeGet(
        `prints/user/${encodeURIComponent(normalizedUserId)}`,
        { n },
        { userId: normalizedUserId },
        options
    );
}

async function getPrint(printId, options = {}) {
    const normalizedPrintId =
        typeof printId === 'string'
            ? printId.trim()
            : String(printId ?? '').trim();
    if (!normalizedPrintId) {
        throw new Error('MediaRepository.getPrint requires a print id.');
    }

    return executeGet(
        `prints/${encodeURIComponent(normalizedPrintId)}`,
        {},
        {
            printId: normalizedPrintId
        },
        options
    );
}

async function deletePrint(printId, options = {}) {
    const normalizedPrintId =
        typeof printId === 'string'
            ? printId.trim()
            : String(printId ?? '').trim();
    if (!normalizedPrintId) {
        throw new Error('MediaRepository.deletePrint requires a print id.');
    }

    return executeDelete(
        `prints/${encodeURIComponent(normalizedPrintId)}`,
        {
            printId: normalizedPrintId
        },
        options
    );
}

async function getInventoryItems(params = {}, options = {}) {
    return executeGet('inventory', params, {}, options);
}

async function getUserInventoryItem(
    { inventoryId, userId } = {},
    options = {}
) {
    const normalizedInventoryId =
        typeof inventoryId === 'string'
            ? inventoryId.trim()
            : String(inventoryId ?? '').trim();
    const normalizedUserId =
        typeof userId === 'string'
            ? userId.trim()
            : String(userId ?? '').trim();
    if (!normalizedInventoryId || !normalizedUserId) {
        throw new Error(
            'MediaRepository.getUserInventoryItem requires inventory and user ids.'
        );
    }

    return fetchCachedData({
        queryKey: queryKeys.userInventoryItem(
            {
                inventoryId: normalizedInventoryId,
                userId: normalizedUserId
            },
            options.endpoint
        ),
        policy: entityQueryPolicies.inventoryCollection,
        force: Boolean(options.force),
        queryFn: () =>
            executeGet(
                `user/${encodeURIComponent(normalizedUserId)}/inventory/${encodeURIComponent(normalizedInventoryId)}`,
                {},
                {
                    inventoryId: normalizedInventoryId,
                    userId: normalizedUserId
                },
                options
            )
    });
}

async function consumeInventoryBundle(inventoryId, options = {}) {
    const normalizedInventoryId =
        typeof inventoryId === 'string'
            ? inventoryId.trim()
            : String(inventoryId ?? '').trim();
    if (!normalizedInventoryId) {
        throw new Error(
            'MediaRepository.consumeInventoryBundle requires an inventory id.'
        );
    }

    return executeRequest(
        `inventory/${encodeURIComponent(normalizedInventoryId)}/consume`,
        {
            method: 'PUT',
            params: {
                inventoryId: normalizedInventoryId
            },
            endpoint: options.endpoint
        }
    );
}

async function redeemReward(code, options = {}) {
    const normalizedCode =
        typeof code === 'string' ? code.trim() : String(code ?? '').trim();
    if (!normalizedCode) {
        throw new Error('MediaRepository.redeemReward requires a reward code.');
    }

    return executeRequest('reward/redeem', {
        method: 'POST',
        params: {
            code: normalizedCode
        },
        endpoint: options.endpoint
    });
}

async function resizeImageToFitLimits(base64Body) {
    return invokeApp('ResizeImageToFitLimits', base64Body);
}

async function uploadAvatarImageLegacy({
    avatarId,
    imageUrl,
    base64File,
    blob,
    endpoint = ''
}) {
    const normalizedAvatarId =
        typeof avatarId === 'string'
            ? avatarId.trim()
            : String(avatarId ?? '').trim();
    if (!normalizedAvatarId) {
        throw new Error(
            'MediaRepository.uploadAvatarImageLegacy requires an avatar id.'
        );
    }

    const sourceFileId = extractFileId(imageUrl);
    if (!sourceFileId) {
        throw new Error(
            'Avatar image upload requires an existing source image file id.'
        );
    }

    const fileMd5 = md5Base64(base64File);
    const fileSizeInBytes =
        Number(blob?.size) || getBase64ByteLength(base64File);
    const signatureFile = await invokeApp('SignFile', base64File);
    const signatureMd5 = md5Base64(signatureFile);
    const signatureSizeInBytes = getBase64ByteLength(signatureFile);
    const upload = await executeRequest(
        `file/${encodeURIComponent(sourceFileId)}`,
        {
            endpoint,
            method: 'POST',
            params: {
                fileMd5,
                fileSizeInBytes,
                signatureMd5,
                signatureSizeInBytes
            }
        }
    );
    const uploadedFileId = upload.json?.id;
    const versions = Array.isArray(upload.json?.versions)
        ? upload.json.versions
        : [];
    const fileVersion = versions.at(-1)?.version;
    if (!uploadedFileId || !fileVersion) {
        throw new Error('Avatar image upload did not return a file version.');
    }

    const fileStart = await executeRequest(
        `file/${encodeURIComponent(uploadedFileId)}/${fileVersion}/file/start`,
        { endpoint, method: 'PUT', params: {} }
    );
    await executeFilePut({
        url: fileStart.json?.url,
        fileData: base64File,
        fileMIME: 'image/png',
        fileMD5: fileMd5
    });
    await executeRequest(
        `file/${encodeURIComponent(uploadedFileId)}/${fileVersion}/file/finish`,
        {
            endpoint,
            method: 'PUT',
            params: {
                maxParts: 0,
                nextPartNumber: 0
            }
        }
    );

    const signatureStart = await executeRequest(
        `file/${encodeURIComponent(uploadedFileId)}/${fileVersion}/signature/start`,
        { endpoint, method: 'PUT', params: {} }
    );
    await executeFilePut({
        url: signatureStart.json?.url,
        fileData: signatureFile,
        fileMIME: 'application/x-rsync-signature',
        fileMD5: signatureMd5
    });
    await executeRequest(
        `file/${encodeURIComponent(uploadedFileId)}/${fileVersion}/signature/finish`,
        {
            endpoint,
            method: 'PUT',
            params: {
                maxParts: 0,
                nextPartNumber: 0
            }
        }
    );

    const nextImageUrl = `${getEndpointDomain(endpoint).replace(/\/?$/, '')}/file/${uploadedFileId}/${fileVersion}/file`;
    const avatarResponse = await executeRequest(
        `avatars/${encodeURIComponent(normalizedAvatarId)}`,
        {
            endpoint,
            method: 'PUT',
            params: {
                id: normalizedAvatarId,
                imageUrl: nextImageUrl
            }
        }
    );
    if (avatarResponse.json?.imageUrl !== nextImageUrl) {
        throw new Error('Avatar image change failed.');
    }

    return {
        avatar: avatarResponse.json,
        imageUrl: nextImageUrl,
        fileId: uploadedFileId,
        fileVersion
    };
}

async function uploadWorldImageLegacy({
    worldId,
    imageUrl,
    base64File,
    blob,
    endpoint = ''
}) {
    const normalizedWorldId =
        typeof worldId === 'string'
            ? worldId.trim()
            : String(worldId ?? '').trim();
    if (!normalizedWorldId) {
        throw new Error(
            'MediaRepository.uploadWorldImageLegacy requires a world id.'
        );
    }

    const sourceFileId = extractFileId(imageUrl);
    if (!sourceFileId) {
        throw new Error(
            'World image upload requires an existing source image file id.'
        );
    }

    const fileMd5 = md5Base64(base64File);
    const fileSizeInBytes =
        Number(blob?.size) || getBase64ByteLength(base64File);
    const signatureFile = await invokeApp('SignFile', base64File);
    const signatureMd5 = md5Base64(signatureFile);
    const signatureSizeInBytes = getBase64ByteLength(signatureFile);
    const upload = await executeRequest(
        `file/${encodeURIComponent(sourceFileId)}`,
        {
            endpoint,
            method: 'POST',
            params: {
                fileMd5,
                fileSizeInBytes,
                signatureMd5,
                signatureSizeInBytes
            }
        }
    );
    const uploadedFileId = upload.json?.id;
    const versions = Array.isArray(upload.json?.versions)
        ? upload.json.versions
        : [];
    const fileVersion = versions.at(-1)?.version;
    if (!uploadedFileId || !fileVersion) {
        throw new Error('World image upload did not return a file version.');
    }

    const fileStart = await executeRequest(
        `file/${encodeURIComponent(uploadedFileId)}/${fileVersion}/file/start`,
        { endpoint, method: 'PUT', params: {} }
    );
    await executeFilePut({
        url: fileStart.json?.url,
        fileData: base64File,
        fileMIME: 'image/png',
        fileMD5: fileMd5
    });
    await executeRequest(
        `file/${encodeURIComponent(uploadedFileId)}/${fileVersion}/file/finish`,
        {
            endpoint,
            method: 'PUT',
            params: {
                maxParts: 0,
                nextPartNumber: 0
            }
        }
    );

    const signatureStart = await executeRequest(
        `file/${encodeURIComponent(uploadedFileId)}/${fileVersion}/signature/start`,
        { endpoint, method: 'PUT', params: {} }
    );
    await executeFilePut({
        url: signatureStart.json?.url,
        fileData: signatureFile,
        fileMIME: 'application/x-rsync-signature',
        fileMD5: signatureMd5
    });
    await executeRequest(
        `file/${encodeURIComponent(uploadedFileId)}/${fileVersion}/signature/finish`,
        {
            endpoint,
            method: 'PUT',
            params: {
                maxParts: 0,
                nextPartNumber: 0
            }
        }
    );

    const nextImageUrl = `${getEndpointDomain(endpoint).replace(/\/?$/, '')}/file/${uploadedFileId}/${fileVersion}/file`;
    const worldResponse = await executeRequest(
        `worlds/${encodeURIComponent(normalizedWorldId)}`,
        {
            endpoint,
            method: 'PUT',
            params: {
                id: normalizedWorldId,
                imageUrl: nextImageUrl
            }
        }
    );
    if (worldResponse.json?.imageUrl !== nextImageUrl) {
        throw new Error('World image change failed.');
    }

    return {
        world: worldResponse.json,
        imageUrl: nextImageUrl,
        fileId: uploadedFileId,
        fileVersion
    };
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

const mediaRepository = Object.freeze({
    executeFilePut,
    executeRequest,
    executeGet,
    executeDelete,
    uploadImage,
    getFiles,
    getFileList,
    deleteFile,
    uploadGalleryImage,
    uploadAvatarGalleryImage,
    uploadVrcPlusIcon,
    uploadEmoji,
    uploadSticker,
    uploadPrint,
    getPrints,
    getPrint,
    deletePrint,
    getInventoryItems,
    getUserInventoryItem,
    consumeInventoryBundle,
    redeemReward,
    resizeImageToFitLimits,
    uploadAvatarImageLegacy,
    uploadWorldImageLegacy,
    invokeApp,
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
    savePrintToFile,
    saveStickerToFile,
    saveEmojiToFile,
    cropPrintImage,
    cropAllPrints
});

export {
    executeFilePut,
    executeRequest,
    executeGet,
    executeDelete,
    uploadImage,
    getFiles,
    getFileList,
    deleteFile,
    uploadGalleryImage,
    uploadAvatarGalleryImage,
    uploadVrcPlusIcon,
    uploadEmoji,
    uploadSticker,
    uploadPrint,
    getPrints,
    getPrint,
    deletePrint,
    getInventoryItems,
    getUserInventoryItem,
    consumeInventoryBundle,
    redeemReward,
    resizeImageToFitLimits,
    uploadAvatarImageLegacy,
    uploadWorldImageLegacy,
    invokeApp,
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
    savePrintToFile,
    saveStickerToFile,
    saveEmojiToFile,
    cropPrintImage,
    cropAllPrints
};
export default mediaRepository;
