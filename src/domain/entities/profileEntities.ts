export type EntityRecord = Record<string, unknown>;

export type EntityTimestamp = string | null;

export type UserBadgeRecord = EntityRecord & {
    assignedAt?: string;
    badgeDescription?: string;
    badgeId?: string;
    badgeImageUrl?: string;
    badgeName?: string;
    hidden?: boolean;
    showcased?: boolean;
    updatedAt?: string;
};

export type UserModerationState = {
    block: boolean;
    mute: boolean;
};

export type UserTravelingLocation = EntityRecord & {
    accessType?: string;
    accessTypeName?: string;
    ageGate?: boolean;
    canRequestInvite?: boolean;
    friendsId?: string | null;
    groupAccessType?: string | null;
    groupId?: string | null;
    hiddenId?: string | null;
    instanceId?: string;
    instanceName?: string;
    isOffline?: boolean;
    isPrivate?: boolean;
    isRealInstance?: boolean;
    isTraveling?: boolean;
    location?: string;
    privateId?: string | null;
    region?: string;
    shortName?: string;
    strict?: boolean;
    tag?: string;
    userId?: string | null;
    worldId?: string;
};

export type UserPlatformHistoryRecord = EntityRecord & {
    isMobile: boolean;
    platform: string;
    recorded: string;
};

export type UserPastDisplayNameRecord = EntityRecord & {
    displayName: string;
    updated_at: string;
};

export type UserProfileEntity = EntityRecord & {
    id?: string;
    displayName?: string;
    username?: string;
    name?: string;
    ageVerificationStatus?: string;
    ageVerified?: boolean;
    allowAvatarCopying?: boolean;
    acceptedPrivacyVersion?: number;
    acceptedTOSVersion?: number;
    accountDeletionDate?: string | null;
    accountDeletionLog?: string | null;
    appleDetails?: EntityRecord;
    appleId?: string;
    badges?: UserBadgeRecord[];
    bannerType?: string;
    bannerUrl?: string;
    bio?: string;
    bioLinks?: string[];
    currentAvatar?: string;
    currentAvatarAuthorId?: string;
    currentAvatarImageUrl?: string;
    currentAvatarName?: string;
    currentAvatarTags?: string[];
    currentAvatarThumbnailImageUrl?: string;
    completedTutorials?: string[];
    contentFilters?: string[];
    date_joined?: string;
    developerType?: string;
    discordId?: string;
    discordDetails?: EntityRecord & { global_name?: string; id?: string };
    emailVerified?: boolean;
    fallbackAvatar?: string;
    friendKey?: string;
    friendGroupNames?: string[];
    friendRequestStatus?: string;
    friends?: string[];
    googleDetails?: EntityRecord;
    googleId?: string;
    hasAcceptedDiscordSocialSDKPerms?: boolean;
    hasBirthday?: boolean;
    hasDiscordFriendsOptOut?: boolean;
    hasEmail?: boolean;
    hasLoggedInFromClient?: boolean;
    hasPendingEmail?: boolean;
    hasSharedConnectionsOptOut?: boolean;
    hideContentFilterSettings?: boolean;
    homeLocation?: string;
    iconUrl?: string;
    imageUrl?: string;
    instanceId?: string;
    isAdult?: boolean;
    isBoopingEnabled?: boolean;
    isEconomyCreator?: boolean;
    isFriend?: boolean;
    isTemporary?: boolean;
    last_activity?: EntityTimestamp;
    last_login?: EntityTimestamp;
    last_mobile?: EntityTimestamp;
    last_platform?: string;
    location?: string;
    note?: string;
    obfuscatedEmail?: string;
    obfuscatedPendingEmail?: string;
    oculusId?: string;
    pastDisplayNames?: UserPastDisplayNameRecord[];
    picoId?: string;
    platform?: string;
    platform_history?: UserPlatformHistoryRecord[];
    profilePicOverride?: string;
    profilePicOverrideThumbnail?: string;
    pronouns?: string;
    pronounsHistory?: string[];
    queuedInstance?: string | null;
    receiveMobileInvitations?: boolean;
    state?: string;
    stateBucket?: string;
    status?: string;
    statusDescription?: string;
    statusFirstTime?: boolean;
    statusHistory?: string[];
    steamDetails?: EntityRecord;
    steamId?: string;
    tags?: string[];
    travelingToInstance?: string;
    travelingToLocation?: string;
    travelingToWorld?: string;
    trustLevel?: string;
    temporaryExpiryDate?: string | null;
    twoFactorAuthEnabled?: boolean;
    twoFactorAuthEnabledDate?: string | null;
    unsubscribe?: boolean;
    updated_at?: string;
    userIcon?: string;
    userLanguage?: string | null;
    userLanguageCode?: string;
    usesGeneratedPassword?: boolean;
    viveId?: string;
    worldId?: string;
    $customTag?: string;
    $customTagColour?: string;
    $friendNumber?: number;
    $isModerator?: boolean;
    $isProbableTroll?: boolean;
    $isTroll?: boolean;
    $isVRCPlus?: boolean;
    $joinCount?: number;
    $languages?: string[];
    $lastSeen?: string;
    $moderations?: EntityRecord;
    $mutualCount?: number;
    $mutualOptedOut?: boolean;
    $nickName?: string;
    $offline_for?: number | null;
    $platform?: string;
    $previousLocation?: string;
    $profileSource?: string;
    $timeSpent?: number;
    $travelingToLocation?: UserTravelingLocation;
    $trustClass?: string;
    $trustLevel?: string;
    $trustSortNum?: number;
    $userColour?: string;
};

