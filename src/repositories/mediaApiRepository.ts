import {
    entityQueryPolicies,
    fetchCachedData,
    queryKeys
} from '@/lib/entityQueryCache.js';
import { getBase64ByteLength, md5Base64 } from '@/shared/utils/binary.js';
import { extractFileId } from '@/shared/utils/fileUtils.js';
import { normalizeVrchatEndpointDomain } from '@/shared/vrchatEndpoint.js';

import { normalizePlatformError } from '../platform/tauri/errors.js';
import { backend } from '../platform/tauri/index.js';
import {
    executeBackendHttpRequest,
    executeVrchatBackendRequest,
    parseJsonResponse,
    type QueryParams,
    type QueryValue,
    type VrchatRequestResponse,
    unwrapErrorMessage
} from './vrchatRequest.js';

type MediaApiRecord = Record<string, any>;
type MediaApiParams = QueryParams;

interface MediaApiOptions {
    endpoint?: string;
    force?: boolean;
    matchingDimensions?: boolean;
}

interface MediaUploadResponse {
    json: MediaApiRecord;
    params: MediaApiParams;
    status: number;
    raw: unknown;
}

interface FilePutOptions {
    url: string;
    fileData: string;
    fileMIME: string;
    fileMD5: string;
}

interface LegacyImageUploadOptions {
    avatarId?: unknown;
    worldId?: unknown;
    imageUrl?: string;
    base64File: string;
    blob?: Blob | { size?: number } | null;
    endpoint?: string;
}

function normalizeParams(params: unknown = {}): MediaApiParams {
    if (!params || typeof params !== 'object') {
        return {};
    }
    return { ...(params as Record<string, QueryValue | QueryValue[]>) };
}

