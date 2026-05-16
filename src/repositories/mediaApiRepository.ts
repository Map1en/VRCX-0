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

function resolveMediaEndpoint(endpoint: unknown = '') {
    return normalizeVrchatEndpointDomain(endpoint, {
        allowDebugEndpoint: true
    });
}

function unwrapMediaResponse(
    response: { status: number; data: unknown; raw: unknown },
    {
        params = {},
        extra = {},
        fallbackMessage = 'Media request failed'
    }: {
        params?: MediaApiParams;
        extra?: MediaApiRecord;
        fallbackMessage?: string;
    } = {}
): VrchatRequestResponse<MediaApiRecord> {
    const json = parseJsonResponse(response.data) as MediaApiRecord;
    if (
        response.status >= 400 ||
        (json && typeof json === 'object' && 'error' in json)
    ) {
        throw new Error(
            unwrapErrorMessage(json, response.status, {
                fallbackMessage
            })
        );
    }

    return {
        json,
        params,
        ...extra,
        status: response.status,
        raw: response.raw
    };
}

async function executeMediaCommand(
    command: () => Promise<{ status: number; data: unknown; raw: unknown }>,
    options: {
        params?: MediaApiParams;
        extra?: MediaApiRecord;
        fallbackMessage?: string;
    } = {}
): Promise<VrchatRequestResponse<MediaApiRecord>> {
    try {
        return unwrapMediaResponse(await command(), options);
    } catch (error) {
        throw normalizePlatformError(
            error,
            options.fallbackMessage ?? 'Media request failed'
        );
    }
}

