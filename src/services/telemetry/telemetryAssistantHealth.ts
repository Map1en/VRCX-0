import { recordTelemetryEvent } from './telemetryEvent';

type AssistantToolErrorInput = {
    source?: string;
    args?: string;
    summary?: string;
};

const SAFE_STRING_ARG_KEYS = new Set([
    'access',
    'groupBy',
    'group_by',
    'mode',
    'order',
    'period',
    'scope',
    'sort',
    'timeBound',
    'timeWindow',
    'time_bound',
    'time_window',
    'type'
]);

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function summarizeArgValue(key: string, value: unknown): string {
    if (value === null) {
        return 'null';
    }
    if (typeof value === 'boolean') {
        return value ? 'true' : 'false';
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        return String(value);
    }
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (
            SAFE_STRING_ARG_KEYS.has(key) &&
            /^[A-Za-z0-9_.:-]{1,32}$/.test(trimmed)
        ) {
            return trimmed;
        }
        return '<text>';
    }
    if (Array.isArray(value)) {
        return '<array>';
    }
    if (typeof value === 'object') {
        return '<object>';
    }
    return '<value>';
}

function summarizeToolArgs(args?: string): string | undefined {
    if (!args?.trim()) {
        return undefined;
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(args);
    } catch {
        return 'args=<text>';
    }
    if (!isRecord(parsed)) {
        return 'args=<value>';
    }
    const entries = Object.entries(parsed)
        .sort(([left], [right]) => left.localeCompare(right))
        .slice(0, 8)
        .map(([key, value]) => `${key}=${summarizeArgValue(key, value)}`);
    return entries.length ? entries.join(', ') : undefined;
}

function buildToolErrorSummary(
    input: AssistantToolErrorInput
): string | undefined {
    const parts = [
        summarizeToolArgs(input.args),
        input.summary?.trim() ? 'result=<text>' : undefined
    ].filter((part): part is string => Boolean(part));
    return parts.length ? parts.join('; ') : undefined;
}

function nullableTrimmed(value: string | undefined): string | null {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
}

export function recordAssistantToolError(input: AssistantToolErrorInput): void {
    recordTelemetryEvent({
        type: 'assistantToolError',
        source: nullableTrimmed(input.source),
        summary: buildToolErrorSummary(input) ?? null
    });
}

export function recordAssistantTurnError(code: string, summary?: string): void {
    if (code === 'cancelled') {
        return;
    }
    recordTelemetryEvent({
        type: 'assistantTurnError',
        code,
        summary: nullableTrimmed(summary)
    });
}
