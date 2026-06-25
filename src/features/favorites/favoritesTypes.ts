export type FavoriteKind = 'friend' | 'world' | 'avatar';

export type FavoriteSource = 'remote' | 'local' | 'history';

export type FavoriteGroup = {
    key: string;
    source: FavoriteSource;
    label: string;
    name?: string;
    type?: string;
    count?: number;
    capacity?: number;
    visibility?: string;
};

export type FavoriteItem = {
    key: string;
    id: string;
    kind: FavoriteKind;
    source: FavoriteSource;
    groupKey?: string;
    groupLabel?: string;
    title?: string;
    subtitle?: string;
    description?: string;
    detailText?: string;
    imageUrl?: string;
    seedData?: unknown;
    isUnavailable?: boolean;
    isPrivate?: boolean;
    location?: string;
    orderIndex?: number;
    playerCount?: number;
    statusLabel?: string;
    statusVariant?: string;
    tags?: string[];
    titleColor?: string;
    travelingToLocation?: string;
};
