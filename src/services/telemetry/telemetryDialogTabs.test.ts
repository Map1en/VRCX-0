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

describe('dialog tab telemetry', () => {
    it('records the landing tab and each newly reached tab once per open', async () => {
        const { queueTelemetryEvent } = mockTelemetryQueue();
        const mod = await import('./telemetryDialogTabs');

        mod.recordDialogTabSwitch('user', 'groups');
        mod.recordDialogTabLanding('user', 'info');
        mod.recordDialogTabSwitch('user', 'groups');
        mod.recordDialogTabSwitch('user', 'info');
        mod.recordDialogTabSwitch('user', 'groups');
        mod.recordDialogTabSwitch('user', 'unknown-tab');
        mod.recordDialogTabLanding('user', 'groups');

        expect(queueTelemetryEvent.mock.calls.map(([event]) => event)).toEqual([
            {
                type: 'dialogTabView',
                dialog: 'user',
                tab: 'info',
                landing: true
            },
            {
                type: 'dialogTabView',
                dialog: 'user',
                tab: 'groups',
                landing: false
            },
            {
                type: 'dialogTabView',
                dialog: 'user',
                tab: 'groups',
                landing: true
            }
        ]);
    });

    it('tracks each dialog kind independently', async () => {
        const { queueTelemetryEvent } = mockTelemetryQueue();
        const mod = await import('./telemetryDialogTabs');

        mod.recordDialogTabLanding('world', 'instances');
        mod.recordDialogTabLanding('avatar', 'info');
        mod.recordDialogTabSwitch('world', 'info');

        expect(queueTelemetryEvent).toHaveBeenLastCalledWith({
            type: 'dialogTabView',
            dialog: 'world',
            tab: 'info',
            landing: false
        });
        expect(queueTelemetryEvent).toHaveBeenCalledTimes(3);
    });
});
