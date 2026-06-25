import configRepository from '@/repositories/configRepository';

import { postTelemetry } from './telemetryClient';
import { isAnonymousUsageTelemetryEnabled } from './telemetryConfig';
import { TELEMETRY_VIEW_MODE_DIMENSIONS } from './telemetryContract';
import { buildTelemetryContext } from './telemetryPayload';
import type {
    TelemetrySessionState,
    TelemetryViewModeDimension,
    TelemetryViewModeUsageEntry
} from './telemetryTypes';

type ViewModeDimensionConfig = {
    configKey: string;
    defaultValue: string;
    values: readonly string[];
};

const VIEW_MODE_DIMENSIONS: Record<
    TelemetryViewModeDimension,
    ViewModeDimensionConfig
> = {
    gameLogViewMode: {
        configKey: 'gameLogViewMode',
        defaultValue: 'sessions',
        values: TELEMETRY_VIEW_MODE_DIMENSIONS.gameLogViewMode
    },
    myAvatarsViewMode: {
        configKey: 'MyAvatarsViewMode',
        defaultValue: 'grid',
        values: TELEMETRY_VIEW_MODE_DIMENSIONS.myAvatarsViewMode
    },
    feedViewMode: {
        configKey: 'feedViewMode',
        defaultValue: 'table',
        values: TELEMETRY_VIEW_MODE_DIMENSIONS.feedViewMode
    },
    feedTimeDisplayMode: {
        configKey: 'feedTimeDisplayMode',
        defaultValue: 'relative',
        values: TELEMETRY_VIEW_MODE_DIMENSIONS.feedTimeDisplayMode
    }
};

type ViewModeUsage = { used: Set<string>; switches: number };

const usage = new Map<TelemetryViewModeDimension, ViewModeUsage>();

function ensureUsage(dimension: TelemetryViewModeDimension): ViewModeUsage {
    let entry = usage.get(dimension);
    if (!entry) {
        entry = { used: new Set<string>(), switches: 0 };
        usage.set(dimension, entry);
    }
    return entry;
}

function sanitizeValue(
    dimension: TelemetryViewModeDimension,
    value: unknown
): string | null {
    const config = VIEW_MODE_DIMENSIONS[dimension];
    if (!config) {
        return null;
    }
    const normalized = String(value).trim().toLowerCase();
    return config.values.includes(normalized) ? normalized : null;
}

export async function seedViewModeUsage(): Promise<void> {
    const dimensions = Object.keys(
        VIEW_MODE_DIMENSIONS
    ) as TelemetryViewModeDimension[];
    await Promise.all(
        dimensions.map(async (dimension) => {
            const config = VIEW_MODE_DIMENSIONS[dimension];
            try {
                const raw = await configRepository.getString(
                    config.configKey,
                    config.defaultValue
                );
                ensureUsage(dimension).used.add(
                    sanitizeValue(dimension, raw) ?? config.defaultValue
                );
            } catch {
                ensureUsage(dimension).used.add(config.defaultValue);
            }
        })
    );
}

export function recordViewModeUsage(
    dimension: TelemetryViewModeDimension,
    value: string
): void {
    if (!isAnonymousUsageTelemetryEnabled()) {
        return;
    }
    const normalized = sanitizeValue(dimension, value);
    if (!normalized) {
        return;
    }
    const entry = ensureUsage(dimension);
    entry.used.add(normalized);
    entry.switches += 1;
}

function buildViewModeUsagePayload(): TelemetryViewModeUsageEntry[] {
    const entries: TelemetryViewModeUsageEntry[] = [];
    for (const [dimension, entry] of usage) {
        if (entry.used.size === 0) {
            continue;
        }
        entries.push({
            dimension,
            used: [...entry.used].sort(),
            switches: entry.switches
        });
    }
    return entries;
}

export async function sendViewModeUsage(
    session: TelemetrySessionState
): Promise<void> {
    if (!isAnonymousUsageTelemetryEnabled()) {
        return;
    }
    const modes = buildViewModeUsagePayload();
    if (modes.length === 0) {
        return;
    }
    await postTelemetry('/api/v1/telemetry/view-mode', {
        ...buildTelemetryContext(session),
        modes
    });
}

export function resetViewModeUsage(): void {
    usage.clear();
}
