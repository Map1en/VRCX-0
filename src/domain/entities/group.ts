import type { EntityRecord } from './shared';

type GroupRoleRecord = EntityRecord & {
    id?: string;
    name?: string;
    description?: string;
    isManagementRole?: boolean;
    isSelfAssignable?: boolean;
    permissions?: string[];
};

type GroupGallerySummary = EntityRecord & {
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

type GroupMemberSummary = EntityRecord & {
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

export type GroupPostRecord = GroupAnnouncementRecord & {
    authorId?: string;
    authorDisplayName?: string;
    editorId?: string;
    editorDisplayName?: string;
    imageId?: string | null;
    sendNotification?: boolean;
    visibility?: string;
};

export type GroupGalleryFileRow = EntityRecord & {
    approved?: boolean;
    approvedAt?: string | null;
    approvedByUserId?: string | null;
    createdAt?: string;
    fileId: string;
    galleryId: string;
    groupId: string;
    id: string;
    imageUrl?: string;
    submittedByUserId?: string;
};

export type GroupGalleryPhotoRow = Partial<GroupGalleryFileRow> & {
    $galleryId?: string;
    $galleryName?: string;
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
    group?: EntityRecord & {
        groupId?: string;
        id?: string;
        name?: string;
        iconUrl?: string;
        icon?: string;
        thumbnailUrl?: string;
        thumbnailImageUrl?: string;
        imageUrl?: string;
        image_url?: string;
        bannerUrl?: string;
        bannerImageUrl?: string;
    };
    groupId?: string;
    group_id?: string;
    groupName?: string;
    hardClose?: boolean | null;
    id?: string;
    instanceId?: string;
    instance?: GroupInstanceRecord;
    instancePersistenceEnabled?: boolean | null;
    languageRatio?: Record<string, number>;
    location?: string;
    minimumAvatarPerformance?: string;
    n_users?: number;
    name?: string;
    ownerId?: string;
    owner_id?: string;
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
    worldName?: string;
    groupIconUrl?: string;
    groupIcon?: string;
    groupThumbnailUrl?: string;
    groupThumbnailImageUrl?: string;
    iconUrl?: string;
    icon?: string;
    thumbnailUrl?: string;
    thumbnailImageUrl?: string;
    imageUrl?: string;
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
    gallery?: GroupGalleryPhotoRow[];
    photos?: GroupGalleryPhotoRow[];
    posts?: GroupPostRecord[];
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
