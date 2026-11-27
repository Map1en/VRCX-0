import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TelemetryClientEvent } from '@/platform/tauri/bindings';

afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
});

function mockTelemetryQueue() {
    const queueTelemetryEvent = vi.fn((event: TelemetryClientEvent) => {
        void event;
    });
    vi.doMock('@/platform/tauri/telemetryQueue', () => ({
        queueTelemetryEvent
    }));
    return { queueTelemetryEvent };
}

describe('tool usage telemetry', () => {
    it('records one canonical tool-open event per accepted activation', async () => {
        const { queueTelemetryEvent } = mockTelemetryQueue();
        const mod = await import('./telemetryToolUsage');

        mod.recordToolOpen('profile-backup');
        mod.recordToolOpen('unknown-tool');

        expect(queueTelemetryEvent).toHaveBeenCalledOnce();
        expect(queueTelemetryEvent).toHaveBeenCalledWith({
            type: 'toolOpen',
            tool: 'profile-backup'
        });
    });
});
