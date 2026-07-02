import {
    entityQueryPolicies,
    fetchCachedData,
    queryKeys
} from '@/lib/entityQueryCache';
import { commands } from '@/platform/tauri/bindings';
import type { PrintFavoriteState } from '@/platform/tauri/bindings';
import { normalizeVrchatEndpointDomain } from '@/shared/vrchatEndpoint';

import { normalizePlatformError } from '../platform/tauri/errors';
import {
    parseJsonResponse,
    type QueryParams,
    type QueryValue,
    type VrchatRequestResponse,
    unwrapErrorMessage
} from './vrchatRequest';

type MediaApiRecord = Record<string, unknown>;
type MediaApiParams = QueryParams;

type MediaFileVersion = Record<string, unknown> & {
    created_at?: string;
    status?: string;
    version?: number;
};

type MediaFileRecord = MediaApiRecord & {
    animationStyle?: string;
    extension?: string;
    id: string;
    maskTag?: string;
    mimeType?: string;
    modifiedThumbnailFileName?: string;
    name?: string;
    ownerId?: string;
    tags?: string[];
    versions?: MediaFileVersion[];
};

type MediaPrintFiles = MediaApiRecord & {
    fileId?: string;
    image?: string;
};

type MediaPrintRecord = MediaApiRecord & {
    authorId?: string;
    authorName?: string;
    createdAt?: string;
    files?: MediaPrintFiles;
    id: string;
    note?: string;
    ownerId?: string;
    timestamp?: string;
    worldId?: string;
    worldName?: string;
};

type InventoryAttribution = MediaApiRecord & {
    creator?: {
        customName?: string;
        userId?: string;
        [key: string]: unknown;
    } | null;
};

type InventoryAttribute = MediaApiRecord & {
    defaultValue?: unknown;
    validator?: MediaApiRecord;
};

type InventoryItemRecord = MediaApiRecord & {
    acquisition?: string;
    attribution?: InventoryAttribution | null;
    collections?: unknown[];
    created_at?: string;
    defaultAttributes?: Record<string, InventoryAttribute>;
    description?: string;
    equipSlot?: string;
    equipSlots?: string[];
    expiryDate?: string | null;
    flags?: string[];
    holderId?: string;
    id: string;
    imageUrl?: string;
    isArchived?: boolean;
    isSeen?: boolean;
    itemType?: string;
    itemTypeLabel?: string;
    last_equipped?: string | null;
    metadata?: MediaApiRecord;
    name?: string;
};

type InventoryItemsResponse = {
    data: InventoryItemRecord[];
    totalCount: number;
};

interface MediaApiOptions {
    endpoint?: string;
    force?: boolean;
}

interface MediaUploadResponse {
    json: MediaApiRecord;
    params: MediaApiParams;
    status?: number;
    raw?: unknown;
}

interface LegacyImageUploadOptions {
    avatarId?: unknown;
    worldId?: unknown;
    imageUrl?: string;
    base64File: string;
    endpoint?: string;
}

interface MediaAssetUploadOptions extends MediaApiOptions {
    assetKind: string;
    cropWhiteBorder?: boolean;
    params?: MediaApiParams;
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
    options?: {
        params?: MediaApiParams;
        extra?: MediaApiRecord;
        fallbackMessage?: string;
    }
): VrchatRequestResponse<MediaApiRecord>;
function unwrapMediaResponse<TJson>(
    response: { status: number; data: unknown; raw: unknown },
    options?: {
        params?: MediaApiParams;
        extra?: MediaApiRecord;
        fallbackMessage?: string;
    }
): VrchatRequestResponse<TJson>;
function unwrapMediaResponse<TJson = MediaApiRecord>(
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
): VrchatRequestResponse<TJson> {
    const json = parseJsonResponse(response.data);
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
        json: json as TJson,
        params,
        ...extra,
        status: response.status,
        raw: response.raw
    };
}

async function executeMediaCommand(
    command: () => Promise<{ status: number; data: unknown; raw: unknown }>,
    options?: {
        params?: MediaApiParams;
        extra?: MediaApiRecord;
        fallbackMessage?: string;
    }
): Promise<VrchatRequestResponse<MediaApiRecord>>;
async function executeMediaCommand<TJson>(
    command: () => Promise<{ status: number; data: unknown; raw: unknown }>,
    options?: {
        params?: MediaApiParams;
        extra?: MediaApiRecord;
        fallbackMessage?: string;
    }
): Promise<VrchatRequestResponse<TJson>>;
async function executeMediaCommand<TJson = MediaApiRecord>(
    command: () => Promise<{ status: number; data: unknown; raw: unknown }>,
    options: {
        params?: MediaApiParams;
        extra?: MediaApiRecord;
        fallbackMessage?: string;
    } = {}
): Promise<VrchatRequestResponse<TJson>> {
    try {
        return unwrapMediaResponse<TJson>(await command(), options);
    } catch (error) {
        throw normalizePlatformError(
            error,
            options.fallbackMessage ?? 'Media request failed'
        );
    }
}

