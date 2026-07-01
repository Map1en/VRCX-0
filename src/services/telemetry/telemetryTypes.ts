import type { BackendRuntimeMode } from '@/platform/tauri/bindings';

import type {
    TELEMETRY_CONFIG_FIELDS,
    TelemetryPageRouteKey,
    TelemetryViewModeDimension
} from './telemetryContract';

export type {
    TelemetryPageRouteKey,
    TelemetryViewModeDimension
} from './telemetryContract';

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

type TelemetryConfigContractField =
    | (typeof TELEMETRY_CONFIG_FIELDS.booleanFields)[number]
    | (typeof TELEMETRY_CONFIG_FIELDS.optionalBooleanFields)[number]
    | (typeof TELEMETRY_CONFIG_FIELDS.enumFields)[number];

type Assert<T extends true> = T;
type _TelemetryConfigContractFieldsAreSnapshotKeys = Assert<
    Exclude<
        TelemetryConfigContractField,
        keyof TelemetryConfigSnapshot
    > extends never
        ? true
        : false
>;

export type TelemetryConfigSnapshotPayload = TelemetryContextPayload & {
    config: TelemetryConfigSnapshot;
};

export type TelemetryViewModeUsageEntry = {
    dimension: TelemetryViewModeDimension;
    used: string[];
    switches: number;
};

export type TelemetryViewModeUsagePayload = TelemetryContextPayload & {
    modes: TelemetryViewModeUsageEntry[];
};

export type TelemetryRouteErrorClass = 'load_fail' | 'render_crash';

export type TelemetryErrorDetail = {
    kind:
        | TelemetryRouteErrorClass
        | 'tool_error'
        | 'turn_error'
        | 'panic'
        | 'rust_error';
    source?: string;
    code?: string;
    name?: string;
    summary?: string;
    signature: string;
    appVersion?: string;
    count: number;
};

export type TelemetryErrorDetailKind = TelemetryErrorDetail['kind'];

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

export type TelemetryAssistantUsagePayload = TelemetryContextPayload & {
    opens: number;
    apiKeyConfigured?: boolean;
};

export type TelemetryClientErrorPayload = TelemetryContextPayload & {
    errors: TelemetryErrorDetail[];
};
