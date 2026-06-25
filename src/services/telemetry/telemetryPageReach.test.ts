import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
});

function mockDeps(options: { anonymous: boolean }) {
    const postTelemetry = vi.fn((_path: string, _payload: unknown) =>
        Promise.resolve()
    );

    vi.doMock('./telemetryConfig', () => ({
        isAnonymousUsageTelemetryEnabled: () => options.anonymous
    }));
    vi.doMock('./telemetryClient', () => ({ postTelemetry }));
    vi.doMock('./telemetryPayload', () => ({
        buildTelemetryContext: () => ({ installId: 'i' })
    }));

    return { postTelemetry };
}

const session = { installId: 'i', sessionId: 's' };

type PageReachRoutePayload = {
    route: string;
    visits?: number;
    renderCrash?: number;
    details?: Array<{
        kind: string;
        name?: string;
        summary?: string;
        signature: string;
        count: number;
    }>;
};

type PageReachPayload = {
    routes: PageReachRoutePayload[];
};

function findRoute(payload: PageReachPayload, route: string) {
    const entry = payload.routes.find((item) => item.route === route);
    if (!entry) {
        throw new Error(`Route "${route}" not found in payload`);
    }
    return entry;
}

describe('page reach telemetry', () => {
    it('normalizes dynamic and nested paths to canonical route slugs', async () => {
        mockDeps({ anonymous: true });
        const mod = await import('./telemetryPageReach');
        expect(mod.normalizeRouteKey('/feed')).toBeNull();
        expect(mod.normalizeRouteKey('/login')).toBeNull();
        expect(mod.normalizeRouteKey('/dashboard/abc-123')).toBe('dashboard');
        expect(mod.normalizeRouteKey('/social/friend-log')).toBe('friend_log');
        expect(mod.normalizeRouteKey('/charts/instance')).toBeNull();
        expect(mod.normalizeRouteKey('/charts/mutual')).toBe('charts_mutual');
        expect(mod.normalizeRouteKey('/tools/gallery/')).toBe('gallery');
        expect(mod.normalizeRouteKey('/unknown-page')).toBeNull();
    });

    it('counts a visit per route entry and reports opened routes', async () => {
        const { postTelemetry } = mockDeps({ anonymous: true });
        const mod = await import('./telemetryPageReach');
        mod.recordRouteEnter('/game-log');
        mod.recordRouteEnter('/search');
        mod.recordRouteEnter('/game-log');
        await mod.sendPageReach(session);

        const [path, payload] = postTelemetry.mock.calls[0] as [
            string,
            PageReachPayload
        ];
        expect(path).toBe('/api/v1/telemetry/page-health');
        expect(findRoute(payload, 'game_log').visits).toBe(2);
        expect(findRoute(payload, 'search').visits).toBe(1);
    });

    it('attributes errors to the current route and omits zero counts', async () => {
        const { postTelemetry } = mockDeps({ anonymous: true });
        const mod = await import('./telemetryPageReach');
        mod.recordRouteEnter('/game-log');
        mod.recordRouteError('render_crash');
        mod.recordRouteEnter('/search');
        await mod.sendPageReach(session);

        const payload = postTelemetry.mock.calls[0]?.[1] as PageReachPayload;
        expect(findRoute(payload, 'game_log').renderCrash).toBe(1);
        expect(findRoute(payload, 'search').renderCrash).toBeUndefined();
    });

    it('reports route error details with sensitive values redacted', async () => {
        const { postTelemetry } = mockDeps({ anonymous: true });
        const mod = await import('./telemetryPageReach');
        mod.recordRouteEnter('/game-log');
        mod.recordRouteError(
            'render_crash',
            new Error(
                'Failed user usr_123 at https://example.com/path from C:\\Users\\name\\secret.txt'
            )
        );
        await mod.sendPageReach(session);

        const payload = postTelemetry.mock.calls[0]?.[1] as PageReachPayload;
        const details = findRoute(payload, 'game_log').details;
        expect(details).toEqual([
            expect.objectContaining({
                kind: 'render_crash',
                name: 'Error',
                count: 1
            })
        ]);
        expect(details?.[0]?.summary).toContain('<id>');
        expect(details?.[0]?.summary).toContain('<url>');
        expect(details?.[0]?.summary).toContain('<path>');
        expect(details?.[0]?.summary).not.toContain('usr_123');
        expect(details?.[0]?.summary).not.toContain('example.com');
        expect(details?.[0]?.summary).not.toContain('secret.txt');
    });

    it('does not send when anonymous usage telemetry is off', async () => {
        const { postTelemetry } = mockDeps({ anonymous: false });
        const mod = await import('./telemetryPageReach');
        mod.recordRouteEnter('/game-log');
        await mod.sendPageReach(session);
        expect(postTelemetry).not.toHaveBeenCalled();
    });

    it('clears accumulated usage on reset', async () => {
        const { postTelemetry } = mockDeps({ anonymous: true });
        const mod = await import('./telemetryPageReach');
        mod.recordRouteEnter('/game-log');
        mod.resetPageReach();
        await mod.sendPageReach(session);
        expect(postTelemetry).not.toHaveBeenCalled();
    });
});