async function uploadFileBytes({
    url,
    fileData,
    fileMIME,
    fileMD5
}: FilePutOptions) {
    const response = await backend.app.BackendMediaFilePut({
        url,
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

async function getFiles(
    params: MediaApiParams = {},
    options: MediaApiOptions = {}
) {
    const normalizedParams = normalizeParams(params);
    return executeMediaCommand(
        () =>
            backend.app.BackendMediaFilesGet({
                endpoint: resolveMediaEndpoint(options.endpoint),
                params: normalizedParams
            }),
        {
            params: normalizedParams
        }
    );
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

    return executeMediaCommand(
        () =>
            backend.app.BackendMediaFileDelete({
                endpoint: resolveMediaEndpoint(options.endpoint),
                fileId: normalizedFileId
            }),
        {
            extra: {
                fileId: normalizedFileId
            }
        }
    );
}

async function uploadGalleryImage(
    imageData: string,
    options: MediaApiOptions = {}
) {
    const params = {
        tag: 'gallery'
    };
    return executeMediaCommand(
        () =>
            backend.app.BackendMediaGalleryImageUpload({
                endpoint: resolveMediaEndpoint(options.endpoint),
                imageData
            }),
        {
            params
        }
    );
}

async function uploadAvatarGalleryImage(
    imageData: string,
    avatarId: QueryValue,
    options: MediaApiOptions = {}
) {
    const params = {
        tag: 'avatargallery',
        galleryId: avatarId
    };
    return executeMediaCommand(
        () =>
            backend.app.BackendMediaAvatarGalleryImageUpload({
                endpoint: resolveMediaEndpoint(options.endpoint),
                imageData,
                avatarId
            }),
        {
            params
        }
    );
}

async function uploadVrcPlusIcon(
    imageData: string,
    options: MediaApiOptions = {}
) {
    const params = {
        tag: 'icon'
    };
    return executeMediaCommand(
        () =>
            backend.app.BackendMediaVrcPlusIconUpload({
                endpoint: resolveMediaEndpoint(options.endpoint),
                imageData
            }),
        {
            params
        }
    );
}

async function uploadEmoji(
    imageData: string,
    params: MediaApiParams = {},
    options: MediaApiOptions = {}
) {
    const normalizedParams = normalizeParams(params);
    return executeMediaCommand(
        () =>
            backend.app.BackendMediaEmojiUpload({
                endpoint: resolveMediaEndpoint(options.endpoint),
                imageData,
                params: normalizedParams
            }),
        {
            params: normalizedParams
        }
    );
}

async function uploadSticker(imageData: string, options: MediaApiOptions = {}) {
    const params = {
        tag: 'sticker',
        maskTag: 'square'
    };
    return executeMediaCommand(
        () =>
            backend.app.BackendMediaStickerUpload({
                endpoint: resolveMediaEndpoint(options.endpoint),
                imageData
            }),
        {
            params
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
    const normalizedParams = normalizeParams(params);
    const response = await executeMediaCommand(
        () =>
            backend.app.BackendMediaPrintUpload({
                endpoint: resolveMediaEndpoint(endpoint),
                imageData,
                cropWhiteBorder: Boolean(cropWhiteBorder),
                params: normalizedParams
            }),
        {
            params: normalizedParams,
            fallbackMessage: 'Print upload failed'
        }
    );
    return {
        ...response,
        params: response.params ?? normalizedParams
    };
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

    return executeMediaCommand(
        () =>
            backend.app.BackendMediaPrintsGet({
                endpoint: resolveMediaEndpoint(options.endpoint),
                userId: normalizedUserId,
                n
            }),
        {
            params: {
                n
            },
            extra: {
                userId: normalizedUserId
            }
        }
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

    return executeMediaCommand(
        () =>
            backend.app.BackendMediaPrintGet({
                endpoint: resolveMediaEndpoint(options.endpoint),
                printId: normalizedPrintId
            }),
        {
            extra: {
                printId: normalizedPrintId
            }
        }
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

    return executeMediaCommand(
        () =>
            backend.app.BackendMediaPrintDelete({
                endpoint: resolveMediaEndpoint(options.endpoint),
                printId: normalizedPrintId
            }),
        {
            extra: {
                printId: normalizedPrintId
            }
        }
    );
}

async function getInventoryItems(
    params: MediaApiParams = {},
    options: MediaApiOptions = {}
) {
    const normalizedParams = normalizeParams(params);
    return executeMediaCommand(
        () =>
            backend.app.BackendMediaInventoryItemsGet({
                endpoint: resolveMediaEndpoint(options.endpoint),
                params: normalizedParams
            }),
        {
            params: normalizedParams
        }
    );
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
            executeMediaCommand(
                () =>
                    backend.app.BackendMediaUserInventoryItemGet({
                        endpoint: resolveMediaEndpoint(options.endpoint),
                        userId: normalizedUserId,
                        inventoryId: normalizedInventoryId
                    }),
                {
                    extra: {
                        inventoryId: normalizedInventoryId,
                        userId: normalizedUserId
                    }
                }
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

    const normalizedParams = normalizeParams(params);
    return executeMediaCommand(
        () =>
            backend.app.BackendMediaInventoryItemUpdate({
                endpoint: resolveMediaEndpoint(options.endpoint),
                inventoryId: normalizedInventoryId,
                params: normalizedParams
            }),
        {
            params: normalizedParams
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

    return executeMediaCommand(
        () =>
            backend.app.BackendMediaInventoryBundleConsume({
                endpoint: resolveMediaEndpoint(options.endpoint),
                inventoryId: normalizedInventoryId
            }),
        {
            params: {
                inventoryId: normalizedInventoryId
            }
        }
    );
}

async function redeemReward(code: unknown, options: MediaApiOptions = {}) {
    const normalizedCode =
        typeof code === 'string' ? code.trim() : String(code ?? '').trim();
    if (!normalizedCode) {
        throw new Error('MediaRepository.redeemReward requires a reward code.');
    }

    return executeMediaCommand(
        () =>
            backend.app.BackendMediaRewardRedeem({
                endpoint: resolveMediaEndpoint(options.endpoint),
                code: normalizedCode
            }),
        {
            params: {
                code: normalizedCode
            }
        }
    );
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
    const upload = await executeMediaCommand(() =>
        backend.app.BackendMediaFileVersionCreate({
            endpoint: resolveMediaEndpoint(endpoint),
            fileId: sourceFileId,
            fileMd5,
            fileSizeInBytes,
            signatureMd5,
            signatureSizeInBytes
        })
    );
    const uploadedFileId = upload.json?.id;
    const versions = Array.isArray(upload.json?.versions)
        ? upload.json.versions
        : [];
    const fileVersion = versions.at(-1)?.version;
    if (!uploadedFileId || !fileVersion) {
        throw new Error('Avatar image upload did not return a file version.');
    }

    const fileStart = await executeMediaCommand(() =>
        backend.app.BackendMediaFileUploadStart({
            endpoint: resolveMediaEndpoint(endpoint),
            fileId: uploadedFileId,
            version: fileVersion,
            kind: 'file'
        })
    );
    await uploadFileBytes({
        url: fileStart.json?.url,
        fileData: base64File,
        fileMIME: 'image/png',
        fileMD5: fileMd5
    });
    await executeMediaCommand(() =>
        backend.app.BackendMediaFileUploadFinish({
            endpoint: resolveMediaEndpoint(endpoint),
            fileId: uploadedFileId,
            version: fileVersion,
            kind: 'file'
        })
    );

    const signatureStart = await executeMediaCommand(() =>
        backend.app.BackendMediaFileUploadStart({
            endpoint: resolveMediaEndpoint(endpoint),
            fileId: uploadedFileId,
            version: fileVersion,
            kind: 'signature'
        })
    );
    await uploadFileBytes({
        url: signatureStart.json?.url,
        fileData: signatureFile,
        fileMIME: 'application/x-rsync-signature',
        fileMD5: signatureMd5
    });
    await executeMediaCommand(() =>
        backend.app.BackendMediaFileUploadFinish({
            endpoint: resolveMediaEndpoint(endpoint),
            fileId: uploadedFileId,
            version: fileVersion,
            kind: 'signature'
        })
    );

    const nextImageUrl = `${resolveMediaEndpoint(endpoint)}/file/${uploadedFileId}/${fileVersion}/file`;
    const avatarResponse = await executeMediaCommand(() =>
        backend.app.BackendMediaAvatarImageSet({
            endpoint: resolveMediaEndpoint(endpoint),
            entityId: normalizedAvatarId,
            imageUrl: nextImageUrl
        })
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
    const upload = await executeMediaCommand(() =>
        backend.app.BackendMediaFileVersionCreate({
            endpoint: resolveMediaEndpoint(endpoint),
            fileId: sourceFileId,
            fileMd5,
            fileSizeInBytes,
            signatureMd5,
            signatureSizeInBytes
        })
    );
    const uploadedFileId = upload.json?.id;
    const versions = Array.isArray(upload.json?.versions)
        ? upload.json.versions
        : [];
    const fileVersion = versions.at(-1)?.version;
    if (!uploadedFileId || !fileVersion) {
        throw new Error('World image upload did not return a file version.');
    }

    const fileStart = await executeMediaCommand(() =>
        backend.app.BackendMediaFileUploadStart({
            endpoint: resolveMediaEndpoint(endpoint),
            fileId: uploadedFileId,
            version: fileVersion,
            kind: 'file'
        })
    );
    await uploadFileBytes({
        url: fileStart.json?.url,
        fileData: base64File,
        fileMIME: 'image/png',
        fileMD5: fileMd5
    });
    await executeMediaCommand(() =>
        backend.app.BackendMediaFileUploadFinish({
            endpoint: resolveMediaEndpoint(endpoint),
            fileId: uploadedFileId,
            version: fileVersion,
            kind: 'file'
        })
    );

    const signatureStart = await executeMediaCommand(() =>
        backend.app.BackendMediaFileUploadStart({
            endpoint: resolveMediaEndpoint(endpoint),
            fileId: uploadedFileId,
            version: fileVersion,
            kind: 'signature'
        })
    );
    await uploadFileBytes({
        url: signatureStart.json?.url,
        fileData: signatureFile,
        fileMIME: 'application/x-rsync-signature',
        fileMD5: signatureMd5
    });
    await executeMediaCommand(() =>
        backend.app.BackendMediaFileUploadFinish({
            endpoint: resolveMediaEndpoint(endpoint),
            fileId: uploadedFileId,
            version: fileVersion,
            kind: 'signature'
        })
    );

    const nextImageUrl = `${resolveMediaEndpoint(endpoint)}/file/${uploadedFileId}/${fileVersion}/file`;
    const worldResponse = await executeMediaCommand(() =>
        backend.app.BackendMediaWorldImageSet({
            endpoint: resolveMediaEndpoint(endpoint),
            entityId: normalizedWorldId,
            imageUrl: nextImageUrl
        })
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