export type UserProfileRecord = UserProfileEntity & {
    $trustLevel: string;
    $trustClass: string;
    $trustSortNum: number;
    $isModerator: boolean;
    $isTroll: boolean;
    $isProbableTroll: boolean;
    $platform: string;
};

export type GroupRoleRecord = EntityRecord & {
    id?: string;
    name?: string;
    description?: string;
    isManagementRole?: boolean;
    isSelfAssignable?: boolean;
    permissions?: string[];
};

export type GroupGallerySummary = EntityRecord & {
    createdAt?: string;
    description?: string;
    id: string;
    membersOnly?: boolean;
    name?: string;
    roleIdsToAutoApprove?: string[];
    roleIdsToManage?: string[];
    roleIdsToSubmit?: string[];
    roleIdsToView?: string[] | null;
    updatedAt?: string;
};

export type GroupMemberSummary = EntityRecord & {
    id?: string;
    groupId?: string;
    userId?: string;
    roleIds?: string[];
    mRoleIds?: string[];
    membershipStatus?: string;
    visibility?: string;
    isRepresenting?: boolean;
    isSubscribedToAnnouncements?: boolean;
    isSubscribedToEventAnnouncements?: boolean;
    joinedAt?: string;
};

export type GroupAnnouncementRecord = EntityRecord & {
    createdAt?: string;
    id?: string;
    imageUrl?: string;
    roleIds?: string[];
    text?: string;
    title?: string;
    updatedAt?: string;
};

export type GroupMemberUser = EntityRecord & {
    currentAvatarImageUrl: string;
    currentAvatarTags: string[];
    currentAvatarThumbnailImageUrl: string;
    displayName: string;
    iconUrl: string;
    id: string;
    profilePicOverride: string;
    thumbnailUrl: string;
    userIcon: string;
};

export type GroupMemberRow = EntityRecord & {
    acceptedByDisplayName: string | null;
    acceptedById: string | null;
    bannedAt: string | null;
    createdAt: string;
    groupId: string;
    hasJoinedFromPurchase: boolean;
    id: string;
    isRepresenting: boolean;
    isSubscribedToAnnouncements: boolean;
    isSubscribedToEventAnnouncements: boolean;
    joinedAt: string;
    lastPostReadAt: string | null;
    mRoleIds: string[];
    managerNotes: string | null;
    membershipStatus: string;
    roleIds: string[];
    user: GroupMemberUser;
    userId: string;
    visibility: string;
};

