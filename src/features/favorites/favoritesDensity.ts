import type { FavoriteKind } from './favoritesTypes';

export type FavoritesDensity = 'standard' | 'compact';

export const FAVORITES_GROUP_LABEL_EXTRA_HEIGHT = 16;

export const FAVORITES_DENSITY_OPTIONS = Object.freeze([
    {
        value: 'standard',
        labelKey: 'view.friends_locations.density_options.standard'
    },
    {
        value: 'compact',
        labelKey: 'view.friends_locations.density_options.compact'
    }
] as const);

export const DEFAULT_FAVORITES_DENSITY_BY_KIND: Readonly<
    Record<FavoriteKind, FavoritesDensity>
> = Object.freeze({
    friend: 'compact',
    world: 'standard',
    avatar: 'standard'
});

export type FavoritesCoverDensityConfig = Readonly<{
    value: FavoritesDensity;
    layout: 'cover';
    gridMinWidth: number;
    gridGap: number;
    textAreaHeight: number;
    imageAspectRatio: number;
}>;

export type FavoritesRowDensityConfig = Readonly<{
    value: FavoritesDensity;
    layout: 'row';
    gridMinWidth: number;
    gridGap: number;
    rowHeight: number;
    mediaWidth: number;
    mediaHeight: number;
}>;

export type FavoritesDensityConfig =
    | FavoritesCoverDensityConfig
    | FavoritesRowDensityConfig;

const WORLD_AVATAR_DENSITY_CONFIGS: Readonly<
    Record<FavoritesDensity, FavoritesDensityConfig>
> = Object.freeze({
    standard: Object.freeze({
        value: 'standard',
        layout: 'cover',
        gridMinWidth: 220,
        gridGap: 10,
        textAreaHeight: 60,
        imageAspectRatio: 4 / 3
    }),
    compact: Object.freeze({
        value: 'compact',
        layout: 'row',
        gridMinWidth: 240,
        gridGap: 8,
        rowHeight: 60,
        mediaWidth: 64,
        mediaHeight: 48
    })
});

const FRIEND_DENSITY_CONFIGS: Readonly<
    Record<FavoritesDensity, FavoritesDensityConfig>
> = Object.freeze({
    standard: Object.freeze({
        value: 'standard',
        layout: 'row',
        gridMinWidth: 260,
        gridGap: 10,
        rowHeight: 72,
        mediaWidth: 44,
        mediaHeight: 44
    }),
    compact: Object.freeze({
        value: 'compact',
        layout: 'row',
        gridMinWidth: 260,
        gridGap: 8,
        rowHeight: 52,
        mediaWidth: 36,
        mediaHeight: 36
    })
});

const DENSITY_CONFIGS_BY_KIND: Readonly<
    Record<
        FavoriteKind,
        Readonly<Record<FavoritesDensity, FavoritesDensityConfig>>
    >
> = Object.freeze({
    friend: FRIEND_DENSITY_CONFIGS,
    world: WORLD_AVATAR_DENSITY_CONFIGS,
    avatar: WORLD_AVATAR_DENSITY_CONFIGS
});

const DENSITY_VALUES: ReadonlySet<string> = new Set(
    FAVORITES_DENSITY_OPTIONS.map((option) => option.value)
);

export function sanitizeFavoritesDensity(
    kind: FavoriteKind,
    value: unknown
): FavoritesDensity {
    const normalizedValue = typeof value === 'string' ? value.trim() : '';
    return DENSITY_VALUES.has(normalizedValue)
        ? (normalizedValue as FavoritesDensity)
        : DEFAULT_FAVORITES_DENSITY_BY_KIND[kind];
}

export function getFavoritesDensityConfig(
    kind: FavoriteKind,
    value: unknown
): FavoritesDensityConfig {
    return DENSITY_CONFIGS_BY_KIND[kind][sanitizeFavoritesDensity(kind, value)];
}

export function getFavoritesCardHeight({
    config,
    columnWidth,
    showGroupLabel
}: {
    config: FavoritesDensityConfig;
    columnWidth: number;
    showGroupLabel?: boolean;
}): number {
    const groupExtra = showGroupLabel ? FAVORITES_GROUP_LABEL_EXTRA_HEIGHT : 0;
    return config.layout === 'cover'
        ? Math.round(columnWidth / config.imageAspectRatio) +
              config.textAreaHeight +
              groupExtra
        : config.rowHeight + groupExtra;
}
