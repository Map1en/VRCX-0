import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
});

const session = { installId: 'install-id', sessionId: 'session-id' };

type RustErrorPayload = {
    errors?: Array<{
        kind: string;
        source?: string;
        summary?: string;
        signature: string;
        appVersion?: string;
        count: number;
    }>;
};

function mockDeps({
    anonymous = true,
    entries,
    postRejects = false
}: {
    anonymous?: boolean;
    entries: unknown[];
    postRejects?: boolean;
}) {
    const appDrainClientErrorLog = vi.fn(() => Promise.resolve(entries));
    const getString = vi.fn(() => Promise.resolve(''));
    const setString = vi.fn(() => Promise.resolve());
    const postTelemetry = vi.fn((_path: string, _payload: unknown) =>
        postRejects
            ? Promise.reject(new Error('telemetry failed'))
            : Promise.resolve()
    );

    vi.doMock('@/platform/tauri/bindings', () => ({
        commands: { appDrainClientErrorLog }
    }));
    vi.doMock('@/repositories/configRepository', () => ({
        default: { getString, setString }
    }));
    vi.doMock('./telemetryConfig', () => ({
        TELEMETRY_CLIENT_ERROR_CURSOR_CONFIG_KEY: 'telemetryClientErrorCursor',
        isAnonymousUsageTelemetryEnabled: () => anonymous
    }));
    vi.doMock('./telemetryClient', () => ({ postTelemetry }));
    vi.doMock('./telemetryPayload', () => ({
        buildTelemetryContext: () => ({
            installId: 'install-id',
            sessionId: 'session-id',
            appVersion: '2.9.3',
            platform: 'windows'
        })
    }));

    return { appDrainClientErrorLog, getString, setString, postTelemetry };
}