async function getFiles(
    params: MediaApiParams = {},
    options: MediaApiOptions = {}
): Promise<VrchatRequestResponse<MediaFileRecord[]>> {
    const normalizedParams = normalizeParams(params);
    return executeMediaCommand<MediaFileRecord[]>(
        () =>
            commands.appVrchatMediaFilesGet({
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
            commands.appVrchatMediaFileDelete({
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
    const params: MediaApiParams = {
        tag: 'gallery'
    };
    return executeMediaCommand(
        () =>
            commands.appVrchatMediaGalleryImageUpload({
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
    const params: MediaApiParams = {
        tag: 'avatargallery',
        galleryId: avatarId
    };
    return executeMediaCommand(
        () =>
            commands.appVrchatMediaAvatarGalleryImageUpload({
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
    const params: MediaApiParams = {
        tag: 'icon'
    };
    return executeMediaCommand(
        () =>
            commands.appVrchatMediaVrcPlusIconUpload({
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
            commands.appVrchatMediaEmojiUpload({
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
    const params: MediaApiParams = {
        tag: 'sticker',
        maskTag: 'square'
    };
    return executeMediaCommand(
        () =>
            commands.appVrchatMediaStickerUpload({
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
            commands.appVrchatMediaPrintUpload({
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

async function uploadAssetImage(
    imageData: string,
    {
        endpoint = '',
        assetKind,
        cropWhiteBorder = false,
        params = {}
    }: MediaAssetUploadOptions
): Promise<MediaUploadResponse> {
    const normalizedParams = normalizeParams(params);
    const response = await executeMediaCommand(
        () =>
            commands.appVrchatMediaAssetUpload({
                endpoint: resolveMediaEndpoint(endpoint),
                assetKind,
                imageData,
                cropWhiteBorder: Boolean(cropWhiteBorder),
                params: normalizedParams
            }),
        {
            params: normalizedParams,
            fallbackMessage: 'Media asset upload failed'
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
): Promise<VrchatRequestResponse<MediaPrintRecord[]>> {
    const normalizedUserId =
        typeof userId === 'string'
            ? userId.trim()
            : String(userId ?? '').trim();
    if (!normalizedUserId) {
        throw new Error('MediaRepository.getPrints requires a user id.');
    }

    return executeMediaCommand<MediaPrintRecord[]>(
        () =>
            commands.appVrchatMediaPrintsGet({
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
            commands.appVrchatMediaPrintGet({
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
            commands.appVrchatMediaPrintDelete({
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

async function getPrintFavorites(): Promise<PrintFavoriteState> {
    return commands.appVrchatPrintsFavoritesList();
}

async function setPrintFavorite(
    printId: unknown,
    favoriteValue: unknown
): Promise<PrintFavoriteState> {
    const normalizedPrintId =
        typeof printId === 'string'
            ? printId.trim()
            : String(printId ?? '').trim();
    if (!normalizedPrintId) {
        throw new Error(
            'MediaRepository.setPrintFavorite requires a print id.'
        );
    }

    return commands.appVrchatPrintsFavoriteSet({
        printId: normalizedPrintId,
        favorite: favoriteValue === true
    });
}

async function getInventoryItems(
    params: MediaApiParams = {},
    options: MediaApiOptions = {}
): Promise<VrchatRequestResponse<InventoryItemsResponse>> {
    const normalizedParams = normalizeParams(params);
    return executeMediaCommand<InventoryItemsResponse>(
        () =>
            commands.appVrchatMediaInventoryItemsGet({
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
                    commands.appVrchatMediaUserInventoryItemGet({
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
            commands.appVrchatMediaInventoryItemUpdate({
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
            commands.appVrchatMediaInventoryBundleConsume({
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
            commands.appVrchatMediaRewardRedeem({
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

    const response = await executeMediaCommand(
        () =>
            commands.appVrchatMediaAvatarImageUploadLegacy({
                endpoint: resolveMediaEndpoint(endpoint),
                entityId: normalizedAvatarId,
                imageUrl,
                base64File,
                fileSizeInBytes: null
            }),
        {
            fallbackMessage: 'Avatar image upload failed'
        }
    );

    return {
        avatar: response.json?.avatar,
        imageUrl: response.json?.imageUrl,
        fileId: response.json?.fileId,
        fileVersion: response.json?.fileVersion
    };
}

async function uploadWorldImageLegacy({
    worldId,
    imageUrl = '',
    base64File,
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

    const response = await executeMediaCommand(
        () =>
            commands.appVrchatMediaWorldImageUploadLegacy({
                endpoint: resolveMediaEndpoint(endpoint),
                entityId: normalizedWorldId,
                imageUrl,
                base64File,
                fileSizeInBytes: null
            }),
        {
            fallbackMessage: 'World image upload failed'
        }
    );

    return {
        world: response.json?.world,
        imageUrl: response.json?.imageUrl,
        fileId: response.json?.fileId,
        fileVersion: response.json?.fileVersion
    };
}

const vrchatMediaRepository = Object.freeze({
    getFiles,
    getFileList,
    deleteFile,
    uploadGalleryImage,
    uploadAvatarGalleryImage,
    uploadVrcPlusIcon,
    uploadEmoji,
    uploadSticker,
    uploadPrint,
    uploadAssetImage,
    getPrints,
    getPrint,
    deletePrint,
    getPrintFavorites,
    setPrintFavorite,
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
    uploadAssetImage,
    getPrints,
    getPrint,
    deletePrint,
    getPrintFavorites,
    setPrintFavorite,
    getInventoryItems,
    getUserInventoryItem,
    updateInventoryItem,
    consumeInventoryBundle,
    redeemReward,
    uploadAvatarImageLegacy,
    uploadWorldImageLegacy
};

export default vrchatMediaRepository;
