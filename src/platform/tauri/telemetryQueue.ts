import type { TelemetryClientEvent } from './bindings';
import { invokeTauri } from './invoke';

const TELEMETRY_RECORD_COMMAND = 'app__telemetry_record_events';
const FLUSH_DELAY_MS = 1_000;

let pendingEvents: TelemetryClientEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function flushTelemetryEvents(): void {
    flushTimer = null;
    const events = pendingEvents;
    pendingEvents = [];
    void invokeTauri(TELEMETRY_RECORD_COMMAND, { events }).catch(() => {});
}

export function queueTelemetryEvent(event: TelemetryClientEvent): void {
    pendingEvents.push(event);
    flushTimer ??= setTimeout(flushTelemetryEvents, FLUSH_DELAY_MS);
}
