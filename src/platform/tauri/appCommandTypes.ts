import type { TauriCommandNamespace } from './commands';
import type {
    OverlayActivityCategory,
    OverlayActivityScope
} from '@/shared/constants/overlayActivityFilters';

export interface AssetBundleCacheCheckResult {
    Item1?: number;
    Item2?: boolean;
    Item3?: string;
    item1?: number;
    item2?: boolean;
    item3?: string;
}

export interface AssetBundleTauriCommandNamespace extends TauriCommandNamespace {
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
    runtimeGameLogIngest: HostCapabilityStatus;
    runtimeGameLogSideEffects: HostCapabilityStatus;
    runtimeGameClientLifecycle: HostCapabilityStatus;
    runtimeRealtimeTransport: HostCapabilityStatus;
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

export type AppLauncherEntryKind = 'localApp' | 'steamApp';
export type AppLauncherScope = 'all' | 'desktop' | 'vr';
export type AppLauncherRunPolicy = 'always' | 'skipIfRunning';
export type AppLauncherStopPolicy = 'keepRunning' | 'closeByVrcx';
export type AppLauncherRunStatus =
    | 'waiting'
    | 'running'
    | 'skipped'
    | 'failed'
    | 'stopped'
    | 'completed';

export interface AppLauncherEntry {
    id: string;
    enabled: boolean;
    name: string;
    kind: AppLauncherEntryKind;
    scope: AppLauncherScope;
    target: string;
    args?: string;
    launchDelaySeconds: number;
    runPolicy: AppLauncherRunPolicy;
    stopPolicy: AppLauncherStopPolicy;
    processName?: string | null;
    workingDirectory?: string | null;
}

export interface AppLauncherRun {
    id: string;
    entryId: string;
    entryName: string;
    kind: AppLauncherEntryKind;
    target: string;
    status: AppLauncherRunStatus;
    stopPolicy: AppLauncherStopPolicy;
    test: boolean;
    rootPid?: number | null;
    trackedPids: number[];
    startedAt?: number | null;
    finishedAt?: number | null;
    error?: string | null;
    skippedReason?: string | null;
}

export interface AppLauncherSession {
    id: string;
    steamvrRunning: boolean;
    startedAt: number;
    runs: AppLauncherRun[];
}

export interface AppLauncherSnapshot {
    enabled: boolean;
    entries: AppLauncherEntry[];
    activeSession?: AppLauncherSession | null;
    testRuns: AppLauncherRun[];
}

export interface AppLauncherPickedTarget {
    kind: AppLauncherEntryKind;
    name: string;
    target: string;
    processName?: string | null;
    workingDirectory?: string | null;
}

export type AppDataDirSource = 'cli' | 'persisted' | 'default';

export interface AppDataDirState {
    currentDir: string;
    defaultDir: string;
    persistedDir?: string | null;
    cliDir?: string | null;
    source: AppDataDirSource;
    cliOverride: boolean;
}

export interface AppDataDirValidation {
    path: string;
    exists: boolean;
    isEmpty: boolean;
    hasDatabase: boolean;
    hasConfig: boolean;
    warningKind?: 'empty' | 'missingProfileFiles' | string | null;
    warning?: string | null;
}

export type VrchatLogLevel = 'Debug' | 'Warning' | 'Error';

export interface VrchatLogFileOutput {
    fileName: string;
    modifiedAt?: string | null;
    size: number;
    latest: boolean;
}

export interface VrchatLogEntryOutput {
    timestamp: string;
    level: VrchatLogLevel | string;
    category?: string | null;
    message: string;
    raw: string;
    lineNumber: number;
    endLineNumber: number;
    fileName: string;
    continuationLines: string[];
}

export interface VrchatLogEntriesReadInput {
    fileName: string;
    offset?: number;
    limit?: number;
    query?: string;
    levels?: string[];
    categories?: string[];
}

export interface VrchatLogTailReadInput {
    fileName?: string;
    afterLineNumber?: number;
    fileSize?: number;
    limit?: number;
    query?: string;
    levels?: string[];
    categories?: string[];
}

export interface VrchatLogEntriesReadOutput {
    fileName: string;
    entries: VrchatLogEntryOutput[];
    offset: number;
    nextOffset?: number | null;
    totalEntries: number;
    totalLines: number;
    lastLineNumber: number;
    fileSize: number;
    fileModifiedAt?: string | null;
    resetRequired: boolean;
}

export interface LegacyVrcxMigrationStatus {
    detected: boolean;
    available: boolean;
    version?: number;
    dbPath?: string;
    configPath?: string;
    reason?: string;
}

export interface RuntimePhaseSnapshot {
    name: string;
    status: string;
    detail: string;
    updatedAt: string;
}

export interface RuntimeLifecycleSnapshot {
    startedAt: string;
    hostServicesStarted: boolean;
    phases: RuntimePhaseSnapshot[];
}

export interface RuntimeBackgroundJobSnapshot {
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

export interface RuntimeSyncDomainSnapshot {
    domain: string;
    status: string;
    detail: string;
    updatedAt: string;
    revision: number;
    pendingCount: number;
    failureCount: number;
}

export interface RuntimeSyncSnapshot {
    domains: RuntimeSyncDomainSnapshot[];
}

export interface TauriCommandGroupSnapshot {
    name: string;
    boundary: string;
    commandCount: number;
    examples: string[];
}

export interface TauriCommandObservation {
    command: string;
    status: string;
    detail: string;
    observedAt: string;
}

export interface RuntimeDiagnosticsSnapshot {
    genericSqlEnabled: boolean;
    frontendWsParsingEnabled: boolean;
    commandGroups: TauriCommandGroupSnapshot[];
    recentCommands: TauriCommandObservation[];
    notes: string[];
}

export interface RuntimeAppSnapshot {
    runtime: RuntimeLifecycleSnapshot;
    backgroundJobs: RuntimeBackgroundJobSnapshot[];
    sync: RuntimeSyncSnapshot;
    diagnostics: RuntimeDiagnosticsSnapshot;
    gameLog: Record<string, unknown>;
}

export interface OverlayActivityText {
    key: string;
    fallback: string;
    params?: unknown;
}

export interface OverlayActivityContent {
    icon: string;
    title: OverlayActivityText;
    body: OverlayActivityText;
    summary: string;
    detail: string;
    location: string;
    worldName: string;
    groupName: string;
    status: string;
    statusDescription: string;
    avatarName: string;
    imageUrl: string;
}

export type OverlayActivityActorRelation = 'none' | 'friend' | 'favorite';

export interface OverlayActivityEntry {
    sequence: number;
    sourceId: string;
    activityType: string;
    category: string;
    createdAt: string;
    actorUserId: string;
    actorDisplayName: string;
    content: OverlayActivityContent;
    actorRelation?: OverlayActivityActorRelation;
    payload?: unknown;
}

export interface OverlayActivitySnapshot {
    entries: OverlayActivityEntry[];
}

export interface OverlayActivityTypeDefinition {
    key: string;
    category: OverlayActivityCategory;
    allowedScopes: OverlayActivityScope[];
    defaultScope: OverlayActivityScope;
    aliases: string[];
}

export interface VrOverlayRuntimeSnapshot {
    enabled: boolean;
    backendAvailable: boolean;
    running: boolean;
    vrMode: boolean;
    steamvrRunning: boolean;
}

export interface RuntimeAuthScopeSnapshot {
    currentUserId: string;
    endpoint: string;
    generation: number;
    active: boolean;
}

export type BackendRuntimeMode = 'foreground' | 'background' | 'headless';
export type BackendRuntimePhase =
    | 'idle'
    | 'starting'
    | 'authenticating'
    | 'running'
    | 'stopping'
    | 'error';

export interface BackendRuntimeSnapshot {
    mode: BackendRuntimeMode;
    phase: BackendRuntimePhase;
    authStatus: string;
    authUserId: string;
    authDisplayName: string;
    wsStatus: string;
    gameLogStatus: string;
    processStatus: string;
    wsMessageCounts: Record<string, number>;
    wsPersistedCount: number;
    gameLogPersistedCount: number;
    lastError?: string | null;
    updatedAt: string;
}

export interface ModerationSyncRefreshResult {
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

export interface ModerationSyncUpdateResult {
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

export interface VrchatHttpApiResult<TData = unknown, TRaw = unknown> {
    status: number;
    data: TData;
    raw: TRaw;
}

export interface VrchatNotificationListItem {
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

export type RawJsonRecord = Record<string, unknown>;

export type LocalFavoriteKind = 'friend' | 'avatar' | 'world';

export interface LocalFavoriteInput {
    kind: LocalFavoriteKind;
    entityId: string;
    groupName: string;
}

export interface LocalFavoriteGroupInput {
    kind: LocalFavoriteKind;
    groupName: string;
}

export interface LocalFavoriteGroupRenameInput extends LocalFavoriteGroupInput {
    newGroupName: string;
}

export interface FeedRowsQueryInput {
    userId: string;
    mode: string;
    search?: string;
    filters?: string[];
    vipList?: string[];
    excludedUserIds?: string[];
    maxEntries: number;
    dateFrom?: string;
    dateTo?: string;
    cursor?: FeedCursorInput | null;
}

export interface FeedCursorInput {
    createdAt: string;
    sourceRank: number;
    rowId: number;
}

export interface FeedLiveEntryInput {
    sequence: number;
    entry: RawJsonRecord;
}

export interface FeedReadModelQueryInput extends FeedRowsQueryInput {
    liveEntries?: FeedLiveEntryInput[];
    minLiveSequence?: number;
    favoritesOnly?: boolean;
    favoriteUserIds?: string[];
    excludedUserIds?: string[];
    maxRows?: number;
}

export interface FeedLiveRowsMergeInput {
    rows?: RawJsonRecord[];
    currentUserId?: string;
    filters?: string[];
    search?: string;
    dateFrom?: string;
    dateTo?: string;
    favoritesOnly?: boolean;
    favoriteUserIds?: string[];
    excludedUserIds?: string[];
    liveEntries?: FeedLiveEntryInput[];
    minLiveSequence?: number;
    maxRows?: number;
}

export interface FeedRowOutput extends RawJsonRecord {
    rowId: unknown;
    sourceRank: unknown;
    created_at: unknown;
    userId: unknown;
    displayName: unknown;
    type: unknown;
    location?: unknown;
    worldName?: unknown;
    previousLocation?: unknown;
    time?: unknown;
    groupName?: unknown;
    status?: unknown;
    statusDescription?: unknown;
    previousStatus?: unknown;
    previousStatusDescription?: unknown;
    bio?: unknown;
    previousBio?: unknown;
    ownerId?: unknown;
    avatarName?: unknown;
    currentAvatarImageUrl?: unknown;
    currentAvatarThumbnailImageUrl?: unknown;
    previousCurrentAvatarImageUrl?: unknown;
    previousCurrentAvatarThumbnailImageUrl?: unknown;
}

export interface FeedReadModelOutput {
    rows: RawJsonRecord[];
    maxSequence: number;
}

export type GameLogKind =
    | 'Location'
    | 'LocationTime'
    | 'JoinLeave'
    | 'PortalSpawn'
    | 'VideoPlay'
    | 'ResourceLoad'
    | 'Event'
    | 'External'
    | string;

export interface GameLogQueryInput {
    kind: string;
    params?: RawJsonRecord;
}

export interface ActivitySourceLocationOutput {
    created_at: string;
    time: number;
}

export interface ActivityPresenceOutput {
    created_at: string;
    type: string;
}

export interface ActivitySyncStateOutput {
    userId: string;
    updatedAt: string;
    isSelf: boolean;
    sourceLastCreatedAt: string;
    pendingSessionStartAt: unknown;
    cachedRangeDays: number;
}

export interface ActivitySessionOutput {
    start: number;
    end: number;
    isOpenTail: boolean;
    sourceRevision: string;
}

export interface ActivitySelfSessionsRefreshOutput {
    sync: ActivitySyncStateOutput;
    sessions: ActivitySessionOutput[];
    sourceCount: number;
}

export interface ActivitySelfSourceBoundsOutput {
    firstCreatedAt: string;
    lastCreatedAt: string;
    count: number;
}

export interface ActivitySessionInput {
    start: number;
    end: number;
    isOpenTail?: boolean;
    sourceRevision?: string;
}

export interface ActivityBucketCacheOutput extends RawJsonRecord {
    ownerUserId: string;
    targetUserId: string;
    rangeDays: number;
    viewKind: string;
    excludeKey: string;
    bucketVersion: number;
    builtFromCursor: string;
    rawBuckets: unknown;
    normalizedBuckets: unknown;
    summary: unknown;
    builtAt: string;
}

export interface MutualGraphSnapshotEntryInput {
    friendId: string;
    mutualIds: string[];
}

export interface MutualGraphMetaInput {
    friendId: string;
    lastFetchedAt?: string;
    optedOut?: boolean;
}

export interface MutualGraphSnapshotOutput {
    friendIds: string[];
    links: Array<{ friendId: string; mutualId: string }>;
    meta: Array<{
        friendId: string;
        lastFetchedAt: string;
        optedOut: boolean;
    }>;
}

export interface MutualGraphFetchStatus {
    runId: number;
    status: string;
    ownerUserId: string;
    totalFriends: number;
    processedFriends: number;
    currentFriendId: string;
    fetchedFriends: number;
    optedOutFriends: number;
    failedFriends: number;
    cancelRequested: boolean;
    startedAt: string;
    updatedAt: string;
    finishedAt?: string | null;
    lastError?: string | null;
}

export interface MemoSaveResult {
    entityId: string;
    editedAt: string;
    memo: string;
}

export interface UserMemoOutput {
    userId: string;
    editedAt: string;
    memo: string;
}

export interface WorldMemoOutput {
    worldId: string;
    editedAt: string;
    memo: string;
}

export interface AvatarMemoOutput {
    avatarId: string;
    editedAt: string;
    memo: string;
}

export interface UserNoteOutput {
    userId: string;
    displayName: string;
    note: string;
    createdAt: string;
}

export interface PlayerLocationOutput {
    created_at?: string;
    world_id?: string;
    world_name?: string;
    group_name?: string;
    createdAt?: string;
    location: string;
    worldId?: string;
    worldName?: string;
    time: number;
    groupName?: string;
}

export interface PlayerJoinLeaveOutput {
    id: unknown;
    created_at?: string;
    display_name?: string;
    user_id?: string;
    createdAt?: string;
    type: string;
    displayName?: string;
    userId?: string;
    time: number;
}

export interface MaintenanceTableSizesOutput {
    gps: number;
    status: number;
    bio: number;
    avatar: number;
    onlineOffline: number;
    friendLogHistory: number;
    notification: number;
    location?: number;
    joinLeave?: number;
    portalSpawn?: number;
    videoPlay?: number;
    event?: number;
    external?: number;
    resourceLoad?: number;
}

export interface BrokenGameLogDisplayNameOutput {
    id: unknown;
    displayName: unknown;
}

export interface SocialFavoritesBaselineResult {
    userId: string;
    stale: boolean;
    count: number;
    snapshot?: Record<string, unknown> | null;
}

export interface SocialFriendRosterBaselineResult {
    userId: string;
    stale: boolean;
    count: number;
    detail: string;
    snapshot?: Record<string, unknown> | null;
}

export interface BackendRuntimeFrontendSessionSnapshot {
    authenticated: boolean;
    userId: string;
    displayName: string;
    endpoint: string;
    websocket: string;
    currentUserSnapshot: Record<string, unknown>;
}

export interface RegistryBackupSnapshot {
    key: string;
    name: string;
    date: string;
    data: unknown;
}

export interface RegistryBackupMaintenanceResult {
    backups: RegistryBackupSnapshot[];
    autoBackupCreated: boolean;
    restorePromptNeeded: boolean;
    restorePromptBackupDate?: string | null;
    detail: string;
}

export interface CommunityThemeDebugLocalThemeOutput {
    folderPath: string;
    cssPath: string;
    manifestPath?: string | null;
    themeName: string;
    version: string;
    darkMode: boolean;
    accentMode: boolean;
    css: string;
}

export interface AppTauriCommandNamespace extends TauriCommandNamespace {
    AppendErrorLog(entry: string): Promise<void>;
    ExitApplication(): Promise<void>;
    GetHostCapabilities(): Promise<HostCapabilities>;
    GetAppDataDirState(): Promise<AppDataDirState>;
    ValidateAppDataDir(path: string): Promise<AppDataDirValidation>;
    SetAppDataDir(path: string): Promise<AppDataDirState>;
    ClearAppDataDir(): Promise<AppDataDirState>;
    VrchatLogFilesList(): Promise<VrchatLogFileOutput[]>;
    VrchatLogEntriesRead(
        input: VrchatLogEntriesReadInput
    ): Promise<VrchatLogEntriesReadOutput>;
    VrchatLogTailRead(
        input: VrchatLogTailReadInput
    ): Promise<VrchatLogEntriesReadOutput>;
    RuntimeAppSnapshotGet(): Promise<RuntimeAppSnapshot>;
    RuntimeAuthScopeGet(): Promise<RuntimeAuthScopeSnapshot>;
    RuntimeAuthScopeSet(input: {
        userId?: string;
        endpoint?: string;
    }): Promise<RuntimeAuthScopeSnapshot>;
    OverlayActivityFiltersReload(): Promise<void>;
    OverlayActivityDefinitionsGet(): Promise<OverlayActivityTypeDefinition[]>;
    OverlayActivitySnapshotGet(): Promise<OverlayActivitySnapshot>;
    VrOverlayStatusGet(): Promise<VrOverlayRuntimeSnapshot>;
    VrOverlayEnabledSet(enabled: boolean): Promise<VrOverlayRuntimeSnapshot>;
    VrOverlayConfigReload(): Promise<VrOverlayRuntimeSnapshot>;
    StartBackgroundMode(): Promise<BackendRuntimeSnapshot>;
    StopBackgroundMode(reason?: string | null): Promise<BackendRuntimeSnapshot>;
    GetBackendRuntimeSnapshot(): Promise<BackendRuntimeSnapshot>;
    GetBackendRuntimeFrontendSessionSnapshot(): Promise<BackendRuntimeFrontendSessionSnapshot | null>;
    EnsureMainWindow(): Promise<void>;
    RefreshTrayMenu(): Promise<void>;
    OpenDevtools(): Promise<void>;
    DesktopNotification(
        boldText: string,
        text?: string | null,
        image?: string | null,
        playSound?: boolean | null
    ): Promise<void>;
    XSNotification(
        title: string,
        content: string,
        timeout: number,
        opacity: number,
        image?: string | null
    ): Promise<void>;
    OVRTNotification(
        hudNotification: boolean,
        wristNotification: boolean,
        title: string,
        body: string,
        timeout: number,
        opacity: number,
        image?: string | null
    ): Promise<void>;
    AuthFailureNotificationShow(reason?: string | null): Promise<void>;
    GetImage(url: string, fileId: string, version: string): Promise<string>;
    CommunityThemeDebugLoadLocalTheme(
        folderPath: string
    ): Promise<CommunityThemeDebugLocalThemeOutput>;
    RegistryBackupList(): Promise<RegistryBackupSnapshot[]>;
    RegistryBackupCreate(name: string): Promise<RegistryBackupSnapshot[]>;
    RegistryBackupRestore(key: string): Promise<RegistryBackupSnapshot>;
    RegistryBackupDelete(key: string): Promise<RegistryBackupSnapshot[]>;
    RegistryBackupExportJson(key: string): Promise<string>;
    RegistryBackupImportJson(json: string): Promise<void>;
    RegistryBackupMaintenanceRun(
        reason: string
    ): Promise<RegistryBackupMaintenanceResult>;
    AppLauncherSnapshotGet(): Promise<AppLauncherSnapshot>;
    AppLauncherEnabledSet(enabled: boolean): Promise<AppLauncherSnapshot>;
    AppLauncherEntriesSet(
        entries: AppLauncherEntry[]
    ): Promise<AppLauncherSnapshot>;
    AppLauncherEntryTest(entryId: string): Promise<AppLauncherSnapshot>;
    AppLauncherTestRunStop(runId: string): Promise<AppLauncherSnapshot>;
    AppLauncherTargetPick(
        kind: 'auto' | 'localApp'
    ): Promise<AppLauncherPickedTarget | null>;
    OpenFileSelectorDialog(
        defaultPath?: string | null,
        defaultExt?: string | null,
        defaultFilter?: string | null
    ): Promise<string>;
    OpenBackgroundImageFilesSelectorDialog(
        defaultPath?: string | null
    ): Promise<string[]>;
    BackgroundImageFilesResolve(input: {
        paths?: string[];
        folderPath?: string | null;
    }): Promise<string[]>;
    OpenFolderSelectorDialog(defaultPath?: string | null): Promise<string>;
    ReadVrcRegJsonFile(filepath: string): Promise<string>;
    SaveVrcRegJsonFile(
        defaultPath: string | null,
        defaultName: string,
        json: string
    ): Promise<string | null>;
    DeleteVRChatRegistryFolder(): Promise<void>;
    VrchatAuthConfigGet(input: {
        endpoint?: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatAuthCookieSessionRestore(input: {
        endpoint?: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatAuthCurrentUserGet(input: {
        endpoint?: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatAuthSessionGet(input: {
        endpoint?: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatAuthLoginBasic(input: {
        endpoint?: string;
        username: string;
        password: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatAuthLoginBasicStart(input: {
        endpoint?: string;
        username: string;
        password: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatAuthSavedSnapshotGet(): Promise<Record<string, unknown>>;
    VrchatAuthSavedCredentialDelete(input: {
        userId: string;
    }): Promise<Record<string, unknown>>;
    VrchatAuthSavedCredentialLoginStart(input: {
        userId: string;
        endpoint?: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatAuthLoginSuccessRecord(input: {
        user?: Record<string, unknown>;
        loginParams?: Record<string, unknown>;
        storedLoginParams?: Record<string, unknown> | null;
        saveCredentials?: boolean;
    }): Promise<Record<string, unknown>>;
    VrchatAuthLogoutRecord(input: {
        userOrUserId?: Record<string, unknown> | string | null;
        clearLastUserLoggedIn?: boolean;
        cookies?: unknown;
    }): Promise<Record<string, unknown>>;
    VrchatAuthTotpVerify(input: {
        endpoint?: string;
        code: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatAuthOtpVerify(input: {
        endpoint?: string;
        code: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatAuthEmailOtpVerify(input: {
        endpoint?: string;
        code: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatAuthVisitsGet(input: {
        endpoint?: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatAuthFileAnalysisGet(input: {
        endpoint?: string;
        fileId: string;
        version: number;
        variant: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatAvatarGet(input: {
        endpoint?: string;
        avatarId: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatAvatarGalleryGet(input: {
        endpoint?: string;
        avatarId: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatAvatarListByUserGet(input: {
        endpoint?: string;
        userId?: string;
        user?: string;
        n: number;
        offset: number;
        sort: string;
        order: string;
        releaseStatus: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatAvatarStylesGet(input: {
        endpoint?: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatAvatarModerationsGet(input: {
        endpoint?: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatAvatarFileGet(input: {
        endpoint?: string;
        fileId: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatAvatarSelect(input: {
        endpoint?: string;
        avatarId: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatAvatarSelectFallback(input: {
        endpoint?: string;
        avatarId: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatAvatarSave(input: {
        endpoint?: string;
        avatarId: string;
        params?: Record<string, unknown>;
    }): Promise<VrchatHttpApiResult>;
    VrchatAvatarDelete(input: {
        endpoint?: string;
        avatarId: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatAvatarImpostorCreate(input: {
        endpoint?: string;
        avatarId: string;
        emptyBody?: boolean;
    }): Promise<VrchatHttpApiResult>;
    VrchatAvatarImpostorDelete(input: {
        endpoint?: string;
        avatarId: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatAvatarModerationSend(input: {
        endpoint?: string;
        avatarId: string;
        type?: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatAvatarModerationDelete(input: {
        endpoint?: string;
        avatarId: string;
        type?: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatFavoriteAdd(input: {
        endpoint?: string;
        type: string;
        favoriteId: string;
        tags: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatFavoriteLimitsGet(input: {
        endpoint?: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatFavoritesGet(input: {
        endpoint?: string;
        n: number;
        offset: number;
    }): Promise<VrchatHttpApiResult>;
    VrchatFavoriteWorldsGet(input: {
        endpoint?: string;
        n: number;
        offset: number;
        ownerId?: string;
        userId?: string;
        tag?: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatFavoriteAvatarsGet(input: {
        endpoint?: string;
        n: number;
        offset: number;
        tag?: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatFavoriteGroupsGet(input: {
        endpoint?: string;
        n: number;
        offset: number;
        ownerId?: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatFavoriteDelete(input: {
        endpoint?: string;
        objectId: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatFavoriteGroupClear(input: {
        endpoint?: string;
        ownerId: string;
        type: string;
        group: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatFavoriteGroupSave(input: {
        endpoint?: string;
        ownerId: string;
        type: string;
        group: string;
        displayName?: string;
        visibility?: string;
    }): Promise<VrchatHttpApiResult>;
    LocalFavoriteAdd(input: {
        kind: LocalFavoriteKind;
        entityId: string;
        groupName: string;
    }): Promise<number>;
    LocalFavoriteRemove(input: {
        kind: LocalFavoriteKind;
        entityId: string;
        groupName: string;
    }): Promise<number>;
    LocalFavoriteGroupCreate(input: {
        kind: LocalFavoriteKind;
        groupName: string;
    }): Promise<void>;
    LocalFavoriteGroupRename(input: {
        kind: LocalFavoriteKind;
        groupName: string;
        newGroupName: string;
    }): Promise<number>;
    LocalFavoriteGroupDelete(input: {
        kind: LocalFavoriteKind;
        groupName: string;
    }): Promise<number>;
    FavoriteList(input: { kind: LocalFavoriteKind }): Promise<RawJsonRecord[]>;
    WorldCacheList(): Promise<RawJsonRecord[]>;
    WorldCacheGet(input: { worldId: string }): Promise<RawJsonRecord | null>;
    WorldCacheUpsert(input: { entry: RawJsonRecord }): Promise<void>;
    WorldCacheRemove(input: { worldId: string }): Promise<void>;
    AvatarCacheList(): Promise<RawJsonRecord[]>;
    UserTablesEnsure(input: { userId: string }): Promise<{
        userId: string;
        userPrefix: string;
    }>;
    FeedAddEntry(input: {
        userId: string;
        entry: RawJsonRecord;
    }): Promise<void>;
    FeedAvatarPurge(input: {
        userId: string;
        cutoffDate?: string | null;
    }): Promise<number>;
    FeedRowsQuery(input: { query: FeedRowsQueryInput }): Promise<FeedRowOutput[]>;
    FeedReadModelQuery(input: {
        query: FeedReadModelQueryInput;
    }): Promise<FeedReadModelOutput>;
    FeedLiveRowsMerge(input: {
        query: FeedLiveRowsMergeInput;
    }): Promise<FeedReadModelOutput>;
    GameLogEntriesAdd(input: {
        kind: GameLogKind;
        entries: RawJsonRecord[];
    }): Promise<void>;
    GameLogQuery(input: { query: GameLogQueryInput }): Promise<unknown>;
    GameLogInstanceDeleteByLocation(input: {
        location?: unknown;
    }): Promise<void>;
    GameLogInstanceDelete(input: {
        location?: unknown;
        eventIds: number[];
    }): Promise<void>;
    GameLogEntryDelete(input: {
        kind: GameLogKind;
        entry: RawJsonRecord;
    }): Promise<void>;
    ActivitySelfSourceSlice(input: {
        query: { fromDateIso: string; toDateIso?: string };
    }): Promise<ActivitySourceLocationOutput[]>;
    ActivitySelfSourceAfter(input: {
        query: { afterCreatedAt: string; inclusive?: boolean };
    }): Promise<ActivitySourceLocationOutput[]>;
    ActivitySelfSourceBounds(): Promise<ActivitySelfSourceBoundsOutput>;
    ActivityFriendPresenceSlice(input: {
        query: {
            ownerUserId: unknown;
            userId: unknown;
            fromDateIso: string;
            toDateIso?: string;
        };
    }): Promise<ActivityPresenceOutput[]>;
    ActivityFriendPresenceAfter(input: {
        query: {
            ownerUserId: unknown;
            userId: unknown;
            afterCreatedAt: string;
        };
    }): Promise<ActivityPresenceOutput[]>;
    ActivitySelfSessionsRefresh(input: {
        userId: string;
        mode: string;
        rangeDays?: unknown;
        nowMs?: number;
    }): Promise<ActivitySelfSessionsRefreshOutput>;
    ActivitySyncStateGet(input: {
        userId: string;
    }): Promise<ActivitySyncStateOutput | null>;
    ActivitySyncStateUpsert(input: {
        entry: RawJsonRecord;
    }): Promise<void>;
    ActivitySessionsGet(input: {
        userId: string;
    }): Promise<ActivitySessionOutput[]>;
    ActivitySessionsReplace(input: {
        userId: string;
        sessions: ActivitySessionInput[];
    }): Promise<void>;
    ActivitySessionsAppend(input: {
        userId: string;
        sessions: ActivitySessionInput[];
        replaceFromStartAt?: number | null;
    }): Promise<void>;
    ActivityBucketCacheGet(input: {
        query: RawJsonRecord;
    }): Promise<ActivityBucketCacheOutput | null>;
    ActivityBucketCacheUpsert(input: {
        entry: RawJsonRecord;
    }): Promise<void>;
    MutualGraphTablesEnsure(input: { userId: string }): Promise<RawJsonRecord>;
    MutualGraphSnapshotGet(input: {
        userId: string;
    }): Promise<MutualGraphSnapshotOutput>;
    MutualGraphSnapshotSave(input: {
        userId: string;
        entries: MutualGraphSnapshotEntryInput[];
    }): Promise<void>;
    MutualGraphFriendUpdate(input: {
        userId: string;
        friendId: string;
        mutualIds: string[];
    }): Promise<void>;
    MutualGraphMetaUpsert(input: {
        userId: string;
        entry: MutualGraphMetaInput;
    }): Promise<void>;
    MutualGraphMetaBulkUpsert(input: {
        userId: string;
        entries: MutualGraphMetaInput[];
    }): Promise<void>;
    MutualGraphFetchStatusGet(): Promise<MutualGraphFetchStatus>;
    MutualGraphFetchCancel(input: {
        ownerUserId?: string;
    }): Promise<MutualGraphFetchStatus>;
    MutualGraphFetchStart(input: {
        ownerUserId: string;
        endpoint?: string;
        friendIds: string[];
    }): Promise<MutualGraphFetchStatus>;
    MemoGetUser(input: { userId: string }): Promise<UserMemoOutput | null>;
    MemoListUsers(): Promise<UserMemoOutput[]>;
    MemoListUserNotes(input: {
        ownerUserId: string;
    }): Promise<UserNoteOutput[]>;
    MemoSaveUser(input: { userId: string; memo: string }): Promise<MemoSaveResult>;
    MemoGetWorld(input: { worldId: string }): Promise<WorldMemoOutput | null>;
    MemoSaveWorld(input: {
        worldId: string;
        memo: string;
    }): Promise<MemoSaveResult>;
    MemoGetAvatar(input: { avatarId: string }): Promise<AvatarMemoOutput | null>;
    MemoSaveAvatar(input: {
        avatarId: string;
        memo: string;
    }): Promise<MemoSaveResult>;
    PlayerListLocationGet(input: {
        location: string;
    }): Promise<PlayerLocationOutput | null>;
    PlayerListLatestLocationGet(): Promise<PlayerLocationOutput | null>;
    PlayerListJoinLeaveRows(input: {
        location: string;
        startedAt: string;
    }): Promise<PlayerJoinLeaveOutput[]>;
    DatabaseMaintenanceRun(input: { task: string }): Promise<unknown>;
    DatabaseMaintenanceMaxFriendLogNumberGet(input: {
        userId: string;
    }): Promise<number>;
    DatabaseMaintenanceTableSizesGet(input: {
        userId: string;
    }): Promise<MaintenanceTableSizesOutput>;
    DatabaseMaintenanceBrokenLeaveEntriesGet(): Promise<unknown[]>;
    DatabaseMaintenanceBrokenGameLogDisplayNamesGet(): Promise<
        BrokenGameLogDisplayNameOutput[]
    >;
    VrchatFriendsGet(input: {
        endpoint?: string;
        offline: boolean;
        n: number;
        offset: number;
    }): Promise<VrchatHttpApiResult>;
    VrchatFriendStatusGet(input: {
        userId: string;
        endpoint?: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatFriendDelete(input: {
        userId: string;
        endpoint?: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatFriendRequestSend(input: {
        userId: string;
        endpoint?: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatFriendRequestCancel(input: {
        userId: string;
        notificationId?: string;
        endpoint?: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatUserGet(input: {
        endpoint?: string;
        userId: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatUserMutualCountsGet(input: {
        endpoint?: string;
        userId: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatUserGroupsGet(input: {
        endpoint?: string;
        userId: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatUserRepresentedGroupGet(input: {
        endpoint?: string;
        userId: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatUserMutualFriendsGet(input: {
        endpoint?: string;
        userId: string;
        n: number;
        offset: number;
        includeUserIdParam?: boolean;
    }): Promise<VrchatHttpApiResult>;
    VrchatCurrentUserUpdate(input: {
        endpoint?: string;
        userId: string;
        params?: Record<string, unknown>;
    }): Promise<VrchatHttpApiResult>;
    VrchatCurrentUserBadgeUpdate(input: {
        endpoint?: string;
        userId: string;
        badgeId: string;
        hidden: boolean;
        showcased: boolean;
    }): Promise<VrchatHttpApiResult>;
    VrchatCurrentUserTagsAdd(input: {
        endpoint?: string;
        userId: string;
        tags: string[];
    }): Promise<VrchatHttpApiResult>;
    VrchatCurrentUserTagsRemove(input: {
        endpoint?: string;
        userId: string;
        tags: string[];
    }): Promise<VrchatHttpApiResult>;
    VrchatGroupGet(input: {
        endpoint?: string;
        groupId: string;
        includeRoles?: boolean;
    }): Promise<VrchatHttpApiResult>;
    VrchatGroupUserGroupsGet(input: {
        endpoint?: string;
        userId: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatGroupPostsGet(input: {
        endpoint?: string;
        groupId: string;
        n: number;
        offset: number;
    }): Promise<VrchatHttpApiResult>;
    VrchatGroupMembersGet(input: {
        endpoint?: string;
        groupId: string;
        n: number;
        offset: number;
        sort: string;
        roleId?: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatGroupMembersSearch(input: {
        endpoint?: string;
        groupId: string;
        n: number;
        offset: number;
        query: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatGroupGalleryGet(input: {
        endpoint?: string;
        groupId: string;
        galleryId: string;
        n: number;
        offset: number;
    }): Promise<VrchatHttpApiResult>;
    VrchatGroupInstancesGet(input: {
        endpoint?: string;
        groupId: string;
        userId: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatGroupBansGet(input: {
        endpoint?: string;
        groupId: string;
        n: number;
        offset: number;
    }): Promise<VrchatHttpApiResult>;
    VrchatGroupInvitesGet(input: {
        endpoint?: string;
        groupId: string;
        n: number;
        offset: number;
    }): Promise<VrchatHttpApiResult>;
    VrchatGroupJoinRequestsGet(input: {
        endpoint?: string;
        groupId: string;
        n: number;
        offset: number;
        blocked?: boolean;
    }): Promise<VrchatHttpApiResult>;
    VrchatGroupAuditLogTypesGet(input: {
        endpoint?: string;
        groupId: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatGroupLogsGet(input: {
        endpoint?: string;
        groupId: string;
        n: number;
        offset: number;
        eventTypes?: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatGroupUserInstancesGet(input: {
        endpoint?: string;
        userId: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatGroupPostCreate(input: {
        endpoint?: string;
        groupId: string;
        params?: Record<string, unknown>;
    }): Promise<VrchatHttpApiResult>;
    VrchatGroupPostEdit(input: {
        endpoint?: string;
        groupId: string;
        postId: string;
        params?: Record<string, unknown>;
    }): Promise<VrchatHttpApiResult>;
    VrchatGroupPostDelete(input: {
        endpoint?: string;
        groupId: string;
        postId: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatGroupJoin(input: {
        endpoint?: string;
        groupId: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatGroupLeave(input: {
        endpoint?: string;
        groupId: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatGroupRequestCancel(input: {
        endpoint?: string;
        groupId: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatGroupInviteSend(input: {
        endpoint?: string;
        groupId: string;
        userId: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatGroupMemberKick(input: {
        endpoint?: string;
        groupId: string;
        userId: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatGroupMemberBan(input: {
        endpoint?: string;
        groupId: string;
        userId: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatGroupMemberUnban(input: {
        endpoint?: string;
        groupId: string;
        userId: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatGroupInviteDelete(input: {
        endpoint?: string;
        groupId: string;
        userId: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatGroupJoinRequestRespond(input: {
        endpoint?: string;
        groupId: string;
        userId: string;
        action: string;
        block?: boolean;
    }): Promise<VrchatHttpApiResult>;
    VrchatGroupRepresentationSet(input: {
        endpoint?: string;
        groupId: string;
        isRepresenting: boolean;
    }): Promise<VrchatHttpApiResult>;
    VrchatGroupMemberPropsSet(input: {
        endpoint?: string;
        groupId: string;
        userId: string;
        params?: Record<string, unknown>;
    }): Promise<VrchatHttpApiResult>;
    VrchatGroupBlock(input: {
        endpoint?: string;
        groupId: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatGroupUnblock(input: {
        endpoint?: string;
        groupId: string;
        userId: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatInstanceGet(input: {
        endpoint?: string;
        worldId: string;
        instanceId: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatInstanceShortNameGet(input: {
        endpoint?: string;
        worldId: string;
        instanceId: string;
        shortName?: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatInstanceCreate(input: {
        endpoint?: string;
        params?: Record<string, unknown>;
    }): Promise<VrchatHttpApiResult>;
    VrchatInstanceSelfInvite(input: {
        endpoint?: string;
        worldId: string;
        instanceId: string;
        shortName?: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatInstanceClose(input: {
        endpoint?: string;
        location: string;
        hardClose?: boolean;
    }): Promise<VrchatHttpApiResult>;
    VrchatMediaFilesGet(input: {
        endpoint?: string;
        params?: Record<string, unknown>;
    }): Promise<VrchatHttpApiResult>;
    VrchatMediaFileDelete(input: {
        endpoint?: string;
        fileId: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatMediaGalleryImageUpload(input: {
        endpoint?: string;
        imageData: string;
        params?: Record<string, unknown>;
    }): Promise<VrchatHttpApiResult>;
    VrchatMediaAvatarGalleryImageUpload(input: {
        endpoint?: string;
        imageData: string;
        avatarId: unknown;
    }): Promise<VrchatHttpApiResult>;
    VrchatMediaVrcPlusIconUpload(input: {
        endpoint?: string;
        imageData: string;
        params?: Record<string, unknown>;
    }): Promise<VrchatHttpApiResult>;
    VrchatMediaEmojiUpload(input: {
        endpoint?: string;
        imageData: string;
        params?: Record<string, unknown>;
    }): Promise<VrchatHttpApiResult>;
    VrchatMediaStickerUpload(input: {
        endpoint?: string;
        imageData: string;
        params?: Record<string, unknown>;
    }): Promise<VrchatHttpApiResult>;
    VrchatMediaPrintUpload(input: {
        endpoint?: string;
        imageData: string;
        cropWhiteBorder: boolean;
        params?: Record<string, unknown>;
    }): Promise<VrchatHttpApiResult>;
    VrchatMediaPrintsGet(input: {
        endpoint?: string;
        userId: string;
        n: number;
    }): Promise<VrchatHttpApiResult>;
    VrchatMediaPrintGet(input: {
        endpoint?: string;
        printId: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatMediaPrintDelete(input: {
        endpoint?: string;
        printId: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatMediaInventoryItemsGet(input: {
        endpoint?: string;
        params?: Record<string, unknown>;
    }): Promise<VrchatHttpApiResult>;
    VrchatMediaUserInventoryItemGet(input: {
        endpoint?: string;
        userId: string;
        inventoryId: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatMediaInventoryItemUpdate(input: {
        endpoint?: string;
        inventoryId: string;
        params?: Record<string, unknown>;
    }): Promise<VrchatHttpApiResult>;
    VrchatMediaInventoryBundleConsume(input: {
        endpoint?: string;
        inventoryId: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatMediaRewardRedeem(input: {
        endpoint?: string;
        code: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatMediaFileVersionCreate(input: {
        endpoint?: string;
        fileId: string;
        fileMd5: string;
        fileSizeInBytes: number;
        signatureMd5: string;
        signatureSizeInBytes: number;
    }): Promise<VrchatHttpApiResult>;
    VrchatMediaFileUploadStart(input: {
        endpoint?: string;
        fileId: string;
        version: number;
        kind: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatMediaFileUploadFinish(input: {
        endpoint?: string;
        fileId: string;
        version: number;
        kind: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatMediaFilePut(input: {
        url: string;
        fileData: string;
        fileMIME: string;
        fileMD5: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatMediaAvatarImageSet(input: {
        endpoint?: string;
        entityId: string;
        imageUrl: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatMediaAvatarImageUploadLegacy(input: {
        endpoint?: string;
        entityId: string;
        imageUrl: string;
        base64File: string;
        fileSizeInBytes?: number;
    }): Promise<VrchatHttpApiResult>;
    VrchatMediaAssetUpload(input: {
        endpoint?: string;
        assetKind: string;
        imageData: string;
        cropWhiteBorder?: boolean;
        params?: Record<string, unknown>;
    }): Promise<VrchatHttpApiResult>;
    VrchatMediaWorldImageSet(input: {
        endpoint?: string;
        entityId: string;
        imageUrl: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatMediaWorldImageUploadLegacy(input: {
        endpoint?: string;
        entityId: string;
        imageUrl: string;
        base64File: string;
        fileSizeInBytes?: number;
    }): Promise<VrchatHttpApiResult>;
    RuntimeBackgroundJobRecord(input: {
        name: string;
        owner?: string;
        cadenceSeconds?: number | null;
        status: string;
        detail?: string;
    }): Promise<void>;
    RuntimeFrontendScheduleDueJobsGet(): Promise<string[]>;
    RuntimeFrontendScheduleJobDueClaim(input: {
        name: string;
        cadenceSeconds: number;
        initialDelaySeconds?: number;
    }): Promise<boolean>;
    RuntimeFrontendScheduleJobDefer(input: {
        name: string;
        delaySeconds: number;
    }): Promise<boolean>;
    RuntimeFrontendScheduleSchedulesReset(): Promise<void>;
    RuntimeGroupInstancesRefresh(): Promise<void>;
    RuntimeBackgroundJobsSnapshotGet(): Promise<RuntimeBackgroundJobSnapshot[]>;
    RuntimeDiagnosticsGet(): Promise<RuntimeDiagnosticsSnapshot>;
    ExternalApiAvatarSearchGet(input: {
        url: string;
        vrcxId: string;
    }): Promise<VrchatHttpApiResult>;
    ExternalApiTranslationRequest(input: {
        url: string;
        method?: string;
        headers?: Record<string, string>;
        body?: unknown;
    }): Promise<VrchatHttpApiResult>;
    ExternalApiYoutubeVideoMetadataGet(input: {
        videoId: string;
        apiKey: string;
    }): Promise<VrchatHttpApiResult>;
    ExternalApiVrcStatusJsonGet(input: {
        path: string;
    }): Promise<VrchatHttpApiResult>;
    ExternalApiGithubReleasesGet(input: {
        url: string;
        headers?: Record<string, string>;
    }): Promise<VrchatHttpApiResult>;
    ExternalApiImageDataUrlGet(input: {
        url: string;
    }): Promise<VrchatHttpApiResult>;
    ModerationSyncRefresh(input: {
        userId: string;
        endpoint?: string;
    }): Promise<ModerationSyncRefreshResult>;
    ModerationSyncUpdate(input: {
        ownerUserId?: string;
        endpoint?: string;
        targetUserId: string;
        targetDisplayName?: string;
        type: string;
        enabled: boolean;
    }): Promise<ModerationSyncUpdateResult>;
    VrchatNotificationMarkSeen(input: {
        userId: string;
        id: string;
        version: number;
        endpoint?: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatNotificationAcceptFriendRequest(input: {
        id: string;
        endpoint?: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatNotificationHideRemote(input: {
        id: string;
        version?: number;
        type?: string;
        senderUserId?: string;
        endpoint?: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatNotificationRespond(input: {
        id: string;
        responseType: string;
        responseData?: unknown;
        endpoint?: string;
    }): Promise<VrchatHttpApiResult>;
    NotificationListQuery(input: {
        query: {
            userId: string;
            search?: string;
            filters?: string[];
            perTableLimit?: number;
            limit?: number;
            includeUnseen?: boolean;
        };
    }): Promise<VrchatNotificationListItem[]>;
    NotificationAddV1(input: {
        userId: string;
        notification: RawJsonRecord;
    }): Promise<void>;
    NotificationAddV2(input: {
        userId: string;
        notification: RawJsonRecord;
    }): Promise<void>;
    NotificationV2Expire(input: { userId: string; id: string }): Promise<void>;
    NotificationV2MarkSeen(input: { userId: string; id: string }): Promise<void>;
    NotificationUpdateExpired(input: {
        userId: string;
        id: unknown;
        expired: boolean;
    }): Promise<void>;
    NotificationDelete(input: { userId: string; id: string }): Promise<void>;
    NotificationExpire(input: { userId: string; id: string }): Promise<void>;
    NotificationMarkSeenLocalBulk(input: {
        userId: string;
        ids: string[];
    }): Promise<void>;
    VrchatInviteResponseSend(input: {
        id: string;
        responseSlot: number;
        endpoint?: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatInviteResponsePhotoSend(input: {
        id: string;
        responseSlot: number;
        imageData: string;
        endpoint?: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatInvitePhotoSend(input: {
        receiverUserId: string;
        params?: Record<string, unknown>;
        imageData: string;
        endpoint?: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatInviteSend(input: {
        receiverUserId: string;
        params?: Record<string, unknown>;
        endpoint?: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatRequestInvitePhotoSend(input: {
        receiverUserId: string;
        params?: Record<string, unknown>;
        imageData: string;
        endpoint?: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatRequestInviteSend(input: {
        receiverUserId: string;
        params?: Record<string, unknown>;
        endpoint?: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatBoopSend(input: {
        userId: string;
        emojiId?: string;
        endpoint?: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatSearchConfigGet(input: {
        endpoint?: string;
        params?: Record<string, unknown>;
    }): Promise<VrchatHttpApiResult>;
    VrchatSearchWorldsGet(input: {
        endpoint?: string;
        params?: Record<string, unknown>;
        option?: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatSearchUsersGet(input: {
        endpoint?: string;
        params?: Record<string, unknown>;
    }): Promise<VrchatHttpApiResult>;
    VrchatSearchGroupsGet(input: {
        endpoint?: string;
        params?: Record<string, unknown>;
    }): Promise<VrchatHttpApiResult>;
    VrchatSearchGroupsStrictGet(input: {
        endpoint?: string;
        params?: Record<string, unknown>;
    }): Promise<VrchatHttpApiResult>;
    VrchatSearchInstanceShortNameGet(input: {
        endpoint?: string;
        shortName: string;
    }): Promise<VrchatHttpApiResult>;
    SocialFavoritesBaselineGet(input: {
        userId: string;
        endpoint?: string;
        currentUserSnapshot: Record<string, unknown>;
        friendRosterById?: Record<string, unknown>;
    }): Promise<SocialFavoritesBaselineResult>;
    SocialFriendRosterBaselineGet(input: {
        userId: string;
        endpoint?: string;
        currentUserSnapshot: Record<string, unknown>;
        explicitAddIntentUserIds?: string[];
    }): Promise<SocialFriendRosterBaselineResult>;
    VrchatToolsCalendarsGet(input: {
        endpoint?: string;
        params?: Record<string, unknown>;
    }): Promise<VrchatHttpApiResult>;
    VrchatToolsGroupCalendarGet(input: {
        endpoint?: string;
        groupId: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatToolsFollowingCalendarsGet(input: {
        endpoint?: string;
        params?: Record<string, unknown>;
    }): Promise<VrchatHttpApiResult>;
    VrchatToolsFeaturedCalendarsGet(input: {
        endpoint?: string;
        params?: Record<string, unknown>;
    }): Promise<VrchatHttpApiResult>;
    VrchatToolsGroupEventFollow(input: {
        endpoint?: string;
        groupId: string;
        eventId: string;
        isFollowing: boolean;
    }): Promise<VrchatHttpApiResult>;
    VrchatToolsGroupCalendarIcsGet(input: {
        endpoint?: string;
        groupId: string;
        eventId: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatToolsUserNoteSave(input: {
        endpoint?: string;
        targetUserId: string;
        note: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatToolsUserReport(input: {
        endpoint?: string;
        userId: string;
        contentType?: string;
        reason: string;
        type?: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatToolsInviteMessagesGet(input: {
        endpoint?: string;
        currentUserId: string;
        messageType: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatToolsInviteMessageEdit(input: {
        endpoint?: string;
        currentUserId: string;
        messageType: string;
        slot: string;
        message: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatWorldGet(input: {
        endpoint?: string;
        worldId: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatWorldListByUserGet(input: {
        endpoint?: string;
        userId: string;
        n: number;
        offset: number;
        sort: string;
        order: string;
        releaseStatus: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatWorldSave(input: {
        endpoint?: string;
        worldId: string;
        params?: Record<string, unknown>;
    }): Promise<VrchatHttpApiResult>;
    VrchatWorldDelete(input: {
        endpoint?: string;
        worldId: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatWorldPublish(input: {
        endpoint?: string;
        worldId: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatWorldUnpublish(input: {
        endpoint?: string;
        worldId: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatWorldPersistentDataDelete(input: {
        endpoint?: string;
        userId: string;
        worldId: string;
    }): Promise<VrchatHttpApiResult>;
    VrchatWorldPersistentDataExists(input: {
        endpoint?: string;
        userId: string;
        worldId: string;
    }): Promise<VrchatHttpApiResult>;
    RuntimeLifecycleSnapshotGet(): Promise<RuntimeLifecycleSnapshot>;
    RuntimeSyncSnapshotGet(): Promise<RuntimeSyncSnapshot>;
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
