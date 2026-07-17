export type FriendRosterBucket = 'online' | 'active' | 'offline';
export type FriendRosterLoadStatus = 'idle' | 'running' | 'ready' | 'error';

export type FriendLocationProjection = Record<string, unknown> & {
    tag?: unknown;
    location?: unknown;
    worldId?: unknown;
    instanceId?: unknown;
    groupId?: unknown;
};

export type FriendProfileFields = {
    $location?: FriendLocationProjection | null;
    $location_at?: number | string | null;
    $previousLocation?: string | null;
    $previousLocation_at?: number | string | null;
    $travelingToLocation?: FriendLocationProjection | null;
    $travelingToTime?: string | null;
    ageVerificationStatus?: string | null;
    ageVerified?: boolean;
    allowAvatarCopying?: boolean;
    badges?: unknown[];
    bannerColor?: string | null;
    bannerType?: string | null;
    bannerUrl?: string | null;
    bio?: string | null;
    bioLinks?: string[];
    currentAvatarAuthorId?: string | null;
    currentAvatarImageUrl?: string | null;
    currentAvatarName?: string | null;
    currentAvatarTags?: string[];
    currentAvatarThumbnailImageUrl?: string | null;
    discordId?: string | null;
    friendKey?: string | null;
    iconFrame?: string | null;
    iconUrl?: string | null;
    profilePicOverride?: string | null;
    profilePicOverrideThumbnail?: string | null;
    status?: string | null;
    statusDescription?: string | null;
    userIcon?: string | null;
};

export type FriendRecordInput = Record<string, unknown> & {
    id?: unknown;
    userId?: unknown;
    user_id?: unknown;
    displayName?: unknown;
    username?: unknown;
    tags?: unknown;
    developerType?: unknown;
    platform?: unknown;
    last_platform?: unknown;
    lastPlatform?: unknown;
    location?: unknown;
    state?: unknown;
    stateBucket?: unknown;
    trustLevel?: unknown;
    $trustLevel?: unknown;
    friendNumber?: unknown;
    $friendNumber?: unknown;
    $trustClass?: unknown;
    $trustSortNum?: unknown;
    $isModerator?: unknown;
    $isTroll?: unknown;
    $isProbableTroll?: unknown;
    $platform?: unknown;
    $profileSource?: unknown;
};

export type FriendRecord = FriendRecordInput &
    FriendProfileFields & {
        id: string;
        displayName: string;
        tags: string[];
        state: FriendRosterBucket;
        stateBucket: FriendRosterBucket;
        trustLevel?: string;
        $trustLevel: string;
        friendNumber?: number | string;
        $friendNumber: number;
        $trustClass: string;
        $trustSortNum: number;
        $isModerator: boolean;
        $isTroll: boolean;
        $isProbableTroll: boolean;
        $platform: string;
    };

export type FriendRosterById = Record<string, FriendRecord>;
export type FriendRosterInputById = Record<string, FriendRecordInput>;

export type FriendRosterOrdering = {
    onlineIds: string[];
    activeIds: string[];
    offlineIds: string[];
    orderedFriendIds: string[];
};

export type FriendRosterSnapshot = FriendRosterOrdering & {
    currentUserId: string | null;
    friendsById: FriendRosterById;
    detail?: string;
};

export type FriendRosterSnapshotInput = Partial<FriendRosterOrdering> & {
    currentUserId?: string | null;
    friendsById?: FriendRosterInputById | null;
    detail?: string;
};

export type FriendRosterSeedSnapshot = {
    currentUserId?: string | null;
    friendsById?: FriendRosterInputById | null;
    detail?: string;
};

export type FriendPatchEntry = {
    userId?: unknown;
    patch?: FriendRecordInput | null;
    stateBucket?: unknown;
    stateBucketAuthority?: unknown;
};

export type FriendRosterState = FriendRosterSnapshot & {
    loadStatus: FriendRosterLoadStatus;
    detail: string;
    lastLoadedAt: string | null;
};

export type FriendRosterStore = FriendRosterState & {
    setRosterLoading(currentUserId: unknown, detail?: string): void;
    setRosterReady(detail?: string): void;
    setRosterSeedSnapshot(snapshot: FriendRosterSeedSnapshot): void;
    setRosterSnapshot(snapshot: FriendRosterSnapshotInput): void;
    setRosterError(detail: string): void;
    applyFriendPatch(entry: FriendPatchEntry & { detail?: string }): void;
    applyFriendPatches(patches?: FriendPatchEntry[], detail?: string): void;
    removeFriend(userId: unknown, detail?: string): void;
    resetRoster(): void;
};
