import { createDensityPreset } from '@/lib/densityPreset';

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
] as const);

export type GalleryGridDensity =
    (typeof GALLERY_GRID_DENSITY_OPTIONS)[number]['value'];

const DEFAULT_GALLERY_GRID_DENSITY: GalleryGridDensity = 'standard';

const DENSITY_CONFIGS = Object.freeze({
    standard: Object.freeze({
        value: 'standard',
        fileGridClass:
            'grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5',
        printsGridClass:
            'grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4',
        inventoryGridClass:
            'grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5',
        contentClass: 'flex flex-col gap-2.5 p-3',
        metaClass: 'flex flex-col gap-1',
        actionsClass: 'flex flex-wrap gap-1.5',
        actionButtonClass: 'h-8 px-2.5 text-xs'
    }),
    compact: Object.freeze({
        value: 'compact',
        fileGridClass:
            'grid grid-cols-3 gap-2.5 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6',
        printsGridClass:
            'grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5',
        inventoryGridClass:
            'grid grid-cols-3 gap-2.5 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6',
        contentClass: 'flex flex-col gap-2 p-2.5',
        metaClass: 'flex flex-col gap-0.5',
        actionsClass: 'flex flex-wrap gap-1.5',
        actionButtonClass: 'h-7 px-2 text-xs'
    }),
    dense: Object.freeze({
        value: 'dense',
        fileGridClass:
            'grid grid-cols-4 gap-2 md:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7',
        printsGridClass:
            'grid grid-cols-3 gap-2 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6',
        inventoryGridClass:
            'grid grid-cols-4 gap-2 md:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7',
        contentClass: 'flex flex-col gap-1.5 p-2',
        metaClass: 'flex flex-col gap-0.5',
        actionsClass: 'flex flex-wrap gap-1',
        actionButtonClass: 'h-7 px-1.5 text-xs'
    })
}) satisfies Readonly<Record<GalleryGridDensity, unknown>>;

const preset = createDensityPreset(
    DEFAULT_GALLERY_GRID_DENSITY,
    DENSITY_CONFIGS
);

export const sanitizeGalleryGridDensity = preset.sanitize;

export const getGalleryGridDensityConfig = preset.getConfig;
