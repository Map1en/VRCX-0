import { PROFILE_DECORATION_ITEM_TYPES } from '@/domain/entities/inventory';
import {
    commands,
    type EmojiUploadParams,
    type InventoryItemsCollectInput,
    type MediaFileTag
} from '@/platform/tauri/bindings';
import type { MediaFileRecord } from '@/repositories/vrchatMediaRepository';
import { toast } from '@/services/toastService';
import {
    emojiAnimationStyleNames,
    type EmojiAnimationStyleName
} from '@/shared/constants/emoji';
import { MAX_IMAGE_UPLOAD_BYTES } from '@/shared/constants/imageUpload';
import {
    readDroppedImageFile,
    validateImageUploadFile
} from '@/shared/utils/imageUpload';

import { emojiAnimationStyleValues } from './emojiAnimationStyles';
import {
    getGalleryGridDensityConfig,
    sanitizeGalleryGridDensity,
    type GalleryGridDensity
} from './galleryDensity';

const INVENTORY_GRID_DENSITY_STORAGE_KEY = 'VRCX_0_InventoryGridDensity';

export const CATEGORY_ORDER = [
    'emojis',
    'stickers',
    'items',
    'cosmetics'
] as const;
export type InventoryCategory = (typeof CATEGORY_ORDER)[number];
export type InventorySource = 'file' | 'inventory' | 'empty';
export type InventoryUploadTarget = 'emojis' | 'stickers';
export type InventoryTabDefinition = {
    key: string;
    labelKey: string;
    source: InventorySource;
    fileTags?: MediaFileTag[];
    uploadTarget?: InventoryUploadTarget;
    params: InventoryItemsCollectInput;
};
export type InventoryCategoryDefinition = {
    labelKey: string;
    tabs: InventoryTabDefinition[];
};
export const INITIAL_INVENTORY_SUB_TABS = Object.freeze({
    emojis: 'custom',
    stickers: 'custom',
    items: 'all',
    cosmetics: 'profile-decorations'
});

export const CATEGORY_DEFINITIONS: Record<
    InventoryCategory,
    InventoryCategoryDefinition
