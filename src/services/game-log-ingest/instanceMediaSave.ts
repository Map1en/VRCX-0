import configRepository from '@/repositories/configRepository';
import mediaRepository from '@/repositories/mediaRepository';
import userProfileRepository from '@/repositories/userProfileRepository';
import {
    getEmojiFileName,
    getPrintFileName,
    getPrintLocalDate
} from '@/shared/utils/gallery';
import {
    parseInventoryFromUrl,
    parsePrintFromUrl
} from '@/shared/utils/gameLog';
import { normalizeString } from '@/shared/utils/string';
import { useRuntimeStore } from '@/state/runtimeStore';

import { delay } from './parsing';

const INSTANCE_MEDIA_SAVE_INTERVAL_MS = 2500;

let instanceMediaSaveQueue: Promise<unknown> = Promise.resolve();

type MediaCache = unknown[];
type MediaSaveTask = () => Promise<unknown> | unknown;
type RepositoryResponse = {
    json?: Record<string, unknown>;
};
type GalleryPrint = {
    authorName?: string;
    createdAt?: string | number | Date;
    timestamp?: string | number | Date;
    id?: string;
    files?: {
        image?: string;
    };
};
type InventoryItem = Record<string, unknown> & {
    itemType?: unknown;
    flags?: unknown;
    metadata?: Record<string, unknown> & {
        imageUrl?: string;
    };
    imageUrl?: string;
    created_at?: unknown;
    holderDisplayName?: unknown;
    ownerDisplayName?: unknown;
    holderId?: unknown;
    holder?: Record<string, unknown>;
    userId?: unknown;
};
type InventoryReference = {
    inventoryId?: unknown;
    userId?: unknown;
};
type StickerSaveRequest = InventoryReference & {
    displayName?: unknown;
};
type StickerGameLog = StickerSaveRequest;

function hasCachedMediaId(cache: MediaCache, id: unknown): boolean {
    const normalizedId = normalizeString(id);
    if (!normalizedId) {
        return true;
    }
    if (cache.includes(normalizedId)) {
        return true;
    }
    cache.push(normalizedId);
    if (cache.length > 100) {
        cache.shift();
    }
    return false;
}

async function getUgcFolderPath(): Promise<string> {
    const configuredPath = normalizeString(
        await configRepository.getString('userGeneratedContentPath', '')
    );
    return normalizeString(
        await mediaRepository.getUgcPhotoLocation(configuredPath)
    );
}

function enqueueInstanceMediaSave(
    cache: MediaCache,
    id: unknown,
    task: MediaSaveTask
): Promise<unknown> {
    if (hasCachedMediaId(cache, id)) {
        return instanceMediaSaveQueue;
    }

    instanceMediaSaveQueue = instanceMediaSaveQueue
        .then(() => delay(INSTANCE_MEDIA_SAVE_INTERVAL_MS))
        .then(task)
        .catch((error: unknown) => {
            console.error('Failed to save instance media:', error);
        });
    return instanceMediaSaveQueue;
}

async function saveInstancePrintToFile(printId: unknown): Promise<void> {
    const ugcFolderPath = await getUgcFolderPath();
    if (!ugcFolderPath) {
        return;
    }

    try {
        const response = (await mediaRepository.getPrint(printId, {
            endpoint: useRuntimeStore.getState().auth.currentUserEndpoint
        })) as RepositoryResponse;
        const print = response.json as GalleryPrint | undefined;
        const imageUrl = print?.files?.image;
        if (!imageUrl) {
            console.warn('Print image URL is missing:', printId);
            return;
        }

        const createdAt = getPrintLocalDate(print);
        const monthFolder = createdAt.toISOString().slice(0, 7);
        const fileName = getPrintFileName(print);
        const filePath = await mediaRepository.savePrintToFile(
            imageUrl,
            ugcFolderPath,
            monthFolder,
            fileName
        );
        if (
            filePath &&
            (await configRepository.getBool('cropInstancePrints', false))
        ) {
            const cropped = await mediaRepository.cropPrintImage(filePath);
            if (!cropped) {
                console.warn('Failed to crop print image:', filePath);
            }
        }
    } catch (error) {
        console.error('Failed to save print to file:', error);
    }
}

