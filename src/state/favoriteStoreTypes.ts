export type FavoriteKind = 'friend' | 'avatar' | 'world';
export type FavoriteLoadStatus = 'idle' | 'running' | 'ready' | 'error';
export type FavoriteLimits = {
    maxFavoriteGroups: Record<string, unknown>;
    maxFavoritesPerGroup: Record<string, unknown>;
};
export type FavoriteRecord = Record<string, unknown> & {
    id?: string;
    type?: string;
    favoriteId?: string;
    tags?: unknown[];
    $groupKey?: string;
};
export type FavoriteGroup = Record<string, unknown> & {
    key?: unknown;
    count?: number;
};
export type FavoriteGroupMap = Record<string, string[]>;
export type FavoriteDetailsById = Record<string, Record<string, unknown>>;
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
    entity?: unknown;
};
export type RenameLocalFavoriteGroupAction = LocalFavoriteGroupAction & {
    newGroupName?: unknown;
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
    cachedFavoriteGroupsById: Record<string, unknown>;
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
    removeRemoteFavorite(objectId: unknown): void;
    addRemoteFavorite(json?: Record<string, unknown> | null): void;
    getRemoteFavoriteByObjectId(objectId: unknown): FavoriteRecord | null;
    isInAnyLocalFriendGroup(userId: unknown): boolean;
};
