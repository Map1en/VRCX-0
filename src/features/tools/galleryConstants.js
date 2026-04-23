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
    },
    emojis: {
        tag: 'emoji',
        titleKey: 'dialog.gallery_icons.emojis',
        aspectClass: 'aspect-square',
        max: null
    },
    stickers: {
        tag: 'sticker',
        titleKey: 'dialog.gallery_icons.stickers',
        aspectClass: 'aspect-square',
        max: null
    }
};

export const TAB_ORDER = [
    'gallery',
    'icons',
    'emojis',
    'stickers',
    'prints',
    'inventory'
];

export const EMPTY_ASSETS = {
    gallery: [],
    icons: [],
    emojis: [],
    stickers: [],
    prints: [],
    inventory: []
};

export const UPLOAD_ASPECT_RATIOS = {
    gallery: 4 / 3,
    icons: 1,
    emojis: 1,
    stickers: 1,
    prints: 16 / 9
};