async function saveInstanceStickerToFile({
    displayName,
    userId,
    inventoryId
}: StickerSaveRequest): Promise<void> {
    const ugcFolderPath = await getUgcFolderPath();
    if (!ugcFolderPath) {
        return;
    }

    try {
        const response = (await mediaRepository.getUserInventoryItem(
            { inventoryId, userId },
            { endpoint: useRuntimeStore.getState().auth.currentUserEndpoint }
        )) as RepositoryResponse;
        const item = response.json as InventoryItem | undefined;
        if (
            item?.itemType !== 'sticker' ||
            !Array.isArray(item.flags) ||
            !item.flags.includes('ugc')
        ) {
            return;
        }

        const imageUrl = item.metadata?.imageUrl ?? item.imageUrl;
        const createdAt =
            normalizeString(item.created_at) || new Date().toISOString();
        const monthFolder = createdAt.slice(0, 7);
        const fileNameDate = createdAt
            .replace(/:/g, '-')
            .replace(/T/g, '_')
            .replace(/Z/g, '');
        const fileName = `${normalizeString(displayName)}_${fileNameDate}_${inventoryId}.png`;
        await mediaRepository.saveStickerToFile(
            imageUrl || '',
            ugcFolderPath,
            monthFolder,
            fileName
        );
    } catch (error) {
        console.error('Failed to save sticker to file:', error);
    }
}

async function saveInstanceEmojiToFile({
    inventoryId,
    userId
}: InventoryReference): Promise<void> {
    const ugcFolderPath = await getUgcFolderPath();
    if (!ugcFolderPath) {
        return;
    }

    try {
        const response = (await mediaRepository.getUserInventoryItem(
            { inventoryId, userId },
            { endpoint: useRuntimeStore.getState().auth.currentUserEndpoint }
        )) as RepositoryResponse;
        const item = response.json as InventoryItem | undefined;
        if (
            item?.itemType !== 'emoji' ||
            !Array.isArray(item.flags) ||
            !item.flags.includes('ugc')
        ) {
            return;
        }

        const endpoint = useRuntimeStore.getState().auth.currentUserEndpoint;
        let holderDisplayName = normalizeString(
            item.holderDisplayName || item.ownerDisplayName
        );
        const holderUserId = normalizeString(
            item.holderId || item.holder?.id || item.userId || userId
        );
        if (!holderDisplayName) {
            try {
                const profile = await userProfileRepository.getUserProfile({
                    userId: holderUserId || userId,
                    endpoint
                });
                holderDisplayName = normalizeString(profile?.displayName);
            } catch (error) {
                console.warn(
                    'Failed to resolve emoji holder display name:',
                    error
                );
            }
        }

        const emoji: Record<string, unknown> = {
            ...(item.metadata || {}),
            name: `${holderDisplayName || holderUserId || userId}_${inventoryId}`
        };
        const imageUrl = item.metadata?.imageUrl ?? item.imageUrl;
        const createdAt =
            normalizeString(item.created_at) || new Date().toISOString();
        const monthFolder = createdAt.slice(0, 7);
        await mediaRepository.saveEmojiToFile(
            imageUrl || '',
            ugcFolderPath,
            monthFolder,
            getEmojiFileName(emoji)
        );
    } catch (error) {
        console.error('Failed to save emoji to file:', error);
    }
}

function enqueuePrintSave(
    cache: MediaCache,
    requestUrl: unknown
): Promise<unknown> | null {
    const printId = parsePrintFromUrl(normalizeString(requestUrl));
    if (!printId) {
        return null;
    }
    return enqueueInstanceMediaSave(cache, printId, () =>
        saveInstancePrintToFile(printId)
    );
}

function enqueueEmojiSave(
    cache: MediaCache,
    requestUrl: unknown
): Promise<unknown> | null {
    const inventory = parseInventoryFromUrl(normalizeString(requestUrl));
    if (!inventory) {
        return null;
    }
    return enqueueInstanceMediaSave(cache, inventory.inventoryId, () =>
        saveInstanceEmojiToFile(inventory)
    );
}

function enqueueStickerSave(
    cache: MediaCache,
    gameLog: StickerGameLog
): Promise<unknown> {
    const inventoryId = normalizeString(gameLog.inventoryId);
    return enqueueInstanceMediaSave(cache, inventoryId, () =>
        saveInstanceStickerToFile({
            displayName: gameLog.displayName,
            userId: gameLog.userId,
            inventoryId
        })
    );
}

export { enqueueEmojiSave, enqueuePrintSave, enqueueStickerSave };
