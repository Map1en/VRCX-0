import { postTelemetry } from './telemetryClient';
import { isAnonymousUsageTelemetryEnabled } from './telemetryConfig';
import {
    recordTelemetryErrorDetail,
    serializeTelemetryErrorDetails
} from './telemetryErrorDetails';
import { buildTelemetryContext } from './telemetryPayload';
import type {
    TelemetryErrorDetail,
    TelemetrySessionState
} from './telemetryTypes';

// Failures the chat UI cannot surface on its own: a tool call that errored (the
// model silently works around it) or a turn that died without an answer. Counts
// are cumulative per session and sent last-write-wins, mirroring page-health.
let toolErrors = 0;
let turnErrors = 0;
const details = new Map<string, TelemetryErrorDetail>();

export function recordAssistantToolError(source?: string): void {
    if (!isAnonymousUsageTelemetryEnabled()) {
        return;
    }
    toolErrors += 1;
    recordTelemetryErrorDetail(details, {
        kind: 'tool_error',
        source
    });
}

export function recordAssistantTurnError(code: string, summary?: string): void {
    // `cancelled` is a user action (stop / superseded), not a failure.
    if (!isAnonymousUsageTelemetryEnabled() || code === 'cancelled') {
        return;
    }
    turnErrors += 1;
    recordTelemetryErrorDetail(details, {
        kind: 'turn_error',
        code,
        summary
    });
}

export async function sendAssistantHealth(
    session: TelemetrySessionState
): Promise<void> {
    if (
        !isAnonymousUsageTelemetryEnabled() ||
        (toolErrors === 0 && turnErrors === 0)
    ) {
        return;
    }
    await postTelemetry('/api/v1/telemetry/assistant-health', {
        ...buildTelemetryContext(session),
        toolErrors,
        turnErrors,
        details: serializeTelemetryErrorDetails(details)
    });
}

export function resetAssistantHealth(): void {
    toolErrors = 0;
    turnErrors = 0;
    details.clear();
}
