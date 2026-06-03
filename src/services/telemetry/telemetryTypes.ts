import type { BackendRuntimeMode } from '@/platform/tauri/appCommandTypes';

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
};

export type TelemetryEventPayload =
    TelemetryContextPayload & {
        eventType: 'error';
        errorCode: string;
    };

export type TelemetrySessionState = {
    installId: string;
    sessionId: string;
};