async function executeFilePut({
    url,
    fileData,
    fileMIME,
    fileMD5
}: FilePutOptions) {
    const response = await executeBackendHttpRequest('VrchatMediaExecute', {
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

async function signFile(base64File: string): Promise<string> {
    try {
        return (await backend.app.SignFile(base64File)) as string;
    } catch (error) {
        throw normalizePlatformError(error, 'App command failed: SignFile');
    }
}

async function executeRequest(
    path: string,
    {
        method = 'GET',
        params = {},
        endpoint = ''
    }: { method?: string; params?: MediaApiParams; endpoint?: string } = {}
): Promise<VrchatRequestResponse<MediaApiRecord>> {
    const normalizedParams = normalizeParams(params);

    try {
        return await executeVrchatBackendRequest<MediaApiRecord>(
            'VrchatMediaExecute',
            path,
            {
                endpoint,
                method,
                params: normalizedParams,
                body: normalizedParams,
                allowDebugEndpoint: true,
                fallbackMessage: 'Media request failed',
                includeParams: true
            }
        );
    } catch (error) {
        throw normalizePlatformError(error, 'Media request failed');
    }
}

async function executeGet(
    path: string,
    params: MediaApiParams = {},
    extra: MediaApiRecord = {},
    options: MediaApiOptions = {}
) {
    const normalizedParams = normalizeParams(params);

    try {
        return await executeVrchatBackendRequest('VrchatMediaExecute', path, {
            endpoint: options.endpoint,
            method: 'GET',
            params: normalizedParams,
            allowDebugEndpoint: true,
            fallbackMessage: 'Media request failed',
            includeParams: true,
            extra
        });
    } catch (error) {
        throw normalizePlatformError(error, 'Media request failed');
    }
}

async function executeDelete(
    path: string,
    extra: MediaApiRecord = {},
    options: MediaApiOptions = {}
) {
    try {
        return await executeVrchatBackendRequest('VrchatMediaExecute', path, {
            endpoint: options.endpoint,
            method: 'DELETE',
            jsonBody: false,
            allowDebugEndpoint: true,
            fallbackMessage: 'Media request failed',
            extra
        });
    } catch (error) {
        throw normalizePlatformError(error, 'Media request failed');
    }
}

async function uploadImage(
    path: string,
    imageData: string,
    params: MediaApiParams = {},
    options: MediaApiOptions = {}
): Promise<MediaUploadResponse> {
    try {
        const response = await executeBackendHttpRequest('VrchatMediaExecute', {
            path,
            endpoint: normalizeVrchatEndpointDomain(options.endpoint, {
                allowDebugEndpoint: true
            }),
            uploadImage: true,
            matchingDimensions: Boolean(options.matchingDimensions),
            postData: JSON.stringify(params ?? {}),
            imageData
        });
        const json = parseJsonResponse(response.data) as MediaApiRecord;

        if (response.status >= 400) {
            throw new Error(
                unwrapErrorMessage(json, response.status, {
                    fallbackMessage: 'Media upload failed'
                })
            );
        }

        if (json && typeof json === 'object' && 'error' in json) {
            throw new Error(
                unwrapErrorMessage(json, response.status, {
                    fallbackMessage: 'Media upload failed'
                })
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

async function getFiles(
    params: MediaApiParams = {},
    options: MediaApiOptions = {}
) {
    return executeGet('files', params, {}, options);
}

async function getFileList(
    params: MediaApiParams = {},
    options: MediaApiOptions = {}
) {
    return getFiles(params, options);
}

async function deleteFile(fileId: unknown, options: MediaApiOptions = {}) {
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

async function uploadGalleryImage(
    imageData: string,
    options: MediaApiOptions = {}
) {
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

async function uploadAvatarGalleryImage(
    imageData: string,
    avatarId: QueryValue,
    options: MediaApiOptions = {}
) {
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

async function uploadVrcPlusIcon(
    imageData: string,
    options: MediaApiOptions = {}
) {
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

async function uploadEmoji(
    imageData: string,
    params: MediaApiParams = {},
    options: MediaApiOptions = {}
) {
    return uploadImage('file/image', imageData, params, {
        matchingDimensions: true,
        endpoint: options.endpoint
    });
}

async function uploadSticker(imageData: string, options: MediaApiOptions = {}) {
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
    imageData: string,
    {
        endpoint = '',
        cropWhiteBorder = true,
        params = {}
    }: {
        endpoint?: string;
        cropWhiteBorder?: boolean;
        params?: MediaApiParams;
    } = {}
): Promise<MediaUploadResponse> {
    try {
        const response = await executeBackendHttpRequest('VrchatMediaExecute', {
            path: 'prints',
            endpoint: normalizeVrchatEndpointDomain(endpoint, {
                allowDebugEndpoint: true
            }),
            uploadImagePrint: true,
            cropWhiteBorder: Boolean(cropWhiteBorder),
            postData: JSON.stringify(params ?? {}),
            imageData
        });
        const json = parseJsonResponse(response.data) as MediaApiRecord;

        if (response.status >= 400) {
            throw new Error(
                unwrapErrorMessage(json, response.status, {
                    fallbackMessage: 'Print upload failed'
                })
            );
        }

        if (json && typeof json === 'object' && 'error' in json) {
            throw new Error(
                unwrapErrorMessage(json, response.status, {
                    fallbackMessage: 'Print upload failed'
                })
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

async function getPrints(
    { userId, n = 100 }: { userId?: unknown; n?: number } = {},
    options: MediaApiOptions = {}
) {
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

async function getPrint(printId: unknown, options: MediaApiOptions = {}) {
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

async function deletePrint(printId: unknown, options: MediaApiOptions = {}) {
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

async function getInventoryItems(
    params: MediaApiParams = {},
    options: MediaApiOptions = {}
) {
    return executeGet('inventory', params, {}, options);
}

async function getUserInventoryItem(
    { inventoryId, userId }: { inventoryId?: unknown; userId?: unknown } = {},
    options: MediaApiOptions = {}
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

async function updateInventoryItem(
    inventoryId: unknown,
    params: MediaApiParams = {},
    options: MediaApiOptions = {}
) {
    const normalizedInventoryId =
        typeof inventoryId === 'string'
            ? inventoryId.trim()
            : String(inventoryId ?? '').trim();
    if (!normalizedInventoryId) {
        throw new Error(
            'MediaRepository.updateInventoryItem requires an inventory id.'
        );
    }

    return executeRequest(
        `inventory/${encodeURIComponent(normalizedInventoryId)}`,
        {
            method: 'PUT',
            params,
            endpoint: options.endpoint
        }
    );
}

async function consumeInventoryBundle(
    inventoryId: unknown,
    options: MediaApiOptions = {}
) {
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

async function redeemReward(code: unknown, options: MediaApiOptions = {}) {
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

async function uploadAvatarImageLegacy({
    avatarId,
    imageUrl = '',
    base64File,
    blob,
    endpoint = ''
}: LegacyImageUploadOptions) {
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
    const signatureFile = await signFile(base64File);
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

    const nextImageUrl = `${normalizeVrchatEndpointDomain(endpoint, { allowDebugEndpoint: true })}/file/${uploadedFileId}/${fileVersion}/file`;
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
    imageUrl = '',
    base64File,
    blob,
    endpoint = ''
}: LegacyImageUploadOptions) {
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
    const signatureFile = await signFile(base64File);
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

    const nextImageUrl = `${normalizeVrchatEndpointDomain(endpoint, { allowDebugEndpoint: true })}/file/${uploadedFileId}/${fileVersion}/file`;
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

const mediaApiRepository = Object.freeze({
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
    updateInventoryItem,
    consumeInventoryBundle,
    redeemReward,
    uploadAvatarImageLegacy,
    uploadWorldImageLegacy
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
    updateInventoryItem,
    consumeInventoryBundle,
    redeemReward,
    uploadAvatarImageLegacy,
    uploadWorldImageLegacy
};

export default mediaApiRepository;
