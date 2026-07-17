export type FavoriteKind = 'friend' | 'avatar' | 'world';
export type RemoteFavoriteKind = FavoriteKind | 'vrcPlusWorld' | (string & {});
export type FavoriteVisibility =
    | 'public'
    | 'private'
    | 'friends'
    | (string & {});
export type FavoriteLoadStatus = 'idle' | 'running' | 'ready' | 'error';
export type FavoriteLimits = {
    maxFavoriteGroups: Record<string, number>;
    maxFavoritesPerGroup: Record<string, number>;
};
export type FavoriteRecord = Record<string, unknown> & {
    id?: string;
    type?: RemoteFavoriteKind;
    favoriteId?: string;
    tags?: string[];
    $groupKey?: string;
};
export type FavoriteGroup = Record<string, unknown> & {
    assign?: boolean;
    capacity?: number;
    count?: number;
    displayName?: string;
    key?: string;
    name?: string;
    type?: RemoteFavoriteKind;
    visibility?: FavoriteVisibility;
};
export type FavoriteGroupMap = Record<string, string[]>;
export type FavoriteCachedGroup = Record<string, unknown> & {
    displayName?: string;
    id?: string;
    name?: string;
    ownerDisplayName?: string;
    ownerId?: string;
    tags?: string[];
    type?: RemoteFavoriteKind;
    visibility?: FavoriteVisibility;
};
export type FavoriteEntityDetail = Record<string, unknown> & {
    id?: string;
    name?: string;
    authorId?: string;
    authorName?: string;
    description?: string;
    imageUrl?: string;
    releaseStatus?: string;
    tags?: string[];
    thumbnailImageUrl?: string;
};
export type FavoriteDetailsById = Record<string, FavoriteEntityDetail>;
export type FavoriteSnapshot = Partial<
    Record<keyof FavoriteStoreState, unknown>
> &
    Record<string, unknown> & {
        favoriteLimits?: unknown;
    };
export type LocalFavoriteGroupAction = {
    kind: FavoriteKind;
    groupName: unknown;
};
export type LocalFavoriteAction = LocalFavoriteGroupAction & {
    entityId?: unknown;
    entity?: FavoriteEntityDetail | Record<string, unknown> | null;
};
export type RenameLocalFavoriteGroupAction = LocalFavoriteGroupAction & {
    newGroupName?: unknown;
};
export type LocalFavoritesForKindSnapshot = {
    localFavorites: unknown;
    localFavoriteGroups: unknown;
};
export type RemoteFavoriteCollections = {
    remoteFavoritesByObjectId: Record<string, FavoriteRecord>;
    favoritesSortOrder: string[];
    favoriteFriendIds: string[];
    favoriteWorldIds: string[];
    favoriteAvatarIds: string[];
    groupedFavoriteFriendIdsByGroupKey: Record<string, string[]>;
};
export type FavoriteStoreState = {
    currentUserId: string | null;
    loadStatus: FavoriteLoadStatus;
    detail: string;
    lastLoadedAt: string | null;
    favoriteLimits: FavoriteLimits;
    favoritesSortOrder: string[];
    remoteFavoritesById: Record<string, FavoriteRecord>;
    remoteFavoritesByObjectId: Record<string, FavoriteRecord>;
    favoriteFriendIds: string[];
    groupedFavoriteFriendIdsByGroupKey: Record<string, string[]>;
    favoriteWorldIds: string[];
    favoriteAvatarIds: string[];
    cachedFavoriteGroupsById: Record<string, FavoriteCachedGroup>;
    favoriteFriendGroups: FavoriteGroup[];
    favoriteWorldGroups: FavoriteGroup[];
    favoriteAvatarGroups: FavoriteGroup[];
    localWorldFavorites: FavoriteGroupMap;
    localAvatarFavorites: FavoriteGroupMap;
    localFriendFavorites: FavoriteGroupMap;
    localWorldFavoriteGroups: string[];
    localAvatarFavoriteGroups: string[];
    localFriendFavoriteGroups: string[];
    localWorldFavoritesList: string[];
    localAvatarFavoritesList: string[];
    localFriendFavoritesList: string[];
    localWorldDetailsById: FavoriteDetailsById;
    localAvatarDetailsById: FavoriteDetailsById;
};
export type FavoriteStore = FavoriteStoreState & {
    setFavoritesLoading(currentUserId: unknown, detail?: string): void;
    setFavoritesSnapshot(snapshot?: FavoriteSnapshot): void;
    setFavoritesError(detail: string): void;
    resetFavorites(): void;
    addLocalFavorite(action: LocalFavoriteAction): void;
    removeLocalFavorite(action: LocalFavoriteAction): void;
    createLocalFavoriteGroup(action: LocalFavoriteGroupAction): void;
    renameLocalFavoriteGroup(action: RenameLocalFavoriteGroupAction): void;
    deleteLocalFavoriteGroup(action: LocalFavoriteGroupAction): void;
    setLocalFavoritesForKind(
        kind: FavoriteKind,
        snapshot: LocalFavoritesForKindSnapshot
    ): void;
    removeRemoteFavorite(objectId: unknown): void;
    addRemoteFavorite(json?: Record<string, unknown> | null): void;
    getRemoteFavoriteByObjectId(objectId: unknown): FavoriteRecord | null;
    isInAnyLocalFriendGroup(userId: unknown): boolean;
};
