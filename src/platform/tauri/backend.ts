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
    lastDetail: string;
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
    BackendFavoriteAdd(input: {
        endpoint?: string;
        type: string;
        favoriteId: string;
        tags: string;
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
    BackendBackgroundJobRecord(input: {
        name: string;
        owner?: string;
        cadenceSeconds?: number | null;
        status: string;
        detail?: string;
    }): Promise<void>;
    BackendBackgroundJobsSnapshotGet(): Promise<BackendBackgroundJobSnapshot[]>;
    BackendDiagnosticsGet(): Promise<BackendDiagnosticsSnapshot>;
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
