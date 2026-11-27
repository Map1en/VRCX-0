import { commands, type TelemetryClientEvent } from '@/platform/tauri/bindings';
import { queueTelemetryEvent } from '@/platform/tauri/telemetryQueue';

export function recordTelemetryEvent(event: TelemetryClientEvent): void {
    queueTelemetryEvent(event);
}

export async function submitTelemetryFeedback(content: string): Promise<void> {
    await commands.appTelemetrySubmitFeedback(content);
}
