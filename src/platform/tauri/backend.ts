import { createBackendNamespace, type BackendNamespace } from './commands.js';
import { backendEvents } from './events.js';
import { webview } from './webview.js';

export type { BackendCommand, BackendNamespace } from './commands.js';

export interface AssetBundleCacheCheckResult {
    Item1: number;
    Item2: boolean;
    Item3: string;
    item1?: number;
    item2?: boolean;
    item3?: string;
}

export interface AssetBundleBackendNamespace extends BackendNamespace {
    GetVRChatCacheFullLocation(
        fileId: string,
        fileVersion: number,
        variant: string,
        variantVersion: number
    ): Promise<string>;
    CheckVRChatCache(
        fileId: string,
        fileVersion: number,
        variant: string,
        variantVersion: number
    ): Promise<AssetBundleCacheCheckResult>;
    DeleteCache(
        fileId: string,
        fileVersion: number,
        variant: string,
        variantVersion: number
    ): Promise<void>;
    DeleteAllCache(): Promise<void>;
    SweepCache(): Promise<string[]>;
    GetCacheSize(): Promise<number>;
}

export interface HostCapabilityStatus {
    supported: boolean;
    enabled: boolean;
    available: boolean;
    reason?: string;
}

export interface HostCapabilities {
    platform: 'windows' | 'linux' | 'macos' | 'unknown';
    arch: 'x86_64' | 'aarch64' | 'unknown';
    linuxPackageKind: 'appimage' | 'deb' | 'rpm' | 'unknown';
    localDatabase: HostCapabilityStatus;
    websocketRuntime: HostCapabilityStatus;
    gameLogWatcher: HostCapabilityStatus;
    backendGameLogIngest: HostCapabilityStatus;
    backendGameLogSideEffects: HostCapabilityStatus;
    backendGameClientLifecycle: HostCapabilityStatus;
    backendRealtimeTransport: HostCapabilityStatus;
    gameProcessMonitor: HostCapabilityStatus;
    vrchatPathDiscovery: HostCapabilityStatus;
    steamLibraryDiscovery: HostCapabilityStatus;
    steamRuntimeIntegration: HostCapabilityStatus;
    registryPrefs: HostCapabilityStatus;
    gameLaunch: HostCapabilityStatus;
    ipc: HostCapabilityStatus;
    vrchatLaunchPipe: HostCapabilityStatus;
    screenshotCache: HostCapabilityStatus;
}

export interface LegacyVrcxMigrationStatus {
    detected: boolean;
    available: boolean;
    version?: number;
    dbPath?: string;
    configPath?: string;
    reason?: string;
}

export interface BackendRuntimePhaseSnapshot {
    name: string;
    status: string;
    detail: string;
    updatedAt: string;
}

export interface BackendRuntimeSnapshot {
    startedAt: string;
    hostServicesStarted: boolean;
    phases: BackendRuntimePhaseSnapshot[];
}

export interface BackendBackgroundJobSnapshot {
    name: string;
    owner: string;
    status: string;
    cadenceSeconds?: number | null;
    lastStartedAt?: string | null;
    lastFinishedAt?: string | null;
    nextRunAt?: string | null;
    lastDetail: string;
    lastError?: string | null;
    failureCount: number;
}

export interface BackendSyncDomainSnapshot {
    domain: string;
    status: string;
    detail: string;
    updatedAt: string;
    revision: number;
    pendingCount: number;
    failureCount: number;
}

export interface BackendSyncSnapshot {
    domains: BackendSyncDomainSnapshot[];
}

export interface BackendCommandGroupSnapshot {
    name: string;
    boundary: string;
    commandCount: number;
    examples: string[];
}

export interface BackendCommandObservation {
    command: string;
    status: string;
    detail: string;
    observedAt: string;
}

export interface BackendDiagnosticsSnapshot {
    genericSqlEnabled: boolean;
    frontendWsParsingEnabled: boolean;
    commandGroups: BackendCommandGroupSnapshot[];
    recentCommands: BackendCommandObservation[];
    notes: string[];
}

export interface BackendAppSnapshot {
    runtime: BackendRuntimeSnapshot;
    backgroundJobs: BackendBackgroundJobSnapshot[];
    sync: BackendSyncSnapshot;
    diagnostics: BackendDiagnosticsSnapshot;
    gameLog: Record<string, unknown>;
}

export interface BackendAuthScopeSnapshot {
    currentUserId: string;
    endpoint: string;
    generation: number;
    active: boolean;
}

