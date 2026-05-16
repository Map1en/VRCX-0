// @ts-nocheck
export const FILE_TABS = {
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

export const TAB_ORDER = ['gallery', 'icons', 'prints'];
export const DEFAULT_GALLERY_TAB = 'gallery';

export const EMPTY_ASSETS = {
    gallery: [],
    icons: [],
    prints: []
};

export const UPLOAD_ASPECT_RATIOS = {
    gallery: 4 / 3,
    icons: 1,
    prints: 16 / 9
};

export function sanitizeGalleryTab(value) {
    return TAB_ORDER.includes(value) ? value : DEFAULT_GALLERY_TAB;
}
