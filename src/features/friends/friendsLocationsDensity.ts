export const DEFAULT_FRIENDS_LOCATIONS_DENSITY = 'compact';

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
        dotSize: 11,
        titleFontSize: 15,
        cardPadding: 10,
        cardGap: 10,
        cardInnerGap: 6,
        gridGap: 12,
        gridMinWidth: 200,
        rowHeight: 158,
        locationLineClamp: 2,
        statusLineClamp: 1,
        showStatusDescription: true
    }),
    compact: Object.freeze({
        value: 'compact',
        layout: 'card',
        avatarSize: 36,
        dotSize: 10,
        titleFontSize: 14,
        cardPadding: 8,
        cardGap: 8,
        cardInnerGap: 5,
        gridGap: 8,
        gridMinWidth: 180,
        rowHeight: 118,
        locationLineClamp: 1,
        statusLineClamp: 1,
        showStatusDescription: true
    }),
    dense: Object.freeze({
        value: 'dense',
        layout: 'item',
        avatarSize: 32,
        dotSize: 9,
        titleFontSize: 14,
        cardPadding: 8,
        cardGap: 8,
        cardInnerGap: 4,
        gridGap: 6,
        gridMinWidth: 180,
        rowHeight: 72,
        locationLineClamp: 1,
        statusLineClamp: 0,
        showStatusDescription: false
    })
});

const DENSITY_VALUES = new Set(
    FRIENDS_LOCATIONS_DENSITY_OPTIONS.map((option: any) => option.value)
);

export function sanitizeFriendsLocationsDensity(value: any) {
    const normalizedValue = typeof value === 'string' ? value.trim() : '';
    return DENSITY_VALUES.has(normalizedValue)
        ? normalizedValue
        : DEFAULT_FRIENDS_LOCATIONS_DENSITY;
}

type FriendsLocationsDensityKey = keyof typeof DENSITY_CONFIGS;

export function getFriendsLocationsDensityConfig(value: any) {
    return DENSITY_CONFIGS[
        sanitizeFriendsLocationsDensity(value) as FriendsLocationsDensityKey
    ];
}
