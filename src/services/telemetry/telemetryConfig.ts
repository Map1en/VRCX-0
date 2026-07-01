import { MINUTE_MS } from '@/shared/constants/time';
import { usePreferencesStore } from '@/state/preferencesStore';

export const TELEMETRY_INSTALL_ID_CONFIG_KEY = 'telemetryInstallId';
export const TELEMETRY_BASIC_INFO_REPORTED_VERSION_CONFIG_KEY =
    'telemetryBasicInfoReportedVersion';
export const TELEMETRY_CONFIG_REPORTED_VERSION_CONFIG_KEY =
    'telemetryConfigReportedVersion';
export const TELEMETRY_CLIENT_ERROR_CURSOR_CONFIG_KEY =
    'telemetryClientErrorCursor';
export const TELEMETRY_HEARTBEAT_INTERVAL_MS = 30 * MINUTE_MS;
export const TELEMETRY_REQUEST_TIMEOUT_MS = 15_000;

export function getTelemetryEndpoint(): string {
    if (!VRCX_0_TELEMETRY_ENABLED) {
        return '';
    }
    return String(VRCX_0_TELEMETRY_ENDPOINT || '')
        .trim()
        .replace(/\/+$/, '');
}

export function isTelemetryEnabled(): boolean {
    return getTelemetryEndpoint().length > 0;
}

export function isAnonymousUsageTelemetryEnabled(): boolean {
    return usePreferencesStore.getState().anonymousUsageTelemetry !== false;
}