> = {
    emojis: {
        labelKey: 'dialog.inventory.emojis',
        tabs: [
            {
                key: 'custom',
                labelKey: 'dialog.inventory.custom',
                source: 'file',
                fileTags: ['emoji', 'emojianimated'],
                uploadTarget: 'emojis',
                params: {}
            },
            {
                key: 'exclusive',
                labelKey: 'dialog.inventory.exclusive',
                source: 'inventory',
                params: {
                    types: ['emoji'],
                    notFlags: ['ugc'],
                    archived: false
                }
            },
            {
                key: 'archived',
                labelKey: 'dialog.inventory.archived',
                source: 'inventory',
                params: {
                    types: ['emoji'],
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
                uploadTarget: 'stickers',
                params: {}
            },
            {
                key: 'exclusive',
                labelKey: 'dialog.inventory.exclusive',
                source: 'inventory',
                params: {
                    types: ['sticker'],
                    notFlags: ['ugc'],
                    archived: false
                }
            },
            {
                key: 'archived',
                labelKey: 'dialog.inventory.archived',
                source: 'inventory',
                params: {
                    types: ['sticker'],
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
                    types: ['bundle', 'prop'],
                    notFlags: ['ugc'],
                    archived: false
                }
            },
            {
                key: 'archived',
                labelKey: 'dialog.inventory.archived',
                source: 'inventory',
                params: {
                    types: ['bundle', 'prop'],
                    archived: true
                }
            }
        ]
    },
    cosmetics: {
        labelKey: 'dialog.inventory.cosmetics',
        tabs: [
            {
                key: 'profile-decorations',
                labelKey: 'dialog.inventory.profile_decorations',
                source: 'inventory',
                params: {
                    types: [...PROFILE_DECORATION_ITEM_TYPES],
                    notFlags: ['ugc'],
                    archived: false
                }
            },
            {
                key: 'drones',
                labelKey: 'dialog.inventory.drones',
                source: 'inventory',
                params: {
                    types: ['droneskin'],
                    notFlags: ['ugc'],
                    archived: false
                }
            },
            {
                key: 'portals',
                labelKey: 'dialog.inventory.portals',
                source: 'inventory',
                params: {
                    types: ['portalskin'],
                    notFlags: ['ugc'],
                    archived: false
                }
            },
            {
                key: 'warp-effects',
                labelKey: 'dialog.inventory.warp_effects',
                source: 'inventory',
                params: {
                    types: ['warpeffect'],
                    notFlags: ['ugc'],
                    archived: false
                }
            },
            {
                key: 'loading-screens',
                labelKey: 'dialog.inventory.loading_screens',
                source: 'empty',
                params: {}
            },
            {
                key: 'archived',
                labelKey: 'dialog.inventory.archived',
                source: 'inventory',
                params: {
                    types: [
                        'droneskin',
                        'portalskin',
                        'warpeffect',
                        ...PROFILE_DECORATION_ITEM_TYPES
                    ],
                    archived: true
                }
            }
        ]
    }
};

export function scopeKey(category: string, tab: string) {
    return `${category}:${tab}`;
}

export function readGridDensityPreference() {
    return sanitizeGalleryGridDensity(
        localStorage.getItem(INVENTORY_GRID_DENSITY_STORAGE_KEY)
    );
}

export function writeGridDensityPreference(value: GalleryGridDensity) {
    localStorage.setItem(INVENTORY_GRID_DENSITY_STORAGE_KEY, value);
}

export function getInventoryGridDensityConfig(gridDensity: GalleryGridDensity) {
    return getGalleryGridDensityConfig(gridDensity);
}

export function getLatestFileUrl(file: Pick<MediaFileRecord, 'versions'>) {
    const versions = Array.isArray(file?.versions) ? file.versions : [];
    return versions.at(-1)?.file?.url ?? '';
}

export function getUsefulDisplayName(
    file: Partial<Pick<MediaFileRecord, 'displayName' | 'name' | 'id'>>
) {
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

function resolveEmojiStyleName(rawValue: unknown): EmojiAnimationStyleName {
    const normalizedValue = String(rawValue || '').toLowerCase();
    const match = emojiAnimationStyleNames.find(
        (styleName) => styleName.toLowerCase() === normalizedValue
    );
    return match || 'Stop';
}

export type EmojiUploadSettings = {
    isAnimated: boolean;
    animationStyle: string;
    fps: number;
    frames: number;
    loopPingPong: boolean;
};

export function buildEmojiUploadParams(
    settings: EmojiUploadSettings
): EmojiUploadParams {
    const common = {
        animationStyle:
            emojiAnimationStyleValues[
                resolveEmojiStyleName(settings.animationStyle)
            ],
        maskTag: 'square'
    } as const;
    if (!settings.isAnimated) {
        return {
            tag: 'emoji',
            ...common
        };
    }
    return {
        tag: 'emojianimated',
        ...common,
        frames: Math.min(64, Math.max(2, settings.frames || 4)),
        framesOverTime: Math.min(64, Math.max(1, settings.fps || 15)),
        ...(settings.loopPingPong ? { loopStyle: 'pingpong' as const } : {})
    };
}

export function parseEmojiUploadSettings(
    fileName: string,
    currentSettings: Partial<EmojiUploadSettings> = {}
): EmojiUploadSettings {
    const next: EmojiUploadSettings = {
        isAnimated: currentSettings.isAnimated ?? false,
        animationStyle: currentSettings.animationStyle || 'Stop',
        fps: currentSettings.fps || 15,
        frames: currentSettings.frames || 4,
        loopPingPong: currentSettings.loopPingPong ?? false
    };
    for (const value of fileName.replace(/\.[^/.]+$/, '').split('_')) {
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

export async function readDroppedUploadImage(
    paths: string[],
    t: (key: string) => string
) {
    const path = paths[0];
    if (!path) {
        return null;
    }
    try {
        const result = await readDroppedImageFile(path);
        if (result.ok) {
            return result.file;
        }
        toast.add({
            type: 'error',
            title:
                result.reason === 'too_large'
                    ? t('message.file.too_large')
                    : t('message.file.not_image')
        });
    } catch (error) {
        toast.add({
            type: 'error',
            title:
                error instanceof Error
                    ? error.message
                    : t('message.upload.error')
        });
    }
    return null;
}

export async function readClipboardUploadImage(t: (key: string) => string) {
    try {
        const image = await commands.appReadClipboardImage();
        if (image) {
            const bytes = Uint8Array.from(atob(image.dataBase64), (char) =>
                char.charCodeAt(0)
            );
            return new File([bytes], image.fileName, { type: image.mimeType });
        }
        toast.add({
            type: 'error',
            title: t('message.file.clipboard_no_image')
        });
    } catch (error) {
        toast.add({
            type: 'error',
            title:
                error instanceof Error
                    ? error.message
                    : t('message.upload.error')
        });
    }
    return null;
}

export function validateImageFile(file: Blob, t: (key: string) => string) {
    const validation = validateImageUploadFile(file, {
        maxSize: MAX_IMAGE_UPLOAD_BYTES
    });
    if (!validation.ok) {
        toast.add({
            type: 'error',
            title:
                validation.reason === 'too_large'
                    ? t('message.file.too_large')
                    : t('message.file.not_image')
        });
        return false;
    }
    return true;
}
