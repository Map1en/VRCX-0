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

describe('view mode usage telemetry', () => {
    it('forwards allowed normalized view mode switches', async () => {
        const { appTelemetryRecordEvent } = mockTelemetryCommand();
        const mod = await import('./telemetryViewModeUsage');

        mod.recordViewModeUsage('gameLogViewMode', ' TABLE ');
        mod.recordViewModeUsage('feedTimeDisplayMode', 'exact');

        expect(appTelemetryRecordEvent).toHaveBeenNthCalledWith(1, {
            type: 'viewModeSwitch',
            dimension: 'gameLogViewMode',
            value: 'table'
        });
        expect(appTelemetryRecordEvent).toHaveBeenNthCalledWith(2, {
            type: 'viewModeSwitch',
            dimension: 'feedTimeDisplayMode',
            value: 'exact'
        });
    });

    it('drops values outside the frontend allowlist', async () => {
        const { appTelemetryRecordEvent } = mockTelemetryCommand();
        const mod = await import('./telemetryViewModeUsage');

        mod.recordViewModeUsage('gameLogViewMode', 'columns');
        mod.recordViewModeUsage('feedViewMode', 'sessions');

        expect(appTelemetryRecordEvent).not.toHaveBeenCalled();
    });
});
