import { toast } from 'sonner';

import { emojiAnimationStyleList } from '@/shared/constants/emoji';
import {
    MAX_IMAGE_UPLOAD_BYTES,
    validateImageUploadFile
} from '@/shared/utils/imageUpload';

import {
    getGalleryGridDensityConfig,
    sanitizeGalleryGridDensity
} from './galleryDensity';

export { MAX_IMAGE_UPLOAD_BYTES };

export const INVENTORY_GRID_DENSITY_STORAGE_KEY = 'VRCX_InventoryGridDensity';

export const CATEGORY_ORDER = ['emojis', 'stickers', 'items', 'cosmetics'];

export const CATEGORY_DEFINITIONS: any = {
    emojis: {
        labelKey: 'dialog.inventory.emojis',
        tabs: [
            {
                key: 'custom',
                labelKey: 'dialog.inventory.custom',
                source: 'file',
                fileTags: ['emoji', 'emojianimated'],
                uploadTarget: 'emojis'
            },
            {
                key: 'exclusive',
                labelKey: 'dialog.inventory.exclusive',
                source: 'inventory',
                params: {
                    types: 'emoji',
                    notFlags: 'ugc',
                    archived: false
                }
            },
            {
                key: 'archived',
                labelKey: 'dialog.inventory.archived',
                source: 'inventory',
                params: {
                    types: 'emoji',
                    archived: true
                }
            }
        ]
    },
    stickers: {
        labelKey: 'dialog.inventory.stickers',
        tabs: [
            {
                key: 'custom',
                labelKey: 'dialog.inventory.custom',
                source: 'file',
                fileTags: ['sticker'],
                uploadTarget: 'stickers'
            },
            {
                key: 'exclusive',
                labelKey: 'dialog.inventory.exclusive',
                source: 'inventory',
                params: {
                    types: 'sticker',
                    notFlags: 'ugc',
                    archived: false
                }
            },
            {
                key: 'archived',
                labelKey: 'dialog.inventory.archived',
                source: 'inventory',
                params: {
                    types: 'sticker',
                    archived: true
                }
            }
        ]
    },
    items: {
        labelKey: 'dialog.inventory.items',
        tabs: [
            {
                key: 'all',
                labelKey: 'dialog.inventory.all_items',
                source: 'inventory',
                params: {
                    types: 'bundle,prop',
                    notFlags: 'ugc',
                    archived: false
                }
            },
            {
                key: 'archived',
                labelKey: 'dialog.inventory.archived',
                source: 'inventory',
                params: {
                    types: 'bundle,prop',
                    archived: true
                }
            }
        ]
    },
    cosmetics: {
        labelKey: 'dialog.inventory.cosmetics',
        tabs: [
            {
                key: 'drones',
                labelKey: 'dialog.inventory.drones',
                source: 'inventory',
                params: {
                    types: 'droneskin',
                    notFlags: 'ugc',
                    archived: false
                }
            },
            {
                key: 'portals',
                labelKey: 'dialog.inventory.portals',
                source: 'inventory',
                params: {
                    types: 'portalskin',
                    notFlags: 'ugc',
                    archived: false
                }
            },
            {
                key: 'warp-effects',
                labelKey: 'dialog.inventory.warp_effects',
                source: 'inventory',
                params: {
                    types: 'warpeffect',
                    notFlags: 'ugc',
                    archived: false
                }
            },
            {
                key: 'loading-screens',
                labelKey: 'dialog.inventory.loading_screens',
                source: 'empty'
            },
            {
                key: 'archived',
                labelKey: 'dialog.inventory.archived',
                source: 'inventory',
                params: {
                    types: 'droneskin,portalskin,warpeffect',
                    archived: true
                }
            }
        ]
    }
};

export function scopeKey(category: any, tab: any) {
    return `${category}:${tab}`;
}

export function readGridDensityPreference() {
    if (typeof window === 'undefined') {
        return sanitizeGalleryGridDensity();
    }
    try {
        return sanitizeGalleryGridDensity(
            window.localStorage.getItem(INVENTORY_GRID_DENSITY_STORAGE_KEY)
        );
    } catch {
        return sanitizeGalleryGridDensity();
    }
}

