import {
    configRepository,
    mediaRepository,
    vrchatFriendRepository
} from '@/repositories/index.js';
import {
    getEmojiFileName,
    getPrintFileName,
    getPrintLocalDate
} from '@/shared/utils/gallery.js';
import { parseInventoryFromUrl, parsePrintFromUrl } from '@/shared/utils/gameLog.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';

import { delay, normalizeString } from './parsing.js';

const INSTANCE_MEDIA_SAVE_INTERVAL_MS = 2500;

let instanceMediaSaveQueue = Promise.resolve();

function hasCachedMediaId(cache, id) {
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

async function getUgcFolderPath() {
    const configuredPath = normalizeString(
        await configRepository.getString('userGeneratedContentPath', '')
    );
    return normalizeString(
        await mediaRepository.getUgcPhotoLocation(configuredPath)
    );
}

function enqueueInstanceMediaSave(cache, id, task) {
    if (hasCachedMediaId(cache, id)) {
        return instanceMediaSaveQueue;
    }

    instanceMediaSaveQueue = instanceMediaSaveQueue
        .then(() => delay(INSTANCE_MEDIA_SAVE_INTERVAL_MS))
        .then(task)
        .catch((error) => {
            console.error('Failed to save instance media:', error);
        });
    return instanceMediaSaveQueue;
}

async function saveInstancePrintToFile(printId) {
    const ugcFolderPath = await getUgcFolderPath();
    if (!ugcFolderPath) {
        return;
    }

    try {
        const response = await mediaRepository.getPrint(printId, {
            endpoint: useRuntimeStore.getState().auth.currentUserEndpoint
        });
        const print = response.json;
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

async function saveInstanceStickerToFile({ displayName, userId, inventoryId }) {
    const ugcFolderPath = await getUgcFolderPath();
    if (!ugcFolderPath) {
        return;
    }

    try {
        const response = await mediaRepository.getUserInventoryItem(
            { inventoryId, userId },
            { endpoint: useRuntimeStore.getState().auth.currentUserEndpoint }
        );
        const item = response.json;
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
            imageUrl,
            ugcFolderPath,
            monthFolder,
            fileName
        );
    } catch (error) {
        console.error('Failed to save sticker to file:', error);
    }
}

async function saveInstanceEmojiToFile({ inventoryId, userId }) {
    const ugcFolderPath = await getUgcFolderPath();
    if (!ugcFolderPath) {
        return;
    }

    try {
        const response = await mediaRepository.getUserInventoryItem(
            { inventoryId, userId },
            { endpoint: useRuntimeStore.getState().auth.currentUserEndpoint }
        );
        const item = response.json;
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
                const userResponse = await vrchatFriendRepository.getUser({
                    userId: holderUserId || userId,
                    endpoint
                });
                holderDisplayName = normalizeString(
                    userResponse.json?.displayName
                );
            } catch (error) {
                console.warn(
                    'Failed to resolve emoji holder display name:',
                    error
                );
            }
        }

        const emoji = {
            ...(item.metadata || {}),
            name: `${holderDisplayName || holderUserId || userId}_${inventoryId}`
        };
        const imageUrl = item.metadata?.imageUrl ?? item.imageUrl;
        const createdAt =
            normalizeString(item.created_at) || new Date().toISOString();
        const monthFolder = createdAt.slice(0, 7);
        await mediaRepository.saveEmojiToFile(
            imageUrl,
            ugcFolderPath,
            monthFolder,
            getEmojiFileName(emoji)
        );
    } catch (error) {
        console.error('Failed to save emoji to file:', error);
    }
}

function enqueuePrintSave(cache, requestUrl) {
    const printId = parsePrintFromUrl(requestUrl);
    if (!printId) {
        return null;
    }
    return enqueueInstanceMediaSave(cache, printId, () =>
        saveInstancePrintToFile(printId)
    );
}

function enqueueEmojiSave(cache, requestUrl) {
    const inventory = parseInventoryFromUrl(requestUrl);
    if (!inventory) {
        return null;
    }
    return enqueueInstanceMediaSave(cache, inventory.inventoryId, () =>
        saveInstanceEmojiToFile(inventory)
    );
}

function enqueueStickerSave(cache, gameLog) {
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
