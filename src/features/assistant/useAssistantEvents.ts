import { useEffect } from 'react';

import { tauriClient } from '@/platform/tauri/client';
import {
    recordAssistantToolError,
    recordAssistantTurnError
} from '@/services/telemetry/telemetryAssistantHealth';
import { useAssistantChatStore } from '@/state/assistantChatStore';

import type {
    AssistantDeltaEvent,
    AssistantDoneEvent,
    AssistantErrorEvent,
    AssistantToolCallEvent,
    AssistantToolResultEvent,
    AssistantTurnEntitiesEvent
} from './assistantTypes';

const EVENT_NAMES = [
    'assistantDelta',
    'assistantToolCall',
    'assistantToolResult',
    'assistantTurnEntities',
    'assistantDone',
    'assistantError'
] as const;

export function useAssistantEvents(): void {
    useEffect(() => {
        const store = useAssistantChatStore.getState();
        const unsubscribers: Array<() => void> = [];
        let active = true;

        // Coalesce per-token deltas into one store commit per animation frame.
        // A fast model streams 20-60 tokens/sec; without this each token would
        // trigger a full store update + markdown re-parse + re-render.
        const pendingDeltas = new Map<string, AssistantDeltaEvent>();
        const toolNamesById = new Map<string, string>();
        let rafHandle = 0;
        const flushDeltas = () => {
            rafHandle = 0;
            for (const event of pendingDeltas.values()) {
                store.applyDelta(event);
            }
            pendingDeltas.clear();
        };
        const flushNow = () => {
            if (rafHandle) {
                cancelAnimationFrame(rafHandle);
            }
            flushDeltas();
        };

        const handlers: Record<string, (payload: unknown) => void> = {
            assistantDelta: (payload) => {
                const event = payload as AssistantDeltaEvent;
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
            assistantToolCall: (payload) => {
                flushNow();
                const event = payload as AssistantToolCallEvent;
                toolNamesById.set(event.toolCallId, event.name);
                store.applyToolCall(event);
            },
            assistantToolResult: (payload) => {
                flushNow();
                const event = payload as AssistantToolResultEvent;
                store.applyToolResult(event);
                if (!event.ok) {
                    recordAssistantToolError(toolNamesById.get(event.toolCallId));
                }
                toolNamesById.delete(event.toolCallId);
            },
            assistantTurnEntities: (payload) =>
                store.applyTurnEntities(payload as AssistantTurnEntitiesEvent),
            assistantDone: (payload) => {
                flushNow();
                store.applyDone(payload as AssistantDoneEvent);
            },
            assistantError: (payload) => {
                flushNow();
                const event = payload as AssistantErrorEvent;
                store.applyError(event);
                recordAssistantTurnError(event.code, event.message);
            }
        };

        for (const name of EVENT_NAMES) {
            tauriClient.events
                .subscribe<unknown>(name, handlers[name])
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
            toolNamesById.clear();
        };
    }, []);
}
