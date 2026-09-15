import type { MediaFileTag } from '@/platform/tauri/bindings';
import type {
    InventoryItemRecord,
    MediaFileRecord,
    MediaPrintRecord
} from '@/repositories/mediaRepository';

export type GalleryTab = 'gallery' | 'icons' | 'prints';
export type GalleryAssetTab = GalleryTab | 'inventory';
export type GalleryUploadTarget = GalleryTab | 'emojis' | 'stickers';
export type FileAssetTab = Exclude<GalleryTab, 'prints'>;
export type FileTabDefinition = {
    tag: MediaFileTag;
    titleKey: string;
    aspectClass: string;
    max: number;
};

export const FILE_TABS: Record<FileAssetTab, FileTabDefinition> = {
    gallery: {
        tag: 'gallery',
        titleKey: 'dialog.gallery_icons.gallery',
        aspectClass: 'aspect-[4/3]',
        max: 64
    },
    icons: {
        tag: 'icon',
        titleKey: 'dialog.gallery_icons.icons',
        aspectClass: 'aspect-square',
        max: 64
    }
};

export const TAB_ORDER: GalleryTab[] = ['gallery', 'icons', 'prints'];
const DEFAULT_GALLERY_TAB = 'gallery';

export type GalleryAssets = {
    gallery: MediaFileRecord[];
    icons: MediaFileRecord[];
    prints: MediaPrintRecord[];
    inventory: InventoryItemRecord[];
};

export const EMPTY_ASSETS: GalleryAssets = {
    gallery: [],
    icons: [],
    prints: [],
    inventory: []
};

export const UPLOAD_ASPECT_RATIOS: Record<GalleryTab, number> = {
    gallery: 4 / 3,
    icons: 1,
    prints: 16 / 9
};

export function sanitizeGalleryTab(
    value: string | null | undefined
): GalleryTab {
    const normalized = value || '';
    return normalized === 'gallery' ||
        normalized === 'icons' ||
        normalized === 'prints'
        ? normalized
        : DEFAULT_GALLERY_TAB;
}
