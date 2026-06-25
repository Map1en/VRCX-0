export type GalleryTab = 'gallery' | 'icons' | 'prints';
type FileAssetTab = Exclude<GalleryTab, 'prints'>;
type FileTabDefinition = {
    tag: string;
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
export const DEFAULT_GALLERY_TAB = 'gallery';

export const EMPTY_ASSETS: Record<GalleryTab, unknown[]> = {
    gallery: [],
    icons: [],
    prints: []
};

export const UPLOAD_ASPECT_RATIOS: Record<GalleryTab, number> = {
    gallery: 4 / 3,
    icons: 1,
    prints: 16 / 9
};

export function sanitizeGalleryTab(value: unknown): GalleryTab {
    const normalized = String(value || '');
    return normalized === 'gallery' ||
        normalized === 'icons' ||
        normalized === 'prints'
        ? normalized
        : DEFAULT_GALLERY_TAB;
}
