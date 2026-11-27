import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    invokeTauri: vi.fn()
}));

vi.mock('./invoke', () => ({
    invokeTauri: mocks.invokeTauri
}));

import { queueTelemetryEvent } from './telemetryQueue';

describe('telemetry queue', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        mocks.invokeTauri.mockReset().mockResolvedValue(null);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('sends events queued within one second in a single IPC call', async () => {
        queueTelemetryEvent({
            type: 'slowCommand',
            command: 'app__user_get',
            duration_ms: 420
        });
        await vi.advanceTimersByTimeAsync(500);
        queueTelemetryEvent({
            type: 'slowCommand',
            command: 'app__user_groups',
            duration_ms: 610
        });
        queueTelemetryEvent({ type: 'toolOpen', tool: 'profile-backup' });

        expect(mocks.invokeTauri).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(500);

        expect(mocks.invokeTauri).toHaveBeenCalledOnce();
        expect(mocks.invokeTauri).toHaveBeenCalledWith(
            'app__telemetry_record_events',
            {
                events: [
                    {
                        type: 'slowCommand',
                        command: 'app__user_get',
                        duration_ms: 420
                    },
                    {
                        type: 'slowCommand',
                        command: 'app__user_groups',
                        duration_ms: 610
                    },
                    { type: 'toolOpen', tool: 'profile-backup' }
                ]
            }
        );
    });

    it('starts a new batch for events queued after a flush', async () => {
        queueTelemetryEvent({ type: 'toolOpen', tool: 'profile-backup' });
        await vi.advanceTimersByTimeAsync(1_000);
        queueTelemetryEvent({ type: 'toolOpen', tool: 'screenshot-metadata' });
        await vi.advanceTimersByTimeAsync(1_000);

        expect(mocks.invokeTauri.mock.calls.map(([, args]) => args)).toEqual([
            { events: [{ type: 'toolOpen', tool: 'profile-backup' }] },
            { events: [{ type: 'toolOpen', tool: 'screenshot-metadata' }] }
        ]);
    });
});
