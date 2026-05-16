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

export interface AppBackendNamespace extends BackendNamespace {
    AppendErrorLog(entry: string): Promise<void>;
    ExitApplication(): Promise<void>;
    GetHostCapabilities(): Promise<HostCapabilities>;
    BackendAppSnapshotGet(): Promise<BackendAppSnapshot>;
    BackendBackgroundJobsSnapshotGet(): Promise<BackendBackgroundJobSnapshot[]>;
    BackendDiagnosticsGet(): Promise<BackendDiagnosticsSnapshot>;
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
