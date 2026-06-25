export const DEFAULT_GALLERY_GRID_DENSITY = 'standard';

export const GALLERY_GRID_DENSITY_OPTIONS = Object.freeze([
    {
        value: 'standard',
        labelKey: 'dialog.gallery_icons.density_options.standard'
    },
    {
        value: 'compact',
        labelKey: 'dialog.gallery_icons.density_options.compact'
    },
    {
        value: 'dense',
        labelKey: 'dialog.gallery_icons.density_options.dense'
    }
]);

const DENSITY_VALUES = new Set(
    GALLERY_GRID_DENSITY_OPTIONS.map((option: any) => option.value)
);

const DENSITY_CONFIGS = Object.freeze({
    standard: Object.freeze({
        value: 'standard',
        fileGridClass:
            'grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5',
        printsGridClass:
            'grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4',
        inventoryGridClass:
            'grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5',
        contentClass: 'flex flex-col gap-2.5 p-3',
        metaClass: 'flex flex-col gap-1',
        actionsClass: 'flex flex-wrap gap-1.5',
        actionButtonClass: 'h-8 px-2.5 text-xs'
    }),
    compact: Object.freeze({
        value: 'compact',
        fileGridClass:
            'grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6',
        printsGridClass:
            'grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5',
        inventoryGridClass:
            'grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6',
        contentClass: 'flex flex-col gap-2 p-2.5',
        metaClass: 'flex flex-col gap-0.5',
        actionsClass: 'flex flex-wrap gap-1.5',
        actionButtonClass: 'h-7 px-2 text-xs'
    }),
    dense: Object.freeze({
        value: 'dense',
        fileGridClass:
            'grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5 2xl:grid-cols-7',
        printsGridClass:
            'grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6',
        inventoryGridClass:
            'grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5 2xl:grid-cols-7',
        contentClass: 'flex flex-col gap-1.5 p-2',
        metaClass: 'flex flex-col gap-0.5',
        actionsClass: 'flex flex-wrap gap-1',
        actionButtonClass: 'h-7 px-1.5 text-xs'
    })
});

export function sanitizeGalleryGridDensity(value: any = '') {
    const normalizedValue = typeof value === 'string' ? value.trim() : '';
    return DENSITY_VALUES.has(normalizedValue)
        ? normalizedValue
        : DEFAULT_GALLERY_GRID_DENSITY;
}

export function getGalleryGridDensityConfig(value: any) {
    return DENSITY_CONFIGS[
        sanitizeGalleryGridDensity(value) as keyof typeof DENSITY_CONFIGS
    ];
}
