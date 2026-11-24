// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    recordTelemetryEvent: vi.fn(),
    currentTelemetryRoute: vi.fn(),
    activeDialog: null as { kind: string } | null
}));

vi.mock('./telemetryEvent', () => ({
    recordTelemetryEvent: mocks.recordTelemetryEvent
}));

vi.mock('./telemetryPageReach', () => ({
    currentTelemetryRoute: mocks.currentTelemetryRoute
}));

vi.mock('@/state/dialogStore', () => ({
    useDialogStore: {
        getState: () => ({ activeDialog: mocks.activeDialog })
    }
}));

import { recordLongFrames } from './telemetryLongFrames';

describe('recordLongFrames', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.activeDialog = null;
        mocks.currentTelemetryRoute.mockReturnValue('feed');
    });

    it('records only frames at or over 200ms on the current route', () => {
        recordLongFrames([120, 199.6, 200, 812.4]);

        expect(mocks.recordTelemetryEvent.mock.calls).toEqual([
            [
                {
                    type: 'longFrame',
                    route: 'feed',
                    dialog: null,
                    duration_ms: 200
                }
            ],
            [
                {
                    type: 'longFrame',
                    route: 'feed',
                    dialog: null,
                    duration_ms: 812
                }
            ]
        ]);
    });

    it('attributes frames to a tracked entity dialog and ignores other dialog kinds', () => {
        mocks.activeDialog = { kind: 'world' };
        recordLongFrames([300]);
        mocks.activeDialog = { kind: 'notification' };
        recordLongFrames([300]);

        expect(
            mocks.recordTelemetryEvent.mock.calls.map(([event]) => event.dialog)
        ).toEqual(['world', null]);
    });

    it('skips frames outside tracked routes', () => {
        mocks.currentTelemetryRoute.mockReturnValue(null);
        recordLongFrames([900]);

        expect(mocks.recordTelemetryEvent).not.toHaveBeenCalled();
    });
});