export interface BackendModerationRefreshResult {
    accepted: boolean;
    userId: string;
    remoteCount: number;
    localCount: number;
    rows: Array<{
        id: string;
        type: string;
        sourceUserId: string;
        sourceDisplayName: string;
        targetUserId: string;
        targetDisplayName: string;
        created: string;
    }>;
}

export interface BackendModerationUpdateResult {
    targetUserId: string;
    type: string;
    enabled: boolean;
    local?: {
        userId: string;
        updatedAt: string;
        displayName: string;
        block: boolean;
        mute: boolean;
    } | null;
}

export interface BackendHttpApiResult {
    status: number;
    data: unknown;
    raw: unknown;
}

export interface BackendNotificationListItem {
    id: string;
    version: number;
    createdAt: string;
    created_at: string;
    updatedAt?: string;
    expiresAt?: string;
    type: string;
    link: string;
    linkText: string;
    message: string;
    title: string;
    imageUrl: string;
    seen: boolean;
    senderUserId: string;
    senderUsername: string;
    receiverUserId?: string;
    data: Record<string, unknown>;
    responses: unknown[];
    details: Record<string, unknown>;
    expired: boolean;
}

export interface BackendFavoritesBaselineResult {
    userId: string;
    stale: boolean;
    count: number;
    snapshot?: Record<string, unknown> | null;
}

export interface BackendFriendRosterBaselineResult {
    userId: string;
    stale: boolean;
    count: number;
    detail: string;
    snapshot?: Record<string, unknown> | null;
}