export function writeGridDensityPreference(value: any) {
    if (typeof window === 'undefined') {
        return;
    }
    try {
        window.localStorage.setItem(INVENTORY_GRID_DENSITY_STORAGE_KEY, value);
    } catch {
        // no-op
    }
}

export function getInventoryGridDensityConfig(gridDensity: any) {
    return getGalleryGridDensityConfig(gridDensity);
}

export function sanitizeInventoryGridDensity(nextValue: any) {
    return sanitizeGalleryGridDensity(nextValue);
}

export function getLatestFileUrl(file: any) {
    const versions = Array.isArray(file?.versions) ? file.versions : [];
    return versions.at(-1)?.file?.url ?? '';
}

export function getUsefulDisplayName(file: any) {
    const displayName = String(file?.displayName || '').trim();
    const name = String(file?.name || '').trim();
    const id = String(file?.id || '').trim();
    const visibleName = displayName || name;

    if (
        !visibleName ||
        visibleName === id ||
        /^file_[\w-]+_blob$/i.test(visibleName)
    ) {
        return '';
    }

    return visibleName;
}

export function resolveInventoryImageUrl(item: any) {
    return (
        item?.imageUrl ||
        item?.thumbnailUrl ||
        item?.item?.imageUrl ||
        item?.item?.thumbnailUrl ||
        item?.template?.imageUrl ||
        item?.template?.thumbnailUrl ||
        item?.metadata?.imageUrl ||
        ''
    );
}

export function resolveInventoryName(item: any) {
    return (
        item?.name ||
        item?.item?.name ||
        item?.template?.name ||
        item?.displayName ||
        item?.id ||
        ''
    );
}

export function resolveInventoryDescription(item: any) {
    return (
        item?.description ||
        item?.item?.description ||
        item?.template?.description ||
        ''
    );
}

export function resolveInventoryType(item: any) {
    return item?.itemType || item?.type || item?.item?.type || '';
}

export function isArchivedInventoryItem(item: any) {
    return Boolean(item?.isArchived || item?.archived);
}

export function resolveEmojiStyleName(rawValue: any) {
    const normalizedValue = String(rawValue || '').toLowerCase();
    const match = Object.keys(emojiAnimationStyleList).find(
        (styleName: any) => styleName.toLowerCase() === normalizedValue
    );
    return match || 'Stop';
}

export function parseEmojiUploadSettings(
    fileName: any,
    currentSettings: any = {}
) {
    const next: any = {
        isAnimated: Boolean(currentSettings.isAnimated),
        animationStyle: currentSettings.animationStyle || 'Stop',
        fps: Number(currentSettings.fps) || 15,
        frames: Number(currentSettings.frames) || 4,
        loopPingPong: Boolean(currentSettings.loopPingPong)
    };
    for (const value of String(fileName || '')
        .replace(/\.[^/.]+$/, '')
        .split('_')) {
        if (value.endsWith('animationStyle')) {
            next.isAnimated = false;
            next.animationStyle = resolveEmojiStyleName(
                value.replace('animationStyle', '')
            );
        } else if (value.endsWith('frames')) {
            const frames = Number.parseInt(value.replace('frames', ''), 10);
            if (Number.isFinite(frames)) {
                next.isAnimated = true;
                next.frames = Math.min(64, Math.max(2, frames));
            }
        } else if (value.endsWith('fps')) {
            const fps = Number.parseInt(value.replace('fps', ''), 10);
            if (Number.isFinite(fps)) {
                next.fps = Math.min(64, Math.max(1, fps));
            }
        } else if (value.endsWith('loopStyle')) {
            next.loopPingPong =
                value.replace('loopStyle', '').toLowerCase() === 'pingpong';
        }
    }
    return next;
}

export function validateImageFile(file: any, t: any) {
    const validation = validateImageUploadFile(file, {
        maxSize: MAX_IMAGE_UPLOAD_BYTES
    });
    if (!validation.ok) {
        toast.error(
            validation.reason === 'too_large'
                ? t('message.file.too_large')
                : t('message.file.not_image')
        );
        return false;
    }
    return true;
}
