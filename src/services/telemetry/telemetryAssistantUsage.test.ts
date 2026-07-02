import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TelemetryClientEvent } from '@/platform/tauri/bindings';

afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
});

function mockTelemetryCommand() {
    const appTelemetryRecordEvent = vi.fn((event: TelemetryClientEvent) => {
        void event;
        return Promise.resolve(null);
    });
    vi.doMock('@/platform/tauri/bindings', () => ({
        commands: { appTelemetryRecordEvent }
    }));
    return { appTelemetryRecordEvent };
}

describe('assistant usage telemetry', () => {
    it('forwards assistant open and API key configured events', async () => {
        const { appTelemetryRecordEvent } = mockTelemetryCommand();
        const mod = await import('./telemetryAssistantUsage');

        mod.recordAssistantOpen();
        mod.recordAssistantApiKeyConfigured();

        expect(appTelemetryRecordEvent).toHaveBeenNthCalledWith(1, {
            type: 'assistantOpen'
        });
        expect(appTelemetryRecordEvent).toHaveBeenNthCalledWith(2, {
            type: 'assistantApiKeyConfigured'
        });
    });
});
