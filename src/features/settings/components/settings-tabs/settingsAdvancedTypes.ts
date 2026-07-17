import type { AppDataDirState } from '@/platform/tauri/bindings';

export type SettingsAdvancedPrefs = {
    anonymousUsageTelemetry?: boolean;
    autoSweepVRChatCache?: boolean;
    avatarAutoCleanup?: string;
    defaultLaunchMode?: string;
    gameLogDisabled?: boolean;
    logResourceLoad?: boolean;
    relaunchVRChatAfterCrash?: boolean;
    udonExceptionLogging?: boolean;
    vrcQuitFix?: boolean;
};

export type SettingsAdvancedAction = () => unknown | Promise<unknown>;

export type SettingsAdvancedModel = {
    appDataDirState?: AppDataDirState | null;
    avatarAutoCleanupOptions: string[];
    configTreeData: Record<string, unknown>;
    onAnonymousUsageTelemetryChange: (checked: boolean) => unknown;
    onAutoSweepVRChatCacheChange: (checked: boolean) => unknown;
    onAvatarAutoCleanupChange: (value: string) => unknown;
    onClearConfigTreeData: () => void;
    onDefaultLaunchModeChange: (value: string) => unknown;
    onGameLogDisabledChange: (disabled: boolean) => unknown;
    onLogResourceLoadChange: (checked: boolean) => unknown;
    onMigrateLegacyVrcxData: SettingsAdvancedAction;
    onOpenAppDataDirSelector: SettingsAdvancedAction;
    onOpenPurgeDialog: () => void;
    onRefreshConfigTreeData: SettingsAdvancedAction;
    onRefreshOnlineVisits: SettingsAdvancedAction;
    onRefreshSqliteTableSizes: SettingsAdvancedAction;
    onRelaunchVRChatAfterCrashChange: (checked: boolean) => unknown;
    onResetAppDataDir: SettingsAdvancedAction;
    onUdonExceptionLoggingChange: (checked: boolean) => unknown;
    onVrcQuitFixChange: (checked: boolean) => unknown;
    onlineVisitCount: number | null;
    prefs: SettingsAdvancedPrefs;
    sqliteTableSizeRows: ReadonlyArray<readonly [string, string]>;
    sqliteTableSizes: Record<string, unknown>;
};
