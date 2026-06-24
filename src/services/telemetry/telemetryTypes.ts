import type { BackendRuntimeMode } from '@/platform/tauri/bindings';

export type TelemetryRuntimeMode = BackendRuntimeMode;

export type TelemetryContextPayload = {
    installId: string;
    sessionId: string;
    appVersion: string;
    platform: string;
    arch: string;
    locale: string;
    timezone: string;
    mode: TelemetryRuntimeMode;
    vrchatRunning: boolean;
    localWeekday: number;
    localHour: number;
    sessionEnded?: boolean;
};

export type TelemetryVrchatLifecycleState = 'started' | 'stopped';

export type TelemetryVrchatLifecyclePayload = TelemetryContextPayload & {
    state: TelemetryVrchatLifecycleState;
};

export type TelemetrySessionState = {
    installId: string;
    sessionId: string;
    isNewInstall?: boolean;
};

export type TelemetryConfigSnapshot = {
    backgroundModeEnabled: boolean;
    wristOverlayEnabled: boolean;
    xsNotifications: boolean;
    ovrtHudNotifications: boolean;
    ovrtWristNotifications: boolean;
    discordActive: boolean;
    mcpServerEnabled: boolean;
    webhookEnabled: boolean;
    autoStateChangeEnabled: boolean;
    autoAcceptInviteRequests: string;
    avatarAutoCleanup: string;
    themeMode: string;
};

export type TelemetryConfigSnapshotPayload = TelemetryContextPayload & {
    config: TelemetryConfigSnapshot;
};

export type TelemetryViewModeDimension =
    | 'gameLogViewMode'
    | 'myAvatarsViewMode'
    | 'feedViewMode'
    | 'feedTimeDisplayMode';

export type TelemetryViewModeUsageEntry = {
    dimension: TelemetryViewModeDimension;
    used: string[];
    switches: number;
};

export type TelemetryViewModeUsagePayload = TelemetryContextPayload & {
    modes: TelemetryViewModeUsageEntry[];
};

export type TelemetryPageRouteKey =
    | 'friends_locations'
    | 'game_log'
    | 'instance_history'
    | 'player_list'
    | 'search'
    | 'dashboard'
    | 'favorites_friends'
    | 'favorites_worlds'
    | 'favorites_avatars'
    | 'friend_log'
    | 'moderation'
    | 'my_avatars'
    | 'notification'
    | 'friend_list'
    | 'charts_mutual'
    | 'tools'
    | 'gallery'
    | 'inventory'
    | 'screenshot_metadata'
    | 'vrchat_log'
    | 'themes'
    | 'settings';

export type TelemetryRouteErrorClass = 'load_fail' | 'render_crash';

export type TelemetryErrorDetail = {
    kind: TelemetryRouteErrorClass | 'tool_error' | 'turn_error';
    source?: string;
    code?: string;
    name?: string;
    summary?: string;
    signature: string;
    count: number;
};

export type TelemetryPageUsageEntry = {
    route: TelemetryPageRouteKey;
    visits: number;
    loadFail?: number;
    renderCrash?: number;
    details?: TelemetryErrorDetail[];
};

export type TelemetryPageUsagePayload = TelemetryContextPayload & {
    routes: TelemetryPageUsageEntry[];
};

export type TelemetryAssistantHealthPayload = TelemetryContextPayload & {
    toolErrors: number;
    turnErrors: number;
    details?: TelemetryErrorDetail[];
};
