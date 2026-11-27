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

describe('page reach telemetry', () => {
    it('normalizes dynamic and nested paths to canonical route slugs', async () => {
        mockTelemetryQueue();
        const mod = await import('./telemetryPageReach');
        expect(mod.normalizeRouteKey('/feed')).toBe('feed');
        expect(mod.normalizeRouteKey('/login')).toBe('login');
        expect(mod.normalizeRouteKey('/dashboard/abc-123')).toBe('dashboard');
        expect(mod.normalizeRouteKey('/social/friend-log')).toBe('friend_log');
        expect(mod.normalizeRouteKey('/charts/mutual')).toBe('charts_mutual');
        expect(mod.normalizeRouteKey('/unknown-page')).toBeNull();
    });

    it('forwards recognized route visits to Rust telemetry', async () => {
        const { queueTelemetryEvent } = mockTelemetryQueue();
        const mod = await import('./telemetryPageReach');

        mod.recordRouteEnter('/game-log');
        mod.recordRouteEnter('/unknown-page');

        expect(queueTelemetryEvent).toHaveBeenNthCalledWith(1, {
            type: 'pageVisit',
            route: 'game_log',
            landing: true
        });
        expect(queueTelemetryEvent).toHaveBeenCalledTimes(1);
    });

    it('marks the first page after startup or login as the landing page', async () => {
        const { queueTelemetryEvent } = mockTelemetryQueue();
        const mod = await import('./telemetryPageReach');

        mod.recordRouteEnter('/');
        mod.recordRouteEnter('/feed');
        mod.recordRouteEnter('/game-log');
        mod.recordRouteEnter('/login');
        mod.recordRouteEnter('/activity');
        mod.recordRouteEnter('/feed');

        expect(queueTelemetryEvent.mock.calls.map(([event]) => event)).toEqual([
            { type: 'pageVisit', route: 'feed', landing: true },
            { type: 'pageVisit', route: 'game_log', landing: false },
            { type: 'pageVisit', route: 'login', landing: false },
            { type: 'pageVisit', route: 'feed', landing: false }
        ]);
    });

    it('forwards route errors only after a recognized current route', async () => {
        const { queueTelemetryEvent } = mockTelemetryQueue();
        const mod = await import('./telemetryPageReach');

        mod.recordRouteError('render_crash', new Error('ignored'));
        mod.recordRouteEnter('/game-log');
        mod.recordRouteError(
            'render_crash',
            new TypeError('failed for usr_123 at https://example.com')
        );

        expect(queueTelemetryEvent).toHaveBeenNthCalledWith(1, {
            type: 'pageVisit',
            route: 'game_log',
            landing: true
        });
        expect(queueTelemetryEvent).toHaveBeenNthCalledWith(2, {
            type: 'routeError',
            error_class: 'render_crash',
            name: 'TypeError',
            summary: 'failed for usr_123 at https://example.com'
        });
    });
});
