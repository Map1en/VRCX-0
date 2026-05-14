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

export interface AppBackendNamespace extends BackendNamespace {
    AppendErrorLog(entry: string): Promise<void>;
    ExitApplication(): Promise<void>;
    GetHostCapabilities(): Promise<HostCapabilities>;
    SetGameClientRuntimeState(
        sessionActive: boolean,
        currentLocation: string
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
