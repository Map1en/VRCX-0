import { useEffect } from 'react';

import type {
    AssistantChoiceRequestEvent,
    AssistantDeltaEvent,
    AssistantDoneEvent,
    AssistantErrorEvent,
    AssistantToolCallEvent,
    AssistantToolResultEvent,
    AssistantTurnEntitiesEvent
} from '@/platform/tauri/bindings';
import { tauriClient } from '@/platform/tauri/client';
import {
    recordAssistantToolError,
    recordAssistantTurnError
} from '@/services/telemetry/telemetryAssistantHealth';
import { useAssistantChatStore } from '@/state/assistantChatStore';
import { useRuntimeStore } from '@/state/runtimeStore';

function isCurrentAccountEvent(event: {
    ownerUserId: string;
    sessionId: string;
}): boolean {
    if (
        !event.ownerUserId ||
        event.ownerUserId !== useRuntimeStore.getState().auth.currentUserId
    ) {
        return false;
    }
    const state = useAssistantChatStore.getState();
    return (
        state.open ||
        Boolean(state.busySessions[event.sessionId]) ||
        state.sessions.some(
            (session) => session.id === event.sessionId && session.busy
        )
    );
}

export function useAssistantEvents(): void {
    useEffect(() => {
        const store = useAssistantChatStore.getState();
        const unsubscribers: Array<() => void> = [];
        let active = true;

        // Coalesce per-token deltas into one store commit per animation frame.
        // A fast model streams 20-60 tokens/sec; without this each token would
        // trigger a full store update + markdown re-parse + re-render.
        const pendingDeltas = new Map<string, AssistantDeltaEvent>();
        const toolCallsById = new Map<
            string,
            Pick<AssistantToolCallEvent, 'name' | 'args'>
        >();
        let rafHandle = 0;
        const flushDeltas = () => {
            rafHandle = 0;
            for (const event of pendingDeltas.values()) {
                if (isCurrentAccountEvent(event)) {
                    store.applyDelta(event);
                }
            }
            pendingDeltas.clear();
        };
        const flushNow = () => {
            if (rafHandle) {
                cancelAnimationFrame(rafHandle);
            }
            flushDeltas();
        };
        const clearBufferedEvents = () => {
            if (rafHandle) {
                cancelAnimationFrame(rafHandle);
                rafHandle = 0;
            }
            pendingDeltas.clear();
            toolCallsById.clear();
        };
        const evictFinishedSessionIfClosed = (sessionId: string) => {
            const current = useAssistantChatStore.getState();
            if (!current.open) {
                current.evictSessionData(sessionId);
            }
        };

        const handlers = {
            assistantDelta: (event: AssistantDeltaEvent) => {
                if (!isCurrentAccountEvent(event)) {
                    return;
                }
                if (event.replace) {
                    flushNow();
                    store.applyDelta(event);
                    return;
                }
                const buffered = pendingDeltas.get(event.turnId);
                if (buffered) {
                    buffered.text += event.text;
                } else {
                    pendingDeltas.set(event.turnId, { ...event });
                }
                if (!rafHandle) {
                    rafHandle = requestAnimationFrame(flushDeltas);
                }
            },
            assistantToolCall: (event: AssistantToolCallEvent) => {
                if (!isCurrentAccountEvent(event)) {
                    return;
                }
                flushNow();
                toolCallsById.set(event.toolCallId, {
                    name: event.name,
                    args: event.args
                });
                store.applyToolCall(event);
            },
            assistantToolResult: (event: AssistantToolResultEvent) => {
                if (!isCurrentAccountEvent(event)) {
                    return;
                }
                flushNow();
                store.applyToolResult(event);
                if (!event.ok) {
                    const tool = toolCallsById.get(event.toolCallId);
                    recordAssistantToolError({
                        source: tool?.name,
                        args: tool?.args,
                        summary: event.summary
                    });
                }
                toolCallsById.delete(event.toolCallId);
            },
            assistantChoiceRequest: (event: AssistantChoiceRequestEvent) => {
                if (isCurrentAccountEvent(event)) {
                    flushNow();
                    store.applyChoiceRequest(event);
                }
            },
            assistantTurnEntities: (event: AssistantTurnEntitiesEvent) => {
                if (isCurrentAccountEvent(event)) {
                    store.applyTurnEntities(event);
                }
            },
            assistantDone: (event: AssistantDoneEvent) => {
                if (isCurrentAccountEvent(event)) {
                    flushNow();
                    store.applyDone(event);
                    evictFinishedSessionIfClosed(event.sessionId);
                }
            },
            assistantError: (event: AssistantErrorEvent) => {
                if (!isCurrentAccountEvent(event)) {
                    return;
                }
                flushNow();
                store.applyError(event);
                recordAssistantTurnError(event.code, event.message);
                evictFinishedSessionIfClosed(event.sessionId);
            }
        };

        const unsubscribeAuth = useRuntimeStore.subscribe(
            (state, previousState) => {
                if (
                    state.auth.currentUserId ===
                    previousState.auth.currentUserId
                ) {
                    return;
                }
                clearBufferedEvents();
            }
        );
        const unsubscribeAssistantScope = useAssistantChatStore.subscribe(
            (state, previousState) => {
                if (state.authScopeVersion !== previousState.authScopeVersion) {
                    clearBufferedEvents();
                }
            }
        );

        const subscriptions = [
            tauriClient.events.subscribe(
                'assistantDelta',
                handlers.assistantDelta
            ),
            tauriClient.events.subscribe(
                'assistantToolCall',
                handlers.assistantToolCall
            ),
            tauriClient.events.subscribe(
                'assistantToolResult',
                handlers.assistantToolResult
            ),
            tauriClient.events.subscribe(
                'assistantChoiceRequest',
                handlers.assistantChoiceRequest
            ),
            tauriClient.events.subscribe(
                'assistantTurnEntities',
                handlers.assistantTurnEntities
            ),
            tauriClient.events.subscribe(
                'assistantDone',
                handlers.assistantDone
            ),
            tauriClient.events.subscribe(
                'assistantError',
                handlers.assistantError
            )
        ];
        for (const subscription of subscriptions) {
            subscription
                .then((unsubscribe) => {
                    if (active) {
                        unsubscribers.push(unsubscribe);
                    } else {
                        unsubscribe();
                    }
                })
                .catch(() => {});
        }

        return () => {
            active = false;
            if (rafHandle) {
                cancelAnimationFrame(rafHandle);
            }
            for (const unsubscribe of unsubscribers) {
                unsubscribe();
            }
            unsubscribeAuth();
            unsubscribeAssistantScope();
            toolCallsById.clear();
        };
    }, []);
}
