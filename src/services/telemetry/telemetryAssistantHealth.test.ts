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
                'includeNonFriends=true, limit=3, nested=<object>, query=<text>; result=error'
        });
    });

    it('classifies assistant tool result summaries without sending result text', async () => {
        const { appTelemetryRecordEvent } = mockTelemetryCommand();
        const mod = await import('./telemetryAssistantHealth');

        mod.recordAssistantToolError({
            source: 'search_worlds_visited',
            summary: 'request timed out after 30s'
        });
        mod.recordAssistantToolError({
            source: 'get_friend_profile',
            summary: 'No local-history user matched "Alice"'
        });
        mod.recordAssistantToolError({
            source: 'get_copresence_summary',
            summary: 'invalid arguments: limit must be positive'
        });
        mod.recordAssistantToolError({
            source: 'get_friend_log',
            summary: 'sqlite database is unavailable'
        });
        mod.recordAssistantToolError({
            source: 'find_user',
            summary: 'missing field `name`'
        });
        mod.recordAssistantToolError({
            source: 'get_best_time_to_playget_best_time_to_play',
            summary: 'tool error: method not found'
        });
        mod.recordAssistantToolError({
            source: 'get_activity_timeline',
            summary:
                'This tool requires an active realtime VRChat session (current user unknown).'
        });
        mod.recordAssistantToolError({
            source: 'search_friend_feed',
            summary: 'search_friend_feed requires query or target'
        });

        expect(appTelemetryRecordEvent).toHaveBeenNthCalledWith(1, {
            type: 'assistantToolError',
            source: 'search_worlds_visited',
            summary: 'result=timeout'
        });
        expect(appTelemetryRecordEvent).toHaveBeenNthCalledWith(2, {
            type: 'assistantToolError',
            source: 'get_friend_profile',
            summary: 'result=not_found'
        });
        expect(appTelemetryRecordEvent).toHaveBeenNthCalledWith(3, {
            type: 'assistantToolError',
            source: 'get_copresence_summary',
            summary: 'result=invalid_args'
        });
        expect(appTelemetryRecordEvent).toHaveBeenNthCalledWith(4, {
            type: 'assistantToolError',
            source: 'get_friend_log',
            summary: 'result=db_error'
        });
        expect(appTelemetryRecordEvent).toHaveBeenNthCalledWith(5, {
            type: 'assistantToolError',
            source: 'find_user',
            summary: 'result=invalid_args'
        });
        expect(appTelemetryRecordEvent).toHaveBeenNthCalledWith(6, {
            type: 'assistantToolError',
            source: 'get_best_time_to_playget_best_time_to_play',
            summary: 'result=invalid_tool'
        });
        expect(appTelemetryRecordEvent).toHaveBeenNthCalledWith(7, {
            type: 'assistantToolError',
            source: 'get_activity_timeline',
            summary: 'result=precondition'
        });
        expect(appTelemetryRecordEvent).toHaveBeenNthCalledWith(8, {
            type: 'assistantToolError',
            source: 'search_friend_feed',
            summary: 'result=invalid_args'
        });
    });

    it('keeps safe bucket values in tool diagnostics', async () => {
        const { appTelemetryRecordEvent } = mockTelemetryCommand();
        const mod = await import('./telemetryAssistantHealth');

        mod.recordAssistantToolError({
            source: 'get_activity_timeline',
            args: JSON.stringify({ bucket: 'day', utcOffsetMinutes: 600 }),
            summary: 'unknown variant `day`'
        });

        expect(appTelemetryRecordEvent).toHaveBeenCalledWith({
            type: 'assistantToolError',
            source: 'get_activity_timeline',
            summary: 'bucket=day, utcOffsetMinutes=600; result=invalid_args'
        });
    });

    it('classifies time window parser failures as invalid arguments', async () => {
        const { appTelemetryRecordEvent } = mockTelemetryCommand();
        const mod = await import('./telemetryAssistantHealth');

        mod.recordAssistantToolError({
            source: 'get_copresence_summary',
            summary:
                'timeWindow must be a relative string or an object with from/to bounds'
        });
        mod.recordAssistantToolError({
            source: 'get_copresence_summary',
            summary: "unrecognized timeWindow string 'the year 2026'"
        });
        mod.recordAssistantToolError({
            source: 'get_copresence_summary',
            summary: 'timeWindow calendar year must be between 1000 and 9998'
        });

        expect(appTelemetryRecordEvent).toHaveBeenNthCalledWith(1, {
            type: 'assistantToolError',
            source: 'get_copresence_summary',
            summary: 'result=invalid_args'
        });
        expect(appTelemetryRecordEvent).toHaveBeenNthCalledWith(2, {
            type: 'assistantToolError',
            source: 'get_copresence_summary',
            summary: 'result=invalid_args'
        });
        expect(appTelemetryRecordEvent).toHaveBeenNthCalledWith(3, {
            type: 'assistantToolError',
            source: 'get_copresence_summary',
            summary: 'result=invalid_args'
        });
    });

    it('separates truncated responses from malformed tool arguments', async () => {
        const { appTelemetryRecordEvent } = mockTelemetryCommand();
        const mod = await import('./telemetryAssistantHealth');

        mod.recordAssistantToolError({
            source: 'get_activity_timeline',
            args: '{"bucket":"mon',
            summary:
                'tool error: tool `get_activity_timeline` was not run: the response hit the output token limit, so its arguments may be cut off. Re-issue the call with complete arguments.'
        });
        mod.recordAssistantToolError({
            source: 'get_activity_timeline',
            args: "{bucket: 'month', note: 'timeout'}",
            summary:
                "tool error: tool `get_activity_timeline` was not run: its arguments are not a valid JSON object (key must be a string at line 1 column 2). Received arguments: {bucket: 'month', note: 'timeout'}. Re-issue the call with a valid JSON object."
        });

        expect(appTelemetryRecordEvent).toHaveBeenNthCalledWith(1, {
            type: 'assistantToolError',
            source: 'get_activity_timeline',
            summary: 'args=<text>; result=truncated'
        });
        expect(appTelemetryRecordEvent).toHaveBeenNthCalledWith(2, {
            type: 'assistantToolError',
            source: 'get_activity_timeline',
            summary: 'args=<text>; result=malformed_args'
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
