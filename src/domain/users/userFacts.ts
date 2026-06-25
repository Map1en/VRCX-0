type UserFactSource =
    | 'seed'
    | 'instance'
    | 'playerSnapshot'
    | 'friend'
    | 'profile'
    | 'realtime'
    | 'currentUser'
    | 'gameRuntime';

type UserStateBucket = 'online' | 'active' | 'offline' | '';

interface UserFactLocation {
    tag?: string;
    worldId?: string;
    instanceId?: string;
    groupId?: string;
}

interface UserFactMergeOptions {
    endpoint?: unknown;
    source?: UserFactSource;
    receivedAt?: unknown;
    isCurrentUser?: boolean;
    isFriend?: boolean;
    stateBucket?: unknown;
}

interface UserFact {
    [key: string]: unknown;
    id: string;
    endpoint: string;
    username?: string;
    displayName?: string;
    userIcon?: string;
    profilePicOverride?: string;
    profilePicOverrideThumbnail?: string;
    thumbnailUrl?: string;
    currentAvatar?: string;
    currentAvatarImageUrl?: string;
    currentAvatarThumbnailImageUrl?: string;
    currentAvatarName?: string;
    status?: string;
    statusDescription?: string;
    state?: string;
    stateBucket?: UserStateBucket;
    location?: string;
    travelingToLocation?: string;
    locationAt?: unknown;
    travelingToTime?: unknown;
    friendNumber?: number;
    isCurrentUser?: boolean;
    isFriend?: boolean;
    isBoopingEnabled?: boolean;
    hasSharedConnectionsOptOut?: boolean;
    tags?: unknown[];
    platform?: string;
    last_platform?: string;
    developerType?: string;
    $trustLevel?: string;
    $trustClass?: string;
    $trustSortNum?: number;
    $isModerator?: boolean;
    $isTroll?: boolean;
    $isProbableTroll?: boolean;
    $platform?: string;
    pendingOffline?: boolean;
    $location?: UserFactLocation;
    $travelingToLocation?: UserFactLocation;
    memo?: string;
    note?: string;
    updatedAt: string;
    fieldRanks: Record<string, number>;
    fieldSources: Record<string, string>;
}

function normalizeText(value: unknown): string {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function normalizeUserId(value: unknown): string {
    return normalizeText(value);
}

function normalizeEndpoint(value: unknown): string {
    return normalizeText(value) || 'default';
}

function userFactKey(endpoint: unknown, userId: unknown): string {
    const normalizedUserId = normalizeUserId(userId);
    return normalizedUserId
        ? `${normalizeEndpoint(endpoint)}::${normalizedUserId}`
        : '';
}

function normalizeStateBucket(value: unknown): UserStateBucket {
    const normalized = normalizeText(value).toLowerCase();
    return normalized === 'online' ||
        normalized === 'active' ||
        normalized === 'offline'
        ? normalized
        : '';
}

export {
    normalizeEndpoint,
    normalizeStateBucket,
    normalizeUserId,
    userFactKey
};
export type {
    UserFact,
    UserFactLocation,
    UserFactMergeOptions,
    UserFactSource,
    UserStateBucket
};