export interface AppBackendNamespace extends BackendNamespace {
    AppendErrorLog(entry: string): Promise<void>;
    ExitApplication(): Promise<void>;
    GetHostCapabilities(): Promise<HostCapabilities>;
    BackendAppSnapshotGet(): Promise<BackendAppSnapshot>;
    BackendAuthScopeGet(): Promise<BackendAuthScopeSnapshot>;
    BackendAuthScopeSet(input: {
        userId?: string;
        endpoint?: string;
    }): Promise<BackendAuthScopeSnapshot>;
    BackendAuthConfigGet(input: {
        endpoint?: string;
    }): Promise<BackendHttpApiResult>;
    BackendAuthCurrentUserGet(input: {
        endpoint?: string;
    }): Promise<BackendHttpApiResult>;
    BackendAuthSessionGet(input: {
        endpoint?: string;
    }): Promise<BackendHttpApiResult>;
    BackendAuthLoginBasic(input: {
        endpoint?: string;
        username: string;
        password: string;
    }): Promise<BackendHttpApiResult>;
    BackendAuthSavedSnapshotGet(): Promise<Record<string, unknown>>;
    BackendAuthSavedCredentialDelete(input: {
        userId: string;
    }): Promise<Record<string, unknown>>;
    BackendAuthLoginSuccessRecord(input: {
        user?: Record<string, unknown>;
        loginParams?: Record<string, unknown>;
        storedLoginParams?: Record<string, unknown> | null;
        saveCredentials?: boolean;
    }): Promise<Record<string, unknown>>;
    BackendAuthLogoutRecord(input: {
        userOrUserId?: Record<string, unknown> | string | null;
        clearLastUserLoggedIn?: boolean;
        cookies?: unknown;
    }): Promise<Record<string, unknown>>;
    BackendAuthTotpVerify(input: {
        endpoint?: string;
        code: string;
    }): Promise<BackendHttpApiResult>;
    BackendAuthOtpVerify(input: {
        endpoint?: string;
        code: string;
    }): Promise<BackendHttpApiResult>;
    BackendAuthEmailOtpVerify(input: {
        endpoint?: string;
        code: string;
    }): Promise<BackendHttpApiResult>;
    BackendAuthVisitsGet(input: {
        endpoint?: string;
    }): Promise<BackendHttpApiResult>;
    BackendAuthFileAnalysisGet(input: {
        endpoint?: string;
        fileId: string;
        version: number;
        variant: string;
    }): Promise<BackendHttpApiResult>;
    BackendAvatarGet(input: {
        endpoint?: string;
        avatarId: string;
    }): Promise<BackendHttpApiResult>;
    BackendAvatarGalleryGet(input: {
        endpoint?: string;
        avatarId: string;
    }): Promise<BackendHttpApiResult>;
    BackendAvatarListByUserGet(input: {
        endpoint?: string;
        userId?: string;
        user?: string;
        n: number;
        offset: number;
        sort: string;
        order: string;
        releaseStatus: string;
    }): Promise<BackendHttpApiResult>;
    BackendAvatarStylesGet(input: {
        endpoint?: string;
    }): Promise<BackendHttpApiResult>;
    BackendAvatarModerationsGet(input: {
        endpoint?: string;
    }): Promise<BackendHttpApiResult>;
    BackendAvatarFileGet(input: {
        endpoint?: string;
        fileId: string;
    }): Promise<BackendHttpApiResult>;
    BackendAvatarSelect(input: {
        endpoint?: string;
        avatarId: string;
    }): Promise<BackendHttpApiResult>;
    BackendAvatarSelectFallback(input: {
        endpoint?: string;
        avatarId: string;
    }): Promise<BackendHttpApiResult>;
    BackendAvatarSave(input: {
        endpoint?: string;
        avatarId: string;
        params?: Record<string, unknown>;
    }): Promise<BackendHttpApiResult>;
    BackendAvatarDelete(input: {
        endpoint?: string;
        avatarId: string;
    }): Promise<BackendHttpApiResult>;
    BackendAvatarImpostorCreate(input: {
        endpoint?: string;
        avatarId: string;
        emptyBody?: boolean;
    }): Promise<BackendHttpApiResult>;
    BackendAvatarImpostorDelete(input: {
        endpoint?: string;
        avatarId: string;
    }): Promise<BackendHttpApiResult>;
    BackendAvatarModerationSend(input: {
        endpoint?: string;
        avatarId: string;
        type?: string;
    }): Promise<BackendHttpApiResult>;
    BackendAvatarModerationDelete(input: {
        endpoint?: string;
        avatarId: string;
        type?: string;
    }): Promise<BackendHttpApiResult>;
    BackendFavoriteAdd(input: {
        endpoint?: string;
        type: string;
        favoriteId: string;
        tags: string;
    }): Promise<BackendHttpApiResult>;
    BackendFavoriteLimitsGet(input: {
        endpoint?: string;
    }): Promise<BackendHttpApiResult>;
    BackendFavoritesGet(input: {
        endpoint?: string;
        n: number;
        offset: number;
    }): Promise<BackendHttpApiResult>;
    BackendFavoriteWorldsGet(input: {
        endpoint?: string;
        n: number;
        offset: number;
        ownerId?: string;
        userId?: string;
        tag?: string;
    }): Promise<BackendHttpApiResult>;
    BackendFavoriteAvatarsGet(input: {
        endpoint?: string;
        n: number;
        offset: number;
        tag?: string;
    }): Promise<BackendHttpApiResult>;
    BackendFavoriteGroupsGet(input: {
        endpoint?: string;
        n: number;
        offset: number;
        ownerId?: string;
    }): Promise<BackendHttpApiResult>;
    BackendFavoriteDelete(input: {
        endpoint?: string;
        objectId: string;
    }): Promise<BackendHttpApiResult>;
    BackendFavoriteGroupClear(input: {
        endpoint?: string;
        ownerId: string;
        type: string;
        group: string;
    }): Promise<BackendHttpApiResult>;
    BackendFavoriteGroupSave(input: {
        endpoint?: string;
        ownerId: string;
        type: string;
        group: string;
        displayName?: string;
        visibility?: string;
    }): Promise<BackendHttpApiResult>;
    BackendLocalFavoriteAdd(input: {
        kind: string;
        entityId: string;
        groupName: string;
    }): Promise<number>;
    BackendLocalFavoriteRemove(input: {
        kind: string;
        entityId: string;
        groupName: string;
    }): Promise<number>;
    BackendLocalFavoriteGroupCreate(input: {
        kind: string;
        groupName: string;
    }): Promise<void>;
    BackendLocalFavoriteGroupRename(input: {
        kind: string;
        groupName: string;
        newGroupName: string;
    }): Promise<number>;
    BackendLocalFavoriteGroupDelete(input: {
        kind: string;
        groupName: string;
    }): Promise<number>;
    BackendFriendsGet(input: {
        endpoint?: string;
        offline: boolean;
        n: number;
        offset: number;
    }): Promise<BackendHttpApiResult>;
    BackendFriendStatusGet(input: {
        userId: string;
        endpoint?: string;
    }): Promise<BackendHttpApiResult>;
    BackendFriendDelete(input: {
        userId: string;
        endpoint?: string;
    }): Promise<BackendHttpApiResult>;
    BackendFriendRequestSend(input: {
        userId: string;
        endpoint?: string;
    }): Promise<BackendHttpApiResult>;
    BackendFriendRequestCancel(input: {
        userId: string;
        notificationId?: string;
        endpoint?: string;
    }): Promise<BackendHttpApiResult>;
    BackendUserGet(input: {
        endpoint?: string;
        userId: string;
    }): Promise<BackendHttpApiResult>;
    BackendUserMutualCountsGet(input: {
        endpoint?: string;
        userId: string;
    }): Promise<BackendHttpApiResult>;
    BackendUserGroupsGet(input: {
        endpoint?: string;
        userId: string;
    }): Promise<BackendHttpApiResult>;
    BackendUserRepresentedGroupGet(input: {
        endpoint?: string;
        userId: string;
    }): Promise<BackendHttpApiResult>;
    BackendUserMutualFriendsGet(input: {
        endpoint?: string;
        userId: string;
        n: number;
        offset: number;
        includeUserIdParam?: boolean;
    }): Promise<BackendHttpApiResult>;
    BackendCurrentUserUpdate(input: {
        endpoint?: string;
        userId: string;
        params?: Record<string, unknown>;
    }): Promise<BackendHttpApiResult>;
    BackendCurrentUserBadgeUpdate(input: {
        endpoint?: string;
        userId: string;
        badgeId: string;
        hidden: boolean;
        showcased: boolean;
    }): Promise<BackendHttpApiResult>;
    BackendCurrentUserTagsAdd(input: {
        endpoint?: string;
        userId: string;
        tags: string[];
    }): Promise<BackendHttpApiResult>;
    BackendCurrentUserTagsRemove(input: {
        endpoint?: string;
        userId: string;
        tags: string[];
    }): Promise<BackendHttpApiResult>;
    BackendGroupGet(input: {
        endpoint?: string;
        groupId: string;
        includeRoles?: boolean;
    }): Promise<BackendHttpApiResult>;
    BackendGroupUserGroupsGet(input: {
        endpoint?: string;
        userId: string;
    }): Promise<BackendHttpApiResult>;
    BackendGroupPostsGet(input: {
        endpoint?: string;
        groupId: string;
        n: number;
        offset: number;
    }): Promise<BackendHttpApiResult>;
    BackendGroupMembersGet(input: {
        endpoint?: string;
        groupId: string;
        n: number;
        offset: number;
        sort: string;
        roleId?: string;
    }): Promise<BackendHttpApiResult>;
    BackendGroupMembersSearch(input: {
        endpoint?: string;
        groupId: string;
        n: number;
        offset: number;
        query: string;
    }): Promise<BackendHttpApiResult>;
    BackendGroupGalleryGet(input: {
        endpoint?: string;
        groupId: string;
        galleryId: string;
        n: number;
        offset: number;
    }): Promise<BackendHttpApiResult>;
    BackendGroupInstancesGet(input: {
        endpoint?: string;
        groupId: string;
        userId: string;
    }): Promise<BackendHttpApiResult>;
    BackendGroupBansGet(input: {
        endpoint?: string;
        groupId: string;
        n: number;
        offset: number;
    }): Promise<BackendHttpApiResult>;
    BackendGroupInvitesGet(input: {
        endpoint?: string;
        groupId: string;
        n: number;
        offset: number;
    }): Promise<BackendHttpApiResult>;
    BackendGroupJoinRequestsGet(input: {
        endpoint?: string;
        groupId: string;
        n: number;
        offset: number;
        blocked?: boolean;
    }): Promise<BackendHttpApiResult>;
    BackendGroupAuditLogTypesGet(input: {
        endpoint?: string;
        groupId: string;
    }): Promise<BackendHttpApiResult>;
    BackendGroupLogsGet(input: {
        endpoint?: string;
        groupId: string;
        n: number;
        offset: number;
        eventTypes?: string;
    }): Promise<BackendHttpApiResult>;
    BackendGroupUserInstancesGet(input: {
        endpoint?: string;
        userId: string;
    }): Promise<BackendHttpApiResult>;
    BackendGroupPostCreate(input: {
        endpoint?: string;
        groupId: string;
        params?: Record<string, unknown>;
    }): Promise<BackendHttpApiResult>;
    BackendGroupPostEdit(input: {
        endpoint?: string;
        groupId: string;
        postId: string;
        params?: Record<string, unknown>;
    }): Promise<BackendHttpApiResult>;
    BackendGroupPostDelete(input: {
        endpoint?: string;
        groupId: string;
        postId: string;
    }): Promise<BackendHttpApiResult>;
    BackendGroupJoin(input: {
        endpoint?: string;
        groupId: string;
    }): Promise<BackendHttpApiResult>;
    BackendGroupLeave(input: {
        endpoint?: string;
        groupId: string;
    }): Promise<BackendHttpApiResult>;
    BackendGroupRequestCancel(input: {
        endpoint?: string;
        groupId: string;
    }): Promise<BackendHttpApiResult>;
    BackendGroupInviteSend(input: {
        endpoint?: string;
        groupId: string;
        userId: string;
    }): Promise<BackendHttpApiResult>;
    BackendGroupMemberKick(input: {
        endpoint?: string;
        groupId: string;
        userId: string;
    }): Promise<BackendHttpApiResult>;
    BackendGroupMemberBan(input: {
        endpoint?: string;
        groupId: string;
        userId: string;
    }): Promise<BackendHttpApiResult>;
    BackendGroupMemberUnban(input: {
        endpoint?: string;
        groupId: string;
        userId: string;
    }): Promise<BackendHttpApiResult>;
    BackendGroupInviteDelete(input: {
        endpoint?: string;
        groupId: string;
        userId: string;
    }): Promise<BackendHttpApiResult>;
    BackendGroupJoinRequestRespond(input: {
        endpoint?: string;
        groupId: string;
        userId: string;
        action: string;
        block?: boolean;
    }): Promise<BackendHttpApiResult>;
    BackendGroupRepresentationSet(input: {
        endpoint?: string;
        groupId: string;
        isRepresenting: boolean;
    }): Promise<BackendHttpApiResult>;
    BackendGroupMemberPropsSet(input: {
        endpoint?: string;
        groupId: string;
        userId: string;
        params?: Record<string, unknown>;
    }): Promise<BackendHttpApiResult>;
    BackendGroupBlock(input: {
        endpoint?: string;
        groupId: string;
    }): Promise<BackendHttpApiResult>;
    BackendGroupUnblock(input: {
        endpoint?: string;
        groupId: string;
        userId: string;
    }): Promise<BackendHttpApiResult>;
    BackendInstanceGet(input: {
        endpoint?: string;
        worldId: string;
        instanceId: string;
    }): Promise<BackendHttpApiResult>;
    BackendInstanceShortNameGet(input: {
        endpoint?: string;
        worldId: string;
        instanceId: string;
        shortName?: string;
    }): Promise<BackendHttpApiResult>;
    BackendInstanceCreate(input: {
        endpoint?: string;
        params?: Record<string, unknown>;
    }): Promise<BackendHttpApiResult>;
    BackendInstanceSelfInvite(input: {
        endpoint?: string;
        worldId: string;
        instanceId: string;
        shortName?: string;
    }): Promise<BackendHttpApiResult>;
    BackendInstanceClose(input: {
        endpoint?: string;
        location: string;
        hardClose?: boolean;
    }): Promise<BackendHttpApiResult>;
    BackendMediaFilesGet(input: {
        endpoint?: string;
        params?: Record<string, unknown>;
    }): Promise<BackendHttpApiResult>;
    BackendMediaFileDelete(input: {
        endpoint?: string;
        fileId: string;
    }): Promise<BackendHttpApiResult>;
    BackendMediaGalleryImageUpload(input: {
        endpoint?: string;
        imageData: string;
        params?: Record<string, unknown>;
    }): Promise<BackendHttpApiResult>;
    BackendMediaAvatarGalleryImageUpload(input: {
        endpoint?: string;
        imageData: string;
        avatarId: unknown;
    }): Promise<BackendHttpApiResult>;
    BackendMediaVrcPlusIconUpload(input: {
        endpoint?: string;
        imageData: string;
        params?: Record<string, unknown>;
    }): Promise<BackendHttpApiResult>;
    BackendMediaEmojiUpload(input: {
        endpoint?: string;
        imageData: string;
        params?: Record<string, unknown>;
    }): Promise<BackendHttpApiResult>;
    BackendMediaStickerUpload(input: {
        endpoint?: string;
        imageData: string;
        params?: Record<string, unknown>;
    }): Promise<BackendHttpApiResult>;
    BackendMediaPrintUpload(input: {
        endpoint?: string;
        imageData: string;
        cropWhiteBorder: boolean;
        params?: Record<string, unknown>;
    }): Promise<BackendHttpApiResult>;
    BackendMediaPrintsGet(input: {
        endpoint?: string;
        userId: string;
        n: number;
    }): Promise<BackendHttpApiResult>;
    BackendMediaPrintGet(input: {
        endpoint?: string;
        printId: string;
    }): Promise<BackendHttpApiResult>;
    BackendMediaPrintDelete(input: {
        endpoint?: string;
        printId: string;
    }): Promise<BackendHttpApiResult>;
    BackendMediaInventoryItemsGet(input: {
        endpoint?: string;
        params?: Record<string, unknown>;
    }): Promise<BackendHttpApiResult>;
    BackendMediaUserInventoryItemGet(input: {
        endpoint?: string;
        userId: string;
        inventoryId: string;
    }): Promise<BackendHttpApiResult>;
    BackendMediaInventoryItemUpdate(input: {
        endpoint?: string;
        inventoryId: string;
        params?: Record<string, unknown>;
    }): Promise<BackendHttpApiResult>;
    BackendMediaInventoryBundleConsume(input: {
        endpoint?: string;
        inventoryId: string;
    }): Promise<BackendHttpApiResult>;
    BackendMediaRewardRedeem(input: {
        endpoint?: string;
        code: string;
    }): Promise<BackendHttpApiResult>;
    BackendMediaFileVersionCreate(input: {
        endpoint?: string;
        fileId: string;
        fileMd5: string;
        fileSizeInBytes: number;
        signatureMd5: string;
        signatureSizeInBytes: number;
    }): Promise<BackendHttpApiResult>;
    BackendMediaFileUploadStart(input: {
        endpoint?: string;
        fileId: string;
        version: number;
        kind: string;
    }): Promise<BackendHttpApiResult>;
    BackendMediaFileUploadFinish(input: {
        endpoint?: string;
        fileId: string;
        version: number;
        kind: string;
    }): Promise<BackendHttpApiResult>;
    BackendMediaFilePut(input: {
        url: string;
        fileData: string;
        fileMIME: string;
        fileMD5: string;
    }): Promise<BackendHttpApiResult>;
    BackendMediaAvatarImageSet(input: {
        endpoint?: string;
        entityId: string;
        imageUrl: string;
    }): Promise<BackendHttpApiResult>;
    BackendMediaAvatarImageUploadLegacy(input: {
        endpoint?: string;
        entityId: string;
        imageUrl: string;
        base64File: string;
        fileSizeInBytes?: number;
    }): Promise<BackendHttpApiResult>;
    BackendMediaWorldImageSet(input: {
        endpoint?: string;
        entityId: string;
        imageUrl: string;
    }): Promise<BackendHttpApiResult>;
    BackendMediaWorldImageUploadLegacy(input: {
        endpoint?: string;
        entityId: string;
        imageUrl: string;
        base64File: string;
        fileSizeInBytes?: number;
    }): Promise<BackendHttpApiResult>;
    BackendBackgroundJobRecord(input: {
        name: string;
        owner?: string;
        cadenceSeconds?: number | null;
        status: string;
        detail?: string;
    }): Promise<void>;
    BackendBackgroundFrontendDueJobsGet(): Promise<string[]>;
    BackendBackgroundFrontendJobDefer(input: {
        name: string;
        delaySeconds: number;
    }): Promise<boolean>;
    BackendBackgroundFrontendSchedulesReset(): Promise<void>;
    BackendBackgroundJobsSnapshotGet(): Promise<BackendBackgroundJobSnapshot[]>;
    BackendDiagnosticsGet(): Promise<BackendDiagnosticsSnapshot>;
    BackendExternalAvatarSearchGet(input: {
        url: string;
        vrcxId: string;
    }): Promise<BackendHttpApiResult>;
    BackendExternalTranslationRequest(input: {
        url: string;
        method?: string;
        headers?: Record<string, string>;
        body?: unknown;
    }): Promise<BackendHttpApiResult>;
    BackendExternalYoutubeVideoMetadataGet(input: {
        videoId: string;
        apiKey: string;
    }): Promise<BackendHttpApiResult>;
    BackendExternalVrcStatusJsonGet(input: {
        path: string;
    }): Promise<BackendHttpApiResult>;
    BackendExternalGithubReleasesGet(input: {
        url: string;
        headers?: Record<string, string>;
    }): Promise<BackendHttpApiResult>;
    BackendExternalImageDataUrlGet(input: {
        url: string;
    }): Promise<BackendHttpApiResult>;
    BackendModerationRefresh(input: {
        userId: string;
        endpoint?: string;
    }): Promise<BackendModerationRefreshResult>;
    BackendModerationUpdate(input: {
        ownerUserId?: string;
        endpoint?: string;
        targetUserId: string;
        targetDisplayName?: string;
        type: string;
        enabled: boolean;
    }): Promise<BackendModerationUpdateResult>;
    BackendNotificationMarkSeen(input: {
        userId: string;
        id: string;
        version: number;
        endpoint?: string;
    }): Promise<BackendHttpApiResult>;
    BackendNotificationAcceptFriendRequest(input: {
        id: string;
        endpoint?: string;
    }): Promise<BackendHttpApiResult>;
    BackendNotificationHideRemote(input: {
        id: string;
        version?: number;
        type?: string;
        senderUserId?: string;
        endpoint?: string;
    }): Promise<BackendHttpApiResult>;
    BackendNotificationRespond(input: {
        id: string;
        responseType: string;
        responseData?: unknown;
        endpoint?: string;
    }): Promise<BackendHttpApiResult>;
    NotificationListQuery(input: {
        query: {
            userId: string;
            search?: string;
            filters?: string[];
            perTableLimit?: number;
            limit?: number;
            includeUnseen?: boolean;
        };
    }): Promise<BackendNotificationListItem[]>;
    BackendInviteResponseSend(input: {
        id: string;
        responseSlot: number;
        endpoint?: string;
    }): Promise<BackendHttpApiResult>;
    BackendInviteResponsePhotoSend(input: {
        id: string;
        responseSlot: number;
        imageData: string;
        endpoint?: string;
    }): Promise<BackendHttpApiResult>;
    BackendInviteSend(input: {
        receiverUserId: string;
        params?: Record<string, unknown>;
        endpoint?: string;
    }): Promise<BackendHttpApiResult>;
    BackendRequestInviteSend(input: {
        receiverUserId: string;
        params?: Record<string, unknown>;
        endpoint?: string;
    }): Promise<BackendHttpApiResult>;
    BackendBoopSend(input: {
        userId: string;
        emojiId?: string;
        endpoint?: string;
    }): Promise<BackendHttpApiResult>;
    BackendSearchConfigGet(input: {
        endpoint?: string;
        params?: Record<string, unknown>;
    }): Promise<BackendHttpApiResult>;
    BackendSearchWorldsGet(input: {
        endpoint?: string;
        params?: Record<string, unknown>;
        option?: string;
    }): Promise<BackendHttpApiResult>;
    BackendSearchUsersGet(input: {
        endpoint?: string;
        params?: Record<string, unknown>;
    }): Promise<BackendHttpApiResult>;
    BackendSearchGroupsGet(input: {
        endpoint?: string;
        params?: Record<string, unknown>;
    }): Promise<BackendHttpApiResult>;
    BackendSearchGroupsStrictGet(input: {
        endpoint?: string;
        params?: Record<string, unknown>;
    }): Promise<BackendHttpApiResult>;
    BackendSearchInstanceShortNameGet(input: {
        endpoint?: string;
        shortName: string;
    }): Promise<BackendHttpApiResult>;
    BackendFavoritesBaselineGet(input: {
        userId: string;
        endpoint?: string;
        currentUserSnapshot: Record<string, unknown>;
        friendRosterById?: Record<string, unknown>;
    }): Promise<BackendFavoritesBaselineResult>;
    BackendFriendRosterBaselineGet(input: {
        userId: string;
        endpoint?: string;
        currentUserSnapshot: Record<string, unknown>;
        explicitAddIntentUserIds?: string[];
    }): Promise<BackendFriendRosterBaselineResult>;
    BackendToolsCalendarsGet(input: {
        endpoint?: string;
        params?: Record<string, unknown>;
    }): Promise<BackendHttpApiResult>;
    BackendToolsGroupCalendarGet(input: {
        endpoint?: string;
        groupId: string;
    }): Promise<BackendHttpApiResult>;
    BackendToolsFollowingCalendarsGet(input: {
        endpoint?: string;
        params?: Record<string, unknown>;
    }): Promise<BackendHttpApiResult>;
    BackendToolsFeaturedCalendarsGet(input: {
        endpoint?: string;
        params?: Record<string, unknown>;
    }): Promise<BackendHttpApiResult>;
    BackendToolsGroupEventFollow(input: {
        endpoint?: string;
        groupId: string;
        eventId: string;
        isFollowing: boolean;
    }): Promise<BackendHttpApiResult>;
    BackendToolsGroupCalendarIcsGet(input: {
        endpoint?: string;
        groupId: string;
        eventId: string;
    }): Promise<BackendHttpApiResult>;
    BackendToolsUserNoteSave(input: {
        endpoint?: string;
        targetUserId: string;
        note: string;
    }): Promise<BackendHttpApiResult>;
    BackendToolsUserReport(input: {
        endpoint?: string;
        userId: string;
        contentType?: string;
        reason: string;
        type?: string;
    }): Promise<BackendHttpApiResult>;
    BackendToolsInviteMessagesGet(input: {
        endpoint?: string;
        currentUserId: string;
        messageType: string;
    }): Promise<BackendHttpApiResult>;
    BackendToolsInviteMessageEdit(input: {
        endpoint?: string;
        currentUserId: string;
        messageType: string;
        slot: string;
        message: string;
    }): Promise<BackendHttpApiResult>;
    BackendWorldGet(input: {
        endpoint?: string;
        worldId: string;
    }): Promise<BackendHttpApiResult>;
    BackendWorldListByUserGet(input: {
        endpoint?: string;
        userId: string;
        n: number;
        offset: number;
        sort: string;
        order: string;
        releaseStatus: string;
    }): Promise<BackendHttpApiResult>;
    BackendWorldSave(input: {
        endpoint?: string;
        worldId: string;
        params?: Record<string, unknown>;
    }): Promise<BackendHttpApiResult>;
    BackendWorldDelete(input: {
        endpoint?: string;
        worldId: string;
    }): Promise<BackendHttpApiResult>;
    BackendWorldPublish(input: {
        endpoint?: string;
        worldId: string;
    }): Promise<BackendHttpApiResult>;
    BackendWorldUnpublish(input: {
        endpoint?: string;
        worldId: string;
    }): Promise<BackendHttpApiResult>;
    BackendWorldPersistentDataDelete(input: {
        endpoint?: string;
        userId: string;
        worldId: string;
    }): Promise<BackendHttpApiResult>;
    BackendWorldPersistentDataExists(input: {
        endpoint?: string;
        userId: string;
        worldId: string;
    }): Promise<BackendHttpApiResult>;
    BackendRuntimeSnapshotGet(): Promise<BackendRuntimeSnapshot>;
    BackendSyncSnapshotGet(): Promise<BackendSyncSnapshot>;
    SetGameClientRuntimeState(
        sessionActive: boolean,
        currentLocation: string
    ): Promise<void>;
    StartRealtimeTransport(
        userId: string,
        endpoint: string,
        websocket: string,
        clientRunId: number,
        currentUserSnapshot: Record<string, unknown>,
        friendsById: Record<string, unknown>
    ): Promise<{
        generation: number;
        clientRunId: number;
        sessionGeneration: number;
    }>;
    SyncRealtimeFriendSnapshot(
        userId: string,
        endpoint: string,
        websocket: string,
        generation: number | null,
        friendsById: Record<string, unknown>
    ): Promise<{
        accepted: boolean;
        generation: number;
        baselineRevision: number;
        friendCount: number;
    }>;
    SyncRealtimeCurrentUserSnapshot(
        userId: string,
        endpoint: string,
        websocket: string,
        generation: number | null,
        snapshot: Record<string, unknown>,
        overlayPatch: Record<string, unknown> | null
    ): Promise<boolean>;
    ExpireRealtimeNotification(
        userId: string,
        notificationId: string
    ): Promise<void>;
    StopRealtimeTransport(
        userId?: string | null,
        endpoint?: string | null,
        websocket?: string | null,
        clientRunId?: number | null,
        generation?: number | null
    ): Promise<void>;
    CheckLegacyVrcxAvailable(): Promise<boolean>;
    GetLegacyVrcxMigrationStatus(): Promise<LegacyVrcxMigrationStatus>;
    GetLegacyVrcxForceMigrationStatus(): Promise<LegacyVrcxMigrationStatus>;
    RequestLegacyMigration(): Promise<boolean>;
    RequestLegacyVrcxForceMigration(): Promise<boolean>;
}

export type BackendEvents = typeof backendEvents;
export type BackendWebview = typeof webview;

export interface Backend {
    app: AppBackendNamespace;
    web: BackendNamespace;
    storage: BackendNamespace;
    sqlite: BackendNamespace;
    logWatcher: BackendNamespace;
    discord: BackendNamespace;
    assetBundle: AssetBundleBackendNamespace;
    events: BackendEvents;
    webview: BackendWebview;
}

const app = createBackendNamespace('app');
const discordCommands = createBackendNamespace('discord');

const discord = new Proxy(discordCommands, {
    get(target, property): unknown {
        if (property === 'OpenDiscordProfile') {
            return (discordId: string) => app.OpenDiscordProfile(discordId);
        }

        if (typeof property !== 'string') {
            return undefined;
        }

        return target[property];
    }
});

export const backend: Backend = Object.freeze({
    app: app as AppBackendNamespace,
    web: createBackendNamespace('web'),
    storage: createBackendNamespace('storage'),
    sqlite: createBackendNamespace('sqlite'),
    logWatcher: createBackendNamespace('logWatcher'),
    discord,
    assetBundle: createBackendNamespace(
        'assetBundle'
    ) as AssetBundleBackendNamespace,
    events: backendEvents,
    webview
});

export default backend;