describe('rust error telemetry', () => {
    it('posts versioned rust entries and advances the cursor after success', async () => {
        const { postTelemetry, setString } = mockDeps({
            entries: [
                {
                    tsIso: '2026-07-01T00:00:00.001Z',
                    appVersion: '2.8.0',
                    source: 'rust:panic',
                    message:
                        'panic for usr_123 at https://example.com from C:\\Users\\about\\secret.txt'
                },
                {
                    tsIso: '2026-07-01T00:00:00.002Z',
                    appVersion: null,
                    source: 'rust:tracing',
                    message: 'old unversioned error'
                }
            ]
        });
        const mod = await import('./telemetryRustErrors');

        await mod.seedRustErrors();
        await mod.sendRustErrors(session);

        const [path, payload] = postTelemetry.mock.calls[0] as [
            string,
            RustErrorPayload
        ];
        expect(path).toBe('/api/v1/telemetry/client-error');
        expect(payload.errors).toHaveLength(1);
        expect(payload.errors?.[0]).toMatchObject({
            kind: 'panic',
            source: 'rust:panic',
            appVersion: '2.8.0',
            count: 1
        });
        expect(payload.errors?.[0]?.summary).toContain('<id>');
        expect(payload.errors?.[0]?.summary).toContain('<url>');
        expect(payload.errors?.[0]?.summary).toContain('<path>');
        expect(payload.errors?.[0]?.summary).not.toContain('usr_123');
        expect(payload.errors?.[0]?.summary).not.toContain('example.com');
        expect(setString).toHaveBeenCalledWith(
            'telemetryClientErrorCursor',
            '2026-07-01T00:00:00.002Z'
        );
    });

    it('does not advance the cursor when posting fails', async () => {
        const { setString } = mockDeps({
            postRejects: true,
            entries: [
                {
                    tsIso: '2026-07-01T00:00:00.001Z',
                    appVersion: '2.8.0',
                    source: 'rust:tracing',
                    message: 'serialize failed'
                }
            ]
        });
        const mod = await import('./telemetryRustErrors');

        await expect(mod.sendRustErrors(session)).rejects.toThrow(
            /telemetry failed/
        );
        expect(setString).not.toHaveBeenCalled();
    });

    it('keeps the same signature separate across app versions', async () => {
        const { postTelemetry } = mockDeps({
            entries: [
                {
                    tsIso: '2026-07-01T00:00:00.001Z',
                    appVersion: '2.8.0',
                    source: 'rust:tracing',
                    message: 'same failure'
                },
                {
                    tsIso: '2026-07-01T00:00:00.002Z',
                    appVersion: '2.9.0',
                    source: 'rust:tracing',
                    message: 'same failure'
                }
            ]
        });
        const mod = await import('./telemetryRustErrors');

        await mod.sendRustErrors(session);

        const payload = postTelemetry.mock.calls[0]?.[1] as RustErrorPayload;
        expect(payload.errors).toHaveLength(2);
        expect(
            new Set(payload.errors?.map((item) => item.signature)).size
        ).toBe(1);
        expect(payload.errors?.map((item) => item.appVersion).sort()).toEqual([
            '2.8.0',
            '2.9.0'
        ]);
    });

    it('does not drain when anonymous usage telemetry is disabled', async () => {
        const { appDrainClientErrorLog, postTelemetry } = mockDeps({
            anonymous: false,
            entries: []
        });
        const mod = await import('./telemetryRustErrors');

        await mod.sendRustErrors(session);

        expect(appDrainClientErrorLog).not.toHaveBeenCalled();
        expect(postTelemetry).not.toHaveBeenCalled();
    });

    it('accumulates a repeated signature across heartbeats instead of resetting', async () => {
        let cursor = '';
        const batches: unknown[][] = [
            [
                {
                    tsIso: '2026-07-01T00:00:00.001Z',
                    appVersion: '2.8.0',
                    source: 'rust:tracing',
                    message: 'same failure'
                }
            ],
            [
                {
                    tsIso: '2026-07-01T00:00:00.002Z',
                    appVersion: '2.8.0',
                    source: 'rust:tracing',
                    message: 'same failure'
                }
            ]
        ];
        let call = 0;
        const appDrainClientErrorLog = vi.fn(() =>
            Promise.resolve(batches[call++] ?? [])
        );
        const getString = vi.fn(() => Promise.resolve(cursor));
        const setString = vi.fn((_key: string, value: string) => {
            cursor = value;
            return Promise.resolve();
        });
        const posted: RustErrorPayload[] = [];
        const postTelemetry = vi.fn((_path: string, payload: unknown) => {
            posted.push(
                JSON.parse(JSON.stringify(payload)) as RustErrorPayload
            );
            return Promise.resolve();
        });
        vi.doMock('@/platform/tauri/bindings', () => ({
            commands: { appDrainClientErrorLog }
        }));
        vi.doMock('@/repositories/configRepository', () => ({
            default: { getString, setString }
        }));
        vi.doMock('./telemetryConfig', () => ({
            TELEMETRY_CLIENT_ERROR_CURSOR_CONFIG_KEY:
                'telemetryClientErrorCursor',
            isAnonymousUsageTelemetryEnabled: () => true
        }));
        vi.doMock('./telemetryClient', () => ({ postTelemetry }));
        vi.doMock('./telemetryPayload', () => ({
            buildTelemetryContext: () => ({
                installId: 'install-id',
                sessionId: 'session-id',
                appVersion: '2.9.3',
                platform: 'windows'
            })
        }));
        const mod = await import('./telemetryRustErrors');
        mod.resetRustErrors();

        await mod.sendRustErrors(session);
        await mod.sendRustErrors(session);

        expect(posted[0]?.errors?.[0]?.count).toBe(1);
        expect(posted[1]?.errors).toHaveLength(1);
        expect(posted[1]?.errors?.[0]?.count).toBe(2);
    });

    it('chunks more than one payload worth of signatures without dropping any', async () => {
        const entries = Array.from({ length: 25 }, (_, index) => ({
            tsIso: `2026-07-01T00:00:00.${String(index).padStart(3, '0')}Z`,
            appVersion: '2.8.0',
            source: 'rust:tracing',
            message: `distinct failure ${index}`
        }));
        const { postTelemetry } = mockDeps({ entries });
        const mod = await import('./telemetryRustErrors');

        await mod.sendRustErrors(session);

        expect(postTelemetry).toHaveBeenCalledTimes(2);
        const totalSent = postTelemetry.mock.calls.reduce(
            (sum, [, payload]) =>
                sum + ((payload as RustErrorPayload).errors?.length ?? 0),
            0
        );
        expect(totalSent).toBe(25);
        for (const [, payload] of postTelemetry.mock.calls) {
            expect(
                (payload as RustErrorPayload).errors?.length ?? 0
            ).toBeLessThanOrEqual(20);
        }
    });
});