export type GroupAuditLogData = EntityRecord;

export type GroupAuditLogRow = EntityRecord & {
    actorDisplayName: string;
    actorId: string;
    created_at: string;
    data: GroupAuditLogData;
    description: string;
    eventType: string;
    groupId: string;
    id: string;
    targetId: string;
};

export type GroupInstanceRecord = EntityRecord & {
    active?: boolean;
    ageGate?: boolean;
    calendarEntryId?: string | null;
    canRequestInvite?: boolean;
    capacity?: number;
    clientNumber?: string;
    closedAt?: string | null;
    contentSettings?: EntityRecord & {
        drones?: boolean;
        prints?: boolean;
        stickers?: boolean;
    };
    disabledPropAbilities?: string[];
    displayName?: string | null;
    dominantLanguage?: string;
    full?: boolean;
    gameServerVersion?: number;
    groupAccessType?: string;
    hardClose?: boolean | null;
    id?: string;
    instanceId?: string;
    instancePersistenceEnabled?: boolean | null;
    languageRatio?: Record<string, number>;
    location?: string;
    minimumAvatarPerformance?: string;
    n_users?: number;
    name?: string;
    ownerId?: string;
    permanent?: boolean;
    photonRegion?: string;
    platforms?: Record<string, number>;
    playerPersistenceEnabled?: boolean;
    queueEnabled?: boolean;
    queueSize?: number;
    recommendedCapacity?: number;
    region?: string;
    roleRestricted?: boolean;
    secureName?: string;
    shortName?: string | null;
    strict?: boolean;
    tags?: string[];
    type?: string;
    userCount?: number;
    world?: EntityRecord;
    worldId?: string;
};

export type GroupDialogInstanceRow = GroupInstanceRecord & {
    friendCount: number;
    id: string;
    instanceId: string;
    location: string;
    ref: EntityRecord;
    tag: string;
    users: EntityRecord[];
    worldId: string;
};

export type GroupProfileRecord = EntityRecord & {
    announcement?: GroupAnnouncementRecord;
    id: string;
    name: string;
    displayName: string;
    description: string;
    rules: string;
    shortCode: string;
    discriminator: string;
    bannerId?: string;
    bannerUrl: string;
    createdAt?: string;
    galleries?: GroupGallerySummary[];
    groupId?: string;
    iconId?: string;
    iconUrl: string;
    initialRoleIds?: string[];
    isRepresenting?: boolean;
    isVerified?: boolean;
    joinState?: string;
    lastPostCreatedAt?: string | null;
    languages: string[];
    links: string[];
    memberCount: number;
    memberCountSyncedAt?: string;
    memberVisibility?: boolean | string;
    membershipStatus: string;
    mutualGroup?: boolean;
    myMember?: GroupMemberSummary | null;
    members?: GroupMemberRow[];
    onlineMemberCount: number;
    ownerId: string;
    ownerDisplayName: string;
    gallery?: EntityRecord[];
    photos?: EntityRecord[];
    posts?: EntityRecord[];
    privacy: string;
    roles: GroupRoleRecord[];
    storeId?: string;
    tags: string[];
    updatedAt?: string;
    url: string;
    userInterest?: unknown;
    $languages?: string[];
    $memberId?: string;
};

export type UnityPackageRecord = EntityRecord & {
    assetUrl?: string;
    assetVersion?: number;
    created_at?: string;
    id?: string;
    platform?: string;
    performanceRating?: string;
    impostorizerVersion?: string;
    scanStatus?: string;
    unitySortNumber?: number;
    unityVersion?: string;
    variant?: string;
    worldSignature?: string;
};

export type FileAnalysisRecord = EntityRecord & {
    created_at?: string;
    encryptionKey?: string;
    fileSize?: number;
    success?: boolean;
    uncompressedSize?: number;
    worldSignature?: string;
    _fileSize?: string;
    _uncompressedSize?: string;
};

