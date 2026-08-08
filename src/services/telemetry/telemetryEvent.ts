import { commands, type TelemetryClientEvent } from '@/platform/tauri/bindings';

export function recordTelemetryEvent(event: TelemetryClientEvent): void {
    void commands.appTelemetryRecordEvent(event).catch(() => {});
}
