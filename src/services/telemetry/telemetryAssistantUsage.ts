import { recordTelemetryEvent } from './telemetryEvent';

export function recordAssistantOpen(): void {
    recordTelemetryEvent({ type: 'assistantOpen' });
}

export function recordAssistantApiKeyConfigured(): void {
    recordTelemetryEvent({ type: 'assistantApiKeyConfigured' });
}
