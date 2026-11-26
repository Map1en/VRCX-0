import type { LoadStatus } from '../shared/types';

export type FavoriteKind = 'friend' | 'avatar' | 'world';
export type LocalFavoriteGroup = {
    id: number;
    kind: FavoriteKind;
    name: string;
    shared: boolean;
};
export type StoredLocalFavoriteKind = Exclude<FavoriteKind, 'world'>;
export type RemoteFavoriteKind = FavoriteKind | 'vrcPlusWorld' | (string & {});
type FavoriteVisibility = 'public' | 'private' | 'friends' | (string & {});
export type FavoriteLoadStatus = LoadStatus;
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
type FavoriteSnapshot = Partial<Record<keyof FavoriteStoreState, unknown>> &
    Record<string, unknown> & {
        favoriteLimits?: unknown;
    };
type LocalFavoriteGroupAction = {
    kind: StoredLocalFavoriteKind;
    groupId: number;
};
type LocalFavoriteAction = LocalFavoriteGroupAction & {
    entityId: string;
    entity?: FavoriteEntityDetail | Record<string, unknown> | null;
};
type RenameLocalFavoriteGroupAction = LocalFavoriteGroupAction & {
    name: string;
};
type LocalFavoritesForKindSnapshot = {
    localFavorites: FavoriteGroupMap;
    localFavoriteGroups: LocalFavoriteGroup[];
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
    localAvatarFavorites: FavoriteGroupMap;
    localFriendFavorites: FavoriteGroupMap;
    localAvatarFavoriteGroups: LocalFavoriteGroup[];
    localFriendFavoriteGroups: LocalFavoriteGroup[];
    localAvatarFavoritesList: string[];
    localFriendFavoritesList: string[];
};
export type FavoriteStore = FavoriteStoreState & {
    setFavoritesLoading(currentUserId: string | null, detail?: string): void;
    setFavoritesSnapshot(snapshot?: FavoriteSnapshot): void;
    setFavoritesError(detail: string): void;
    resetFavorites(): void;
    addLocalFavorite(action: LocalFavoriteAction): void;
    removeLocalFavorite(action: LocalFavoriteAction): void;
    createLocalFavoriteGroup(group: LocalFavoriteGroup): void;
    renameLocalFavoriteGroup(action: RenameLocalFavoriteGroupAction): void;
    deleteLocalFavoriteGroup(action: LocalFavoriteGroupAction): void;
    setLocalFavoritesForKind(
        kind: StoredLocalFavoriteKind,
        snapshot: LocalFavoritesForKindSnapshot
    ): void;
    removeRemoteFavorite(objectId: string): void;
    addRemoteFavorite(json?: Record<string, unknown> | null): void;
    isInAnyLocalFriendGroup(userId: string): boolean;
};
