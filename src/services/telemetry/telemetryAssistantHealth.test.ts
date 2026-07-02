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

describe('assistant health telemetry', () => {
    it('forwards assistant tool errors with sanitized argument summaries', async () => {
        const { appTelemetryRecordEvent } = mockTelemetryCommand();
        const mod = await import('./telemetryAssistantHealth');

        mod.recordAssistantToolError({
            source: 'recall_encounter',
            args: JSON.stringify({
                query: 'Alice at https://example.com/world/usr_123',
                limit: 3,
                includeNonFriends: true,
                nested: { unsafe: 'wrld_secret' }
            }),
            summary:
                'tool failed for Alice in Blue Room usr_123 at https://example.com/chat'
        });

        expect(appTelemetryRecordEvent).toHaveBeenCalledWith({
            type: 'assistantToolError',
            source: 'recall_encounter',
            summary:
                'includeNonFriends=true, limit=3, nested=<object>, query=<text>; result=<text>'
        });
    });

    it('forwards assistant turn errors and ignores user cancellations', async () => {
        const { appTelemetryRecordEvent } = mockTelemetryCommand();
        const mod = await import('./telemetryAssistantHealth');

        mod.recordAssistantTurnError('cancelled', 'user stopped');
        mod.recordAssistantTurnError(
            'provider_error',
            'Provider failed for usr_123 at https://example.com/chat'
        );

        expect(appTelemetryRecordEvent).toHaveBeenCalledOnce();
        expect(appTelemetryRecordEvent).toHaveBeenCalledWith({
            type: 'assistantTurnError',
            code: 'provider_error',
            summary: 'Provider failed for usr_123 at https://example.com/chat'
        });
    });
});
