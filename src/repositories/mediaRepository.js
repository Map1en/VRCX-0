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

class MediaRepository {
    async executeFilePut({ url, fileData, fileMIME, fileMD5 }) {
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

    async executeRequest(path, { method = 'GET', params = {}, endpoint = '' } = {}) {
        try {
            const response = await webRepository.execute({
                url: buildUrl(path, method === 'GET' ? normalizeParams(params) : {}, endpoint).toString(),
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
                    unwrapErrorMessage(json, response.status, 'Media request failed')
                );
            }

            if (json && typeof json === 'object' && 'error' in json) {
                throw new Error(
                    unwrapErrorMessage(json, response.status, 'Media request failed')
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

    async executeGet(path, params = {}, extra = {}, options = {}) {
        const normalizedParams = normalizeParams(params);

        try {
            const response = await webRepository.execute({
                url: buildUrl(path, normalizedParams, options.endpoint).toString(),
                method: 'GET'
            });
            const json = parseResponseValue(response.data);

            if (response.status >= 400) {
                throw new Error(
                    unwrapErrorMessage(json, response.status, 'Media request failed')
                );
            }

            if (json && typeof json === 'object' && 'error' in json) {
                throw new Error(
                    unwrapErrorMessage(json, response.status, 'Media request failed')
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

    async executeDelete(path, extra = {}, options = {}) {
        try {
            const response = await webRepository.execute({
                url: buildUrl(path, {}, options.endpoint).toString(),
                method: 'DELETE'
            });
            const json = parseResponseValue(response.data);

            if (response.status >= 400) {
                throw new Error(
                    unwrapErrorMessage(json, response.status, 'Media request failed')
                );
            }

            if (json && typeof json === 'object' && 'error' in json) {
                throw new Error(
                    unwrapErrorMessage(json, response.status, 'Media request failed')
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

    async uploadImage(path, imageData, params = {}, options = {}) {
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

    async getFiles(params = {}, options = {}) {
        return this.executeGet('files', params, {}, options);
    }

    async getFileList(params = {}, options = {}) {
        return this.getFiles(params, options);
    }

    async deleteFile(fileId, options = {}) {
        const normalizedFileId =
            typeof fileId === 'string' ? fileId.trim() : String(fileId ?? '').trim();
        if (!normalizedFileId) {
            throw new Error('MediaRepository.deleteFile requires a file id.');
        }

        return this.executeDelete(`file/${encodeURIComponent(normalizedFileId)}`, {
            fileId: normalizedFileId
        }, options);
    }

    async uploadGalleryImage(imageData, options = {}) {
        return this.uploadImage(
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

    async uploadAvatarGalleryImage(imageData, avatarId, options = {}) {
        return this.uploadImage(
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

    async uploadVrcPlusIcon(imageData, options = {}) {
        return this.uploadImage(
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

    async uploadEmoji(imageData, params = {}, options = {}) {
        return this.uploadImage(
            'file/image',
            imageData,
            params,
            {
                matchingDimensions: true,
                endpoint: options.endpoint
            }
        );
    }

    async uploadSticker(imageData, options = {}) {
        return this.uploadImage(
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

    async uploadPrint(imageData, { endpoint = '', cropWhiteBorder = true, params = {} } = {}) {
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

    async getPrints({ userId, n = 100 } = {}, options = {}) {
        const normalizedUserId =
            typeof userId === 'string' ? userId.trim() : String(userId ?? '').trim();
        if (!normalizedUserId) {
            throw new Error('MediaRepository.getPrints requires a user id.');
        }

        return this.executeGet(
            `prints/user/${encodeURIComponent(normalizedUserId)}`,
            { n },
            { userId: normalizedUserId },
            options
        );
    }

    async getPrint(printId, options = {}) {
        const normalizedPrintId =
            typeof printId === 'string' ? printId.trim() : String(printId ?? '').trim();
        if (!normalizedPrintId) {
            throw new Error('MediaRepository.getPrint requires a print id.');
        }

        return this.executeGet(`prints/${encodeURIComponent(normalizedPrintId)}`, {}, {
            printId: normalizedPrintId
        }, options);
    }

    async deletePrint(printId, options = {}) {
        const normalizedPrintId =
            typeof printId === 'string' ? printId.trim() : String(printId ?? '').trim();
        if (!normalizedPrintId) {
            throw new Error('MediaRepository.deletePrint requires a print id.');
        }

        return this.executeDelete(`prints/${encodeURIComponent(normalizedPrintId)}`, {
            printId: normalizedPrintId
        }, options);
    }

    async getInventoryItems(params = {}, options = {}) {
        return this.executeGet('inventory', params, {}, options);
    }

    async getUserInventoryItem({ inventoryId, userId } = {}, options = {}) {
        const normalizedInventoryId =
            typeof inventoryId === 'string' ? inventoryId.trim() : String(inventoryId ?? '').trim();
        const normalizedUserId =
            typeof userId === 'string' ? userId.trim() : String(userId ?? '').trim();
        if (!normalizedInventoryId || !normalizedUserId) {
            throw new Error('MediaRepository.getUserInventoryItem requires inventory and user ids.');
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
                this.executeGet(
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

    async consumeInventoryBundle(inventoryId, options = {}) {
        const normalizedInventoryId =
            typeof inventoryId === 'string' ? inventoryId.trim() : String(inventoryId ?? '').trim();
        if (!normalizedInventoryId) {
            throw new Error('MediaRepository.consumeInventoryBundle requires an inventory id.');
        }

        return this.executeRequest(`inventory/${encodeURIComponent(normalizedInventoryId)}/consume`, {
            method: 'PUT',
            params: {
                inventoryId: normalizedInventoryId
            },
            endpoint: options.endpoint
        });
    }

    async redeemReward(code, options = {}) {
        const normalizedCode = typeof code === 'string' ? code.trim() : String(code ?? '').trim();
        if (!normalizedCode) {
            throw new Error('MediaRepository.redeemReward requires a reward code.');
        }

        return this.executeRequest('reward/redeem', {
            method: 'POST',
            params: {
                code: normalizedCode
            },
            endpoint: options.endpoint
        });
    }

    async resizeImageToFitLimits(base64Body) {
        return this.invokeApp('ResizeImageToFitLimits', base64Body);
    }

    async uploadAvatarImageLegacy({ avatarId, imageUrl, base64File, blob, endpoint = '' }) {
        const normalizedAvatarId =
            typeof avatarId === 'string' ? avatarId.trim() : String(avatarId ?? '').trim();
        if (!normalizedAvatarId) {
            throw new Error('MediaRepository.uploadAvatarImageLegacy requires an avatar id.');
        }

        const sourceFileId = extractFileId(imageUrl);
        if (!sourceFileId) {
            throw new Error('Avatar image upload requires an existing source image file id.');
        }

        const fileMd5 = md5Base64(base64File);
        const fileSizeInBytes = Number(blob?.size) || getBase64ByteLength(base64File);
        const signatureFile = await this.invokeApp('SignFile', base64File);
        const signatureMd5 = md5Base64(signatureFile);
        const signatureSizeInBytes = getBase64ByteLength(signatureFile);
        const upload = await this.executeRequest(`file/${encodeURIComponent(sourceFileId)}`, {
            endpoint,
            method: 'POST',
            params: {
                fileMd5,
                fileSizeInBytes,
                signatureMd5,
                signatureSizeInBytes
            }
        });
        const uploadedFileId = upload.json?.id;
        const versions = Array.isArray(upload.json?.versions) ? upload.json.versions : [];
        const fileVersion = versions.at(-1)?.version;
        if (!uploadedFileId || !fileVersion) {
            throw new Error('Avatar image upload did not return a file version.');
        }

        const fileStart = await this.executeRequest(
            `file/${encodeURIComponent(uploadedFileId)}/${fileVersion}/file/start`,
            { endpoint, method: 'PUT', params: {} }
        );
        await this.executeFilePut({
            url: fileStart.json?.url,
            fileData: base64File,
            fileMIME: 'image/png',
            fileMD5: fileMd5
        });
        await this.executeRequest(
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

        const signatureStart = await this.executeRequest(
            `file/${encodeURIComponent(uploadedFileId)}/${fileVersion}/signature/start`,
            { endpoint, method: 'PUT', params: {} }
        );
        await this.executeFilePut({
            url: signatureStart.json?.url,
            fileData: signatureFile,
            fileMIME: 'application/x-rsync-signature',
            fileMD5: signatureMd5
        });
        await this.executeRequest(
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
        const avatarResponse = await this.executeRequest(`avatars/${encodeURIComponent(normalizedAvatarId)}`, {
            endpoint,
            method: 'PUT',
            params: {
                id: normalizedAvatarId,
                imageUrl: nextImageUrl
            }
        });
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

    async uploadWorldImageLegacy({ worldId, imageUrl, base64File, blob, endpoint = '' }) {
        const normalizedWorldId =
            typeof worldId === 'string' ? worldId.trim() : String(worldId ?? '').trim();
        if (!normalizedWorldId) {
            throw new Error('MediaRepository.uploadWorldImageLegacy requires a world id.');
        }

        const sourceFileId = extractFileId(imageUrl);
        if (!sourceFileId) {
            throw new Error('World image upload requires an existing source image file id.');
        }

        const fileMd5 = md5Base64(base64File);
        const fileSizeInBytes = Number(blob?.size) || getBase64ByteLength(base64File);
        const signatureFile = await this.invokeApp('SignFile', base64File);
        const signatureMd5 = md5Base64(signatureFile);
        const signatureSizeInBytes = getBase64ByteLength(signatureFile);
        const upload = await this.executeRequest(`file/${encodeURIComponent(sourceFileId)}`, {
            endpoint,
            method: 'POST',
            params: {
                fileMd5,
                fileSizeInBytes,
                signatureMd5,
                signatureSizeInBytes
            }
        });
        const uploadedFileId = upload.json?.id;
        const versions = Array.isArray(upload.json?.versions) ? upload.json.versions : [];
        const fileVersion = versions.at(-1)?.version;
        if (!uploadedFileId || !fileVersion) {
            throw new Error('World image upload did not return a file version.');
        }

        const fileStart = await this.executeRequest(
            `file/${encodeURIComponent(uploadedFileId)}/${fileVersion}/file/start`,
            { endpoint, method: 'PUT', params: {} }
        );
        await this.executeFilePut({
            url: fileStart.json?.url,
            fileData: base64File,
            fileMIME: 'image/png',
            fileMD5: fileMd5
        });
        await this.executeRequest(
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

        const signatureStart = await this.executeRequest(
            `file/${encodeURIComponent(uploadedFileId)}/${fileVersion}/signature/start`,
            { endpoint, method: 'PUT', params: {} }
        );
        await this.executeFilePut({
            url: signatureStart.json?.url,
            fileData: signatureFile,
            fileMIME: 'application/x-rsync-signature',
            fileMD5: signatureMd5
        });
        await this.executeRequest(
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
        const worldResponse = await this.executeRequest(`worlds/${encodeURIComponent(normalizedWorldId)}`, {
            endpoint,
            method: 'PUT',
            params: {
                id: normalizedWorldId,
                imageUrl: nextImageUrl
            }
        });
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

    async invokeApp(methodName, ...args) {
        try {
            return await backend.app[methodName](...args);
        } catch (error) {
            throw normalizePlatformError(error, `App command failed: ${methodName}`);
        }
    }

    async getFileBase64(path) {
        return this.invokeApp('GetFileBase64', path);
    }

    async getScreenshotMetadata(path) {
        return parseResponseValue(await this.invokeApp('GetScreenshotMetadata', path));
    }

    async deleteScreenshotMetadata(path) {
        return this.invokeApp('DeleteScreenshotMetadata', path);
    }

    async addScreenshotMetadata(path, metadataString, worldId, changeFilename = false) {
        return this.invokeApp(
            'AddScreenshotMetadata',
            path,
            metadataString,
            worldId,
            changeFilename
        );
    }

    async getExtraScreenshotData(path, carouselCache = false) {
        return parseResponseValue(
            await this.invokeApp('GetExtraScreenshotData', path, carouselCache)
        );
    }

    async findScreenshotsBySearch(searchQuery, searchType) {
        return parseResponseValue(
            await this.invokeApp('FindScreenshotsBySearch', searchQuery, searchType)
        );
    }

    async getLastScreenshot() {
        return this.invokeApp('GetLastScreenshot');
    }

    async getVrchatPhotosLocation() {
        return this.invokeApp('GetVrchatPhotosLocation');
    }

    async getUgcPhotoLocation(path = '') {
        return this.invokeApp('GetUGCPhotoLocation', path);
    }

    async openFileSelectorDialog(defaultPath = '', defaultExt = '', defaultFilter = '') {
        return this.invokeApp(
            'OpenFileSelectorDialog',
            defaultPath,
            defaultExt,
            defaultFilter
        );
    }

    async openFolderAndSelectItem(path, isFolder = false) {
        return this.invokeApp('OpenFolderAndSelectItem', path, isFolder);
    }

    async copyImageToClipboard(path) {
        return this.invokeApp('CopyImageToClipboard', path);
    }

    async savePrintToFile(url, ugcFolderPath, monthFolder, fileName) {
        return this.invokeApp('SavePrintToFile', url, ugcFolderPath, monthFolder, fileName);
    }

    async saveStickerToFile(url, ugcFolderPath, monthFolder, fileName) {
        return this.invokeApp('SaveStickerToFile', url, ugcFolderPath, monthFolder, fileName);
    }

    async saveEmojiToFile(url, ugcFolderPath, monthFolder, fileName) {
        return this.invokeApp('SaveEmojiToFile', url, ugcFolderPath, monthFolder, fileName);
    }

    async cropPrintImage(path) {
        return this.invokeApp('CropPrintImage', path);
    }

    async cropAllPrints(ugcFolderPath) {
        return this.invokeApp('CropAllPrints', ugcFolderPath);
    }
}

const mediaRepository = new MediaRepository();

export { MediaRepository };
export default mediaRepository;
