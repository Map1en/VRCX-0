import { createDensityPreset } from '@/lib/densityPreset';

export const DEFAULT_FRIENDS_LOCATIONS_DENSITY = 'compact';

export type FriendsLocationsCardContentMode = 'full' | 'status' | 'identity';

export const FRIENDS_LOCATIONS_DENSITY_OPTIONS = Object.freeze([
    {
        value: 'standard',
        labelKey: 'view.friends_locations.density_options.standard'
    },
    {
        value: 'compact',
        labelKey: 'view.friends_locations.density_options.compact'
    },
    {
        value: 'dense',
        labelKey: 'view.friends_locations.density_options.dense'
    }
]);

const DENSITY_CONFIGS = Object.freeze({
    standard: Object.freeze({
        value: 'standard',
        layout: 'card',
        avatarSize: 44,
        dotSize: 15,
        titleFontSize: 15,
        cardPadding: 10,
        cardGap: 10,
        cardInnerGap: 6,
        gridGap: 12,
        gridMinWidth: 200,
        rowHeight: 132,
        statusOnlyRowHeight: 112,
        identityRowHeight: 64,
        locationLineClamp: 2,
        statusLineClamp: 1,
        showStatusDescription: true
    }),
    compact: Object.freeze({
        value: 'compact',
        layout: 'card',
        avatarSize: 36,
        dotSize: 15,
        titleFontSize: 14,
        cardPadding: 8,
        cardGap: 8,
        cardInnerGap: 5,
        gridGap: 8,
        gridMinWidth: 180,
        rowHeight: 118,
        statusOnlyRowHeight: 92,
        identityRowHeight: 56,
        locationLineClamp: 1,
        statusLineClamp: 1,
        showStatusDescription: true
    }),
    dense: Object.freeze({
        value: 'dense',
        layout: 'item',
        avatarSize: 32,
        dotSize: 15,
        titleFontSize: 14,
        cardPadding: 8,
        cardGap: 8,
        cardInnerGap: 4,
        gridGap: 6,
        gridMinWidth: 180,
        rowHeight: 72,
        statusOnlyRowHeight: 52,
        identityRowHeight: 52,
        locationLineClamp: 1,
        statusLineClamp: 0,
        showStatusDescription: false
    })
});

const preset = createDensityPreset(
    DEFAULT_FRIENDS_LOCATIONS_DENSITY,
    DENSITY_CONFIGS
);

export const sanitizeFriendsLocationsDensity = preset.sanitize;

export const getFriendsLocationsDensityConfig = preset.getConfig;

export function getFriendsLocationsCardRowHeight(
    densityConfig: ReturnType<typeof getFriendsLocationsDensityConfig>,
    contentMode: FriendsLocationsCardContentMode = 'full'
) {
    if (contentMode === 'identity') {
        return densityConfig.identityRowHeight;
    }
    if (contentMode === 'status') {
        return densityConfig.statusOnlyRowHeight;
    }
    return densityConfig.rowHeight;
}
