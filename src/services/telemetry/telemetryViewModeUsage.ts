import { TELEMETRY_VIEW_MODE_DIMENSIONS } from './telemetryContract';
import { recordTelemetryEvent } from './telemetryEvent';
import type { TelemetryViewModeDimension } from './telemetryTypes';

const VIEW_MODE_VALUES: Record<TelemetryViewModeDimension, readonly string[]> =
    TELEMETRY_VIEW_MODE_DIMENSIONS;

function sanitizeValue(
    dimension: TelemetryViewModeDimension,
    value: unknown
): string | null {
    const normalized = String(value).trim().toLowerCase();
    return VIEW_MODE_VALUES[dimension].includes(normalized) ? normalized : null;
}

export function recordViewModeUsage(
    dimension: TelemetryViewModeDimension,
    value: string
): void {
    const normalized = sanitizeValue(dimension, value);
    if (!normalized) {
        return;
    }
    recordTelemetryEvent({
        type: 'viewModeSwitch',
        dimension,
        value: normalized
    });
}
