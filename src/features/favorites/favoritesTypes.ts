export type FavoriteKind = 'friend' | 'world' | 'avatar';

export type FavoriteSource = 'remote' | 'local' | 'history';

export type FavoriteSeedData = Record<string, unknown> & {
    displayName?: string;
    groupName?: string;
    id?: string;
    releaseStatus?: string;
    state?: string;
    stateBucket?: string;
    status?: string | null;
    travelingToWorld?: string;
    worldName?: string;
};

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
    authorName?: string;
    description?: string;
    detailText?: string;
    imageSmallUrl?: string;
    imageUrl?: string;
    seedData?: FavoriteSeedData | null;
    isUnavailable?: boolean;
    isPrivate?: boolean;
    isDeleted?: boolean;
    location?: string;
    orderIndex?: number;
    playerCount?: number;
    statusLabel?: string;
    statusVariant?: string;
    tags?: string[];
    titleColor?: string;
    travelingToLocation?: string;
};
