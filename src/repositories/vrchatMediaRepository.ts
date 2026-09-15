import {
    entityQueryPolicies,
    fetchCachedData,
    queryKeys
} from '@/lib/entityQueryCache';
import { commands } from '@/platform/tauri/bindings';
import type {
    EmojiUploadParams,
    HttpApiExecuteResponse,
    InventoryItemUpdateRequest,
    InventoryItemsCollectInput,
    InventoryListParams,
    MediaAssetUploadRequest,
    MediaFileListParams,
    PrintUploadParams,
    PrintFavoriteBulkResult,
    PrintFavoriteState,
    ProfileDecorationEquipSlot
} from '@/platform/tauri/bindings';
import { DEFAULT_VRCHAT_API_ENDPOINT } from '@/shared/vrchatEndpoint';

import { normalizePlatformError } from '../platform/tauri/errors';
import {
    isVrchatRequestError,
    type QueryParams,
    type VrchatRequestResponse,
    unwrapVrchatResponse
} from './vrchatRequest';

type MediaApiRecord = Record<string, unknown>;
type MediaAssetKind = MediaAssetUploadRequest['assetKind'];

type MediaFileVersion = Record<string, unknown> & {
    created_at?: string;
    file?: { url?: string } | null;
    status?: string;
    version?: number;
};

