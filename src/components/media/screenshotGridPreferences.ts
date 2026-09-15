import { createDensityPreset } from '@/lib/densityPreset';
import { resolveScreenshotCapturedTime } from '@/shared/utils/screenshot';

export const SCREENSHOT_GRID_DENSITY_OPTIONS = Object.freeze([
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

export type ScreenshotGridDensity =
    (typeof SCREENSHOT_GRID_DENSITY_OPTIONS)[number]['value'];

export const DEFAULT_SCREENSHOT_GRID_DENSITY: ScreenshotGridDensity =
    'standard';

const DENSITY_CONFIGS = Object.freeze({
    standard: Object.freeze({
        value: 'standard',
        cardMinWidth: 208,
        cardHeight: 178,
        gridGap: 12,
        compactCard: false
    }),
    compact: Object.freeze({
        value: 'compact',
        cardMinWidth: 150,
        cardHeight: 156,
        gridGap: 8,
        compactCard: true
    }),
    dense: Object.freeze({
        value: 'dense',
        cardMinWidth: 116,
        cardHeight: 156,
        gridGap: 6,
        compactCard: true
    })
}) satisfies Readonly<Record<ScreenshotGridDensity, unknown>>;

const densityPreset = createDensityPreset(
    DEFAULT_SCREENSHOT_GRID_DENSITY,
    DENSITY_CONFIGS
);

export const sanitizeScreenshotGridDensity = densityPreset.sanitize;

export const getScreenshotGridDensityConfig = densityPreset.getConfig;

export const SCREENSHOT_GRID_SORT_OPTIONS = Object.freeze([
    {
        value: 'captured-desc',
        labelKey: 'dialog.screenshot_metadata.sort_options.captured_desc'
    },
    {
        value: 'captured-asc',
        labelKey: 'dialog.screenshot_metadata.sort_options.captured_asc'
    }
] as const);

export type ScreenshotGridSort =
    (typeof SCREENSHOT_GRID_SORT_OPTIONS)[number]['value'];

const DEFAULT_SCREENSHOT_GRID_SORT: ScreenshotGridSort = 'captured-desc';

export function sanitizeScreenshotGridSort(value: unknown): ScreenshotGridSort {
    return SCREENSHOT_GRID_SORT_OPTIONS.some((option) => option.value === value)
        ? (value as ScreenshotGridSort)
        : DEFAULT_SCREENSHOT_GRID_SORT;
}

export function sortScreenshotGridImages<
    TImage extends {
        capturedAt?: string | null;
        fileName?: string | null;
        modifiedAt?: number | null;
    }
>(images: readonly TImage[], sort: ScreenshotGridSort): TImage[] {
    const direction = sort === 'captured-asc' ? 1 : -1;
    return [...images].sort(
        (left, right) =>
            (resolveScreenshotCapturedTime(left) -
                resolveScreenshotCapturedTime(right)) *
            direction
    );
}

const DENSITY_STORAGE_KEY = 'VRCX_ScreenshotGridDensity';
const SORT_STORAGE_KEY = 'VRCX_ScreenshotGridSort';

function readPreference(key: string): string | null {
    if (typeof window === 'undefined') {
        return null;
    }
    try {
        return window.localStorage.getItem(key);
    } catch {
        return null;
    }
}

function writePreference(key: string, value: string) {
    if (typeof window === 'undefined') {
        return;
    }
    try {
        window.localStorage.setItem(key, value);
    } catch {
        // no-op
    }
}

export function readScreenshotGridDensity(): ScreenshotGridDensity {
    return sanitizeScreenshotGridDensity(readPreference(DENSITY_STORAGE_KEY));
}

export function writeScreenshotGridDensity(value: ScreenshotGridDensity) {
    writePreference(DENSITY_STORAGE_KEY, value);
}

export function readScreenshotGridSort(): ScreenshotGridSort {
    return sanitizeScreenshotGridSort(readPreference(SORT_STORAGE_KEY));
}

export function writeScreenshotGridSort(value: ScreenshotGridSort) {
    writePreference(SORT_STORAGE_KEY, value);
}