export type PlatformFileAnalysis = Record<string, FileAnalysisRecord>;

export type WorldProfileRecord = EntityRecord & {
    id: string;
    name: string;
    description: string;
    authorId: string;
    authorName: string;
    capacity: number;
    created_at?: string;
    createdAt: string;
    defaultContentSettings?: EntityRecord;
    disabledPropAbilities?: string[];
    favorites: number;
    featured?: boolean;
    fileAnalysis?: PlatformFileAnalysis;
    hasPersistData?: boolean;
    heat: number;
    imageUrl: string;
    instances?: unknown[];
    isLabs: boolean;
    labsPublicationDate?: string | null;
    occupants: number;
    organization?: string;
    platforms: string[];
    popularity: number;
    previewYoutubeId?: string | null;
    privateOccupants?: number;
    publicOccupants?: number;
    publicationDate: string | null;
    recommendedCapacity: number;
    releaseStatus: string;
    slimInstances?: unknown[];
    tags: string[];
    thumbnailImageUrl: string;
    udonProducts?: unknown[];
    unityPackages?: UnityPackageRecord[];
    updated_at?: string;
    updatedAt: string;
    urlList?: string[];
    version?: number;
    visits: number;
    $cacheLocked?: boolean;
    $cachePath?: string;
    $cacheSize?: string;
    $isCached?: boolean;
};

export type AvatarStyleSelection = EntityRecord & {
    primary?: string | null;
    secondary?: string | null;
};

export type AvatarLocalTag = {
    tag: string;
    color?: string | null;
};

export type AvatarPerformanceRecord = EntityRecord & {
    android?: string;
    'android-sort'?: number;
    ios?: string;
    'ios-sort'?: number;
    standalonewindows?: string;
    'standalonewindows-sort'?: number;
};

export type AvatarProfileRecord = EntityRecord & {
    id: string;
    name: string;
    description: string;
    acknowledgements?: string | null;
    attribution?: string | null;
    authorId: string;
    authorName: string;
    created_at: string;
    createdAt?: string;
    featured?: boolean;
    fileAnalysis?: PlatformFileAnalysis;
    gallery?: EntityRecord[];
    galleryImages?: (string | EntityRecord)[];
    imageUrl: string;
    listingDate?: string | null;
    pendingUpload?: boolean;
    performance?: AvatarPerformanceRecord;
    releaseStatus: string;
    searchable?: boolean;
    styles?: AvatarStyleSelection;
    tags: string[];
    thumbnailImageUrl: string;
    unityPackageUrl?: string;
    unityPackageUrlObject?: EntityRecord & { unityPackageUrl?: string };
    unityPackages: UnityPackageRecord[];
    updated_at: string;
    updatedAt?: string;
    version: number;
    $cacheLocked?: boolean;
    $cachePath?: string;
    $cacheSize?: string;
    $isCached: boolean;
    $memo: string;
    $tags: AvatarLocalTag[];
    $timeSpent: number;
};

export type UserDialogJson = {
    profile: UserProfileEntity;
    memo: string;
    moderationState: UserModerationState;
    isFriend: boolean;
    isFavorite: boolean;
};

export type WorldDialogJson = {
    world: WorldProfileRecord;
    memo: string;
    hasPersistData: boolean;
    fileAnalysis: PlatformFileAnalysis;
};

export type GroupDialogJson = {
    group: GroupProfileRecord;
    posts: EntityRecord[];
    events: EntityRecord[];
    instances: GroupDialogInstanceRow[];
    members: GroupMemberRow[];
    galleries: GroupGallerySummary[];
    photos: EntityRecord[];
    activeInstances: GroupDialogInstanceRow[];
};

export type AvatarDialogJson = {
    avatar: AvatarProfileRecord;
    memo: string;
    avatarBlocked: boolean;
    galleryImages: (string | EntityRecord)[];
    platformInfo: EntityRecord;
    fileAnalysis: PlatformFileAnalysis;
};