export type MediaFileRecord = MediaApiRecord & {
    animationStyle?: string;
    displayName?: string;
    extension?: string;
    frames?: number;
    framesOverTime?: number;
    id: string;
    maskTag?: string;
    loopStyle?: string;
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

export type MediaPrintRecord = MediaApiRecord & {
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

type InventoryAsset = MediaApiRecord & {
    fileId?: string;
    frameCount?: number;
    framesPerSecond?: number;
    loopCount?: number;
    totalDurationMs?: number;
    type?: string;
    url?: string;
};

type InventoryItemMetadata = MediaApiRecord & {
    assets?: InventoryAsset[];
    gradientEnd?: string;
    gradientStart?: string;
    imageUrl?: string;
};

export type InventoryItemRecord = MediaApiRecord & {
    acquisition?: string;
    attribution?: InventoryAttribution | null;
    collections?: unknown[];
    created_at?: string;
    createdAt?: string;
    defaultAttributes?: Record<string, InventoryAttribute>;
    description?: string;
    equipSlot?: string;
    equipSlots?: string[];
    expiryDate?: string | null;
    flags?: string[];
    holderId?: string;
    id: string;
    imageUrl?: string;
    thumbnailUrl?: string;
    isArchived?: boolean;
    archived?: boolean;
    isSeen?: boolean;
    itemType?: string;
    type?: string;
    itemTypeLabel?: string;
    last_equipped?: Record<string, string> | null;
    metadata?: InventoryItemMetadata;
    name?: string;
    templateId?: string;
    item?: InventoryItemRecord | null;
    template?: InventoryItemRecord | null;
};

type InventoryItemsResponse = {
    data: InventoryItemRecord[];
    totalCount: number;
};

type InventoryItemsCollectResult = {
    items: InventoryItemRecord[];
    truncated: boolean;
};

type ProfileDecorationEquipInput = {
    expectedUserId: string;
    inventoryId: string;
    equipSlot: ProfileDecorationEquipSlot;
};

type ProfileDecorationUnequipInput = {
    expectedUserId: string;
    equipSlot: ProfileDecorationEquipSlot;
};

interface MediaApiOptions {
    force?: boolean;
}

interface MediaUploadResponse {
    json: MediaApiRecord;
    params: QueryParams;
    status?: number;
}

interface LegacyImageUploadOptions {
    avatarId?: string;
    worldId?: string;
    imageUrl?: string;
    base64File: string;
}

type MediaAssetUploadOptions =
    | { assetKind: Extract<MediaAssetKind, 'gallery' | 'icons' | 'stickers'> }
    | { assetKind: 'emojis'; params: EmojiUploadParams }
    | {
          assetKind: 'prints';
          cropWhiteBorder?: boolean;
          params: PrintUploadParams;
      };

interface MediaCommandOptions {
    params?: QueryParams;
    extra?: MediaApiRecord;
    fallbackMessage?: string;
    path?: string;
}

function unwrapMediaResponse(
    response: HttpApiExecuteResponse,
    options?: MediaCommandOptions
): VrchatRequestResponse<MediaApiRecord>;
function unwrapMediaResponse<TJson>(
    response: HttpApiExecuteResponse,
    options?: MediaCommandOptions
): VrchatRequestResponse<TJson>;
function unwrapMediaResponse<TJson = MediaApiRecord>(
    response: HttpApiExecuteResponse,
    {
        params = {},
        extra = {},
        fallbackMessage = 'Media request failed',
        path = 'media'
    }: MediaCommandOptions = {}
): VrchatRequestResponse<TJson> {
    return {
        ...unwrapVrchatResponse<TJson>(response, path, { fallbackMessage }),
        params,
        ...extra,
        status: response.status
    };
}

async function executeMediaCommand(
    command: () => Promise<HttpApiExecuteResponse>,
    options?: MediaCommandOptions
): Promise<VrchatRequestResponse<MediaApiRecord>>;
async function executeMediaCommand<TJson>(
    command: () => Promise<HttpApiExecuteResponse>,
    options?: MediaCommandOptions
): Promise<VrchatRequestResponse<TJson>>;
async function executeMediaCommand<TJson = MediaApiRecord>(
    command: () => Promise<HttpApiExecuteResponse>,
    options: MediaCommandOptions = {}
): Promise<VrchatRequestResponse<TJson>> {
    try {
        return unwrapMediaResponse<TJson>(await command(), options);
    } catch (error) {
        if (isVrchatRequestError(error)) {
            throw error;
        }
        throw normalizePlatformError(
            error,
            options.fallbackMessage ?? 'Media request failed'
        );
    }
}

async function getFiles(
    params: MediaFileListParams = {}
): Promise<VrchatRequestResponse<MediaFileRecord[]>> {
    const normalizedParams = { ...params };
    return executeMediaCommand<MediaFileRecord[]>(
        () =>
            commands.appVrchatMediaFilesGet({
                params: normalizedParams
            }),
        {
            params: normalizedParams
        }
    );
}

async function getFileList(params: MediaFileListParams = {}) {
    return getFiles(params);
}

async function deleteFile(fileId: string) {
    const normalizedFileId = fileId.trim();
    if (!normalizedFileId) {
        throw new Error('MediaRepository.deleteFile requires a file id.');
    }

    return executeMediaCommand(
        () =>
            commands.appVrchatMediaFileDelete({
                fileId: normalizedFileId
            }),
        {
            extra: {
                fileId: normalizedFileId
            }
        }
    );
}

async function uploadGalleryImage(imageData: string) {
    const params: QueryParams = {
        tag: 'gallery'
    };
    return executeMediaCommand(
        () =>
            commands.appVrchatMediaGalleryImageUpload({
                imageData
            }),
        {
            params
        }
    );
}

async function uploadAvatarGalleryImage(imageData: string, avatarId: string) {
    const normalizedAvatarId = avatarId.trim();
    if (!normalizedAvatarId) {
        throw new Error(
            'MediaRepository.uploadAvatarGalleryImage requires an avatar id.'
        );
    }
    const params: QueryParams = {
        tag: 'avatargallery',
        galleryId: normalizedAvatarId
    };
    return executeMediaCommand(
        () =>
            commands.appVrchatMediaAvatarGalleryImageUpload({
                imageData,
                avatarId: normalizedAvatarId
            }),
        {
            params
        }
    );
}

async function uploadVrcPlusIcon(imageData: string) {
    const params: QueryParams = {
        tag: 'icon'
    };
    return executeMediaCommand(
        () =>
            commands.appVrchatMediaVrcPlusIconUpload({
                imageData
            }),
        {
            params
        }
    );
}

async function uploadEmoji(imageData: string, params: EmojiUploadParams) {
    const normalizedParams = { ...params };
    return executeMediaCommand(
        () =>
            commands.appVrchatMediaEmojiUpload({
                imageData,
                params: normalizedParams
            }),
        {
            params: normalizedParams
        }
    );
}

async function uploadSticker(imageData: string) {
    const params: QueryParams = {
        tag: 'sticker',
        maskTag: 'square'
    };
    return executeMediaCommand(
        () =>
            commands.appVrchatMediaStickerUpload({
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
        cropWhiteBorder = true,
        params
    }: {
        cropWhiteBorder?: boolean;
        params: PrintUploadParams;
    }
): Promise<MediaUploadResponse> {
    const normalizedParams = { ...params };
    const response = await executeMediaCommand(
        () =>
            commands.appVrchatMediaPrintUpload({
                imageData,
                cropWhiteBorder,
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
    options: MediaAssetUploadOptions
): Promise<MediaUploadResponse> {
    let input: MediaAssetUploadRequest;
    let normalizedParams: QueryParams = {};
    switch (options.assetKind) {
        case 'gallery':
            input = { assetKind: 'gallery', imageData };
            break;
        case 'icons':
            input = { assetKind: 'icons', imageData };
            break;
        case 'emojis':
            normalizedParams = { ...options.params };
            input = {
                assetKind: 'emojis',
                imageData,
                params: options.params
            };
            break;
        case 'stickers':
            input = { assetKind: 'stickers', imageData };
            break;
        case 'prints':
            normalizedParams = { ...options.params };
            input = {
                assetKind: 'prints',
                imageData,
                cropWhiteBorder: options.cropWhiteBorder ?? false,
                params: options.params
            };
            break;
    }
    const response = await executeMediaCommand(
        () => commands.appVrchatMediaAssetUpload(input),
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

async function getPrints({
    userId,
    n = 100
}: { userId?: string; n?: number } = {}): Promise<
    VrchatRequestResponse<MediaPrintRecord[]>
> {
    const normalizedUserId = userId?.trim() ?? '';
    if (!normalizedUserId) {
        throw new Error('MediaRepository.getPrints requires a user id.');
    }

    return executeMediaCommand<MediaPrintRecord[]>(
        () =>
            commands.appVrchatMediaPrintsGet({
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

async function getPrint(printId: string) {
    const normalizedPrintId = printId.trim();
    if (!normalizedPrintId) {
        throw new Error('MediaRepository.getPrint requires a print id.');
    }

    return executeMediaCommand(
        () =>
            commands.appVrchatMediaPrintGet({
                printId: normalizedPrintId
            }),
        {
            extra: {
                printId: normalizedPrintId
            }
        }
    );
}

async function deletePrint(printId: string) {
    const normalizedPrintId = printId.trim();
    if (!normalizedPrintId) {
        throw new Error('MediaRepository.deletePrint requires a print id.');
    }

    return executeMediaCommand(
        () =>
            commands.appVrchatMediaPrintDelete({
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
    printId: string,
    favoriteValue: boolean
): Promise<PrintFavoriteState> {
    const normalizedPrintId = printId.trim();
    if (!normalizedPrintId) {
        throw new Error(
            'MediaRepository.setPrintFavorite requires a print id.'
        );
    }

    return commands.appVrchatPrintsFavoriteSet({
        printId: normalizedPrintId,
        favorite: favoriteValue
    });
}

async function setPrintFavorites(
    printIds: string[],
    favoriteValue: boolean
): Promise<PrintFavoriteBulkResult> {
    const normalizedPrintIds = printIds
        .map((printId) => printId.trim())
        .filter((printId) => printId.length > 0);

    return commands.appVrchatPrintsFavoritesSet({
        printIds: normalizedPrintIds,
        favorite: favoriteValue
    });
}

async function getInventoryItems(
    params: InventoryListParams = {}
): Promise<VrchatRequestResponse<InventoryItemsResponse>> {
    const normalizedParams = { ...params };
    return executeMediaCommand<InventoryItemsResponse>(
        () =>
            commands.appVrchatMediaInventoryItemsGet({
                params: normalizedParams
            }),
        {
            params: normalizedParams
        }
    );
}

async function collectInventoryItems(
    input: InventoryItemsCollectInput = {}
): Promise<InventoryItemsCollectResult> {
    try {
        const result =
            await commands.appVrchatMediaInventoryItemsCollect(input);
        const items = result.items.flatMap((value) => {
            if (!value || typeof value !== 'object' || Array.isArray(value)) {
                return [];
            }
            const record: Record<string, unknown> = Object.fromEntries(
                Object.entries(value)
            );
            return typeof record.id === 'string'
                ? [{ ...record, id: record.id }]
                : [];
        });
        return {
            items,
            truncated: result.truncated
        };
    } catch (error) {
        throw normalizePlatformError(error, 'Media request failed');
    }
}

async function getInventoryTemplate(
    inventoryTemplateId: string
): Promise<VrchatRequestResponse<InventoryItemRecord>> {
    const normalizedInventoryTemplateId = inventoryTemplateId.trim();
    if (!normalizedInventoryTemplateId) {
        throw new Error(
            'MediaRepository.getInventoryTemplate requires an inventory template id.'
        );
    }

    return fetchCachedData({
        queryKey: queryKeys.inventoryTemplate(
            normalizedInventoryTemplateId,
            DEFAULT_VRCHAT_API_ENDPOINT
        ),
        policy: entityQueryPolicies.inventoryTemplate,
        queryFn: () =>
            executeMediaCommand<InventoryItemRecord>(
                () =>
                    commands.appVrchatMediaInventoryTemplateGet({
                        inventoryTemplateId: normalizedInventoryTemplateId
                    }),
                {
                    extra: {
                        inventoryTemplateId: normalizedInventoryTemplateId
                    }
                }
            )
    });
}

async function equipProfileDecoration({
    expectedUserId,
    inventoryId,
    equipSlot
}: ProfileDecorationEquipInput) {
    const normalizedExpectedUserId = expectedUserId.trim();
    const normalizedInventoryId = inventoryId.trim();
    if (!normalizedExpectedUserId) {
        throw new Error(
            'MediaRepository.equipProfileDecoration requires a user id.'
        );
    }
    if (!normalizedInventoryId) {
        throw new Error(
            'MediaRepository.equipProfileDecoration requires an inventory id.'
        );
    }
    return executeMediaCommand(
        () =>
            commands.appVrchatMediaProfileDecorationEquip({
                inventoryId: normalizedInventoryId,
                equipSlot
            }),
        {
            extra: {
                inventoryId: normalizedInventoryId,
                equipSlot
            }
        }
    );
}

async function unequipProfileDecoration({
    expectedUserId,
    equipSlot
}: ProfileDecorationUnequipInput) {
    const normalizedExpectedUserId = expectedUserId.trim();
    if (!normalizedExpectedUserId) {
        throw new Error(
            'MediaRepository.unequipProfileDecoration requires a user id.'
        );
    }
    return executeMediaCommand<string>(
        () =>
            commands.appVrchatMediaProfileDecorationUnequip({
                equipSlot
            }),
        {
            extra: {
                equipSlot
            }
        }
    );
}

async function getUserInventoryItem(
    { inventoryId, userId }: { inventoryId?: string; userId?: string } = {},
    options: MediaApiOptions = {}
) {
    const normalizedInventoryId = inventoryId?.trim() ?? '';
    const normalizedUserId = userId?.trim() ?? '';
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
            DEFAULT_VRCHAT_API_ENDPOINT
        ),
        policy: entityQueryPolicies.inventoryCollection,
        force: options.force,
        queryFn: () =>
            executeMediaCommand(
                () =>
                    commands.appVrchatMediaUserInventoryItemGet({
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
    inventoryId: string,
    params: InventoryItemUpdateRequest
) {
    const normalizedInventoryId = inventoryId.trim();
    if (!normalizedInventoryId) {
        throw new Error(
            'MediaRepository.updateInventoryItem requires an inventory id.'
        );
    }

    const normalizedParams = { ...params };
    return executeMediaCommand(
        () =>
            commands.appVrchatMediaInventoryItemUpdate({
                inventoryId: normalizedInventoryId,
                params: normalizedParams
            }),
        {
            params: normalizedParams
        }
    );
}

async function consumeInventoryBundle(inventoryId: string) {
    const normalizedInventoryId = inventoryId.trim();
    if (!normalizedInventoryId) {
        throw new Error(
            'MediaRepository.consumeInventoryBundle requires an inventory id.'
        );
    }

    return executeMediaCommand(
        () =>
            commands.appVrchatMediaInventoryBundleConsume({
                inventoryId: normalizedInventoryId
            }),
        {
            params: {
                inventoryId: normalizedInventoryId
            }
        }
    );
}

async function redeemReward(code: string) {
    const normalizedCode = code.trim();
    if (!normalizedCode) {
        throw new Error('MediaRepository.redeemReward requires a reward code.');
    }

    return executeMediaCommand(
        () =>
            commands.appVrchatMediaRewardRedeem({
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
    base64File
}: LegacyImageUploadOptions) {
    const normalizedAvatarId = avatarId?.trim() ?? '';
    if (!normalizedAvatarId) {
        throw new Error(
            'MediaRepository.uploadAvatarImageLegacy requires an avatar id.'
        );
    }

    const response = await executeMediaCommand(
        () =>
            commands.appVrchatMediaAvatarImageUploadLegacy({
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
    base64File
}: LegacyImageUploadOptions) {
    const normalizedWorldId = worldId?.trim() ?? '';
    if (!normalizedWorldId) {
        throw new Error(
            'MediaRepository.uploadWorldImageLegacy requires a world id.'
        );
    }

    const response = await executeMediaCommand(
        () =>
            commands.appVrchatMediaWorldImageUploadLegacy({
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
    setPrintFavorites,
    getInventoryItems,
    collectInventoryItems,
    getInventoryTemplate,
    equipProfileDecoration,
    unequipProfileDecoration,
    getUserInventoryItem,
    updateInventoryItem,
    consumeInventoryBundle,
    redeemReward,
    uploadAvatarImageLegacy,
    uploadWorldImageLegacy
});

export default vrchatMediaRepository;
