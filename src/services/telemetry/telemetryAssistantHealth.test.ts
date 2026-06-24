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

type AssistantPayload = {
    toolErrors: number;
    turnErrors: number;
    details?: Array<{
        kind: string;
        source?: string;
        code?: string;
        summary?: string;
        count: number;
    }>;
};

describe('assistant health telemetry', () => {
    it('reports assistant error details without raw sensitive values', async () => {
        const { postTelemetry } = mockDeps({ anonymous: true });
        const mod = await import('./telemetryAssistantHealth');

        mod.recordAssistantToolError('read_user_note');
        mod.recordAssistantTurnError(
            'provider_error',
            'Provider failed for usr_123 at https://example.com/chat'
        );
        await mod.sendAssistantHealth(session);

        const [path, payload] = postTelemetry.mock.calls[0] as [
            string,
            AssistantPayload
        ];
        expect(path).toBe('/api/v1/telemetry/assistant-health');
        expect(payload.toolErrors).toBe(1);
        expect(payload.turnErrors).toBe(1);
        expect(payload.details).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    kind: 'tool_error',
                    source: 'read_user_note',
                    count: 1
                }),
                expect.objectContaining({
                    kind: 'turn_error',
                    code: 'provider_error',
                    count: 1
                })
            ])
        );
        const turnDetail = payload.details?.find(
            (detail) => detail.kind === 'turn_error'
        );
        expect(turnDetail?.summary).toContain('<id>');
        expect(turnDetail?.summary).toContain('<url>');
        expect(turnDetail?.summary).not.toContain('usr_123');
        expect(turnDetail?.summary).not.toContain('example.com');
    });

    it('does not send when anonymous usage telemetry is off', async () => {
        const { postTelemetry } = mockDeps({ anonymous: false });
        const mod = await import('./telemetryAssistantHealth');
        mod.recordAssistantToolError('read_user_note');
        await mod.sendAssistantHealth(session);
        expect(postTelemetry).not.toHaveBeenCalled();
    });
});
