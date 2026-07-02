import { create } from 'zustand';

import type {
    AssistantDeltaEvent,
    AssistantDoneEvent,
    AssistantErrorEvent,
    AssistantToolCallEvent,
    AssistantToolResultEvent,
    AssistantTurnEntitiesEvent,
    Entity,
    SessionSummary,
    UIMessage
} from '@/features/assistant/assistantTypes';
import type { Session } from '@/platform/tauri/bindings';

interface AssistantChatState {
    open: boolean;
    sessions: SessionSummary[];
    activeSessionId: string | null;
    messagesBySession: Record<string, UIMessage[]>;
    surfacedEntitiesBySession: Record<string, Entity[]>;
    entityPanelOpenBySession: Record<string, boolean>;
    busySessions: Record<string, boolean>;
    setOpen: (open: boolean) => void;
    setEntityPanelOpen: (open: boolean) => void;
    setSessions: (sessions: SessionSummary[]) => void;
    setActiveSession: (sessionId: string | null) => void;
    hydrateSession: (session: Session) => void;
    appendUserMessage: (sessionId: string, text: string) => void;
    dropTrailingUserMessage: (sessionId: string) => void;
    markBusy: (sessionId: string, busy: boolean) => void;
    applyDelta: (event: AssistantDeltaEvent) => void;
    applyToolCall: (event: AssistantToolCallEvent) => void;
    applyToolResult: (event: AssistantToolResultEvent) => void;
    applyTurnEntities: (event: AssistantTurnEntitiesEvent) => void;
    applyDone: (event: AssistantDoneEvent) => void;
    applyError: (event: AssistantErrorEvent) => void;
}

function markSessionIdle(
    sessions: SessionSummary[],
    sessionId: string
): SessionSummary[] {
    return sessions.map((session) =>
        session.id === sessionId ? { ...session, busy: false } : session
    );
}

function randomId(prefix: string): string {
    return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function updateMessages(
    state: AssistantChatState,
    sessionId: string,
    updater: (messages: UIMessage[]) => UIMessage[]
): Partial<AssistantChatState> {
    const current = state.messagesBySession[sessionId] ?? [];
    return {
        messagesBySession: {
            ...state.messagesBySession,
            [sessionId]: updater([...current])
        }
    };
}

// `messages` is the fresh copy produced by updateMessages, so the streaming
// slot can be replaced in place instead of re-mapping the whole array per token.
function withAssistantMessage(
    messages: UIMessage[],
    turnId: string,
    mutate: (message: UIMessage) => UIMessage
): UIMessage[] {
    const index = messages.findIndex(
        (message) => message.role === 'assistant' && message.turnId === turnId
    );
    if (index === -1) {
        messages.push(
            mutate({
                id: randomId('asst'),
                role: 'assistant',
                text: '',
                turnId,
                streaming: true,
                toolCalls: []
            })
        );
        return messages;
    }
    messages[index] = mutate({ ...messages[index] });
    return messages;
}

export const useAssistantChatStore = create<AssistantChatState>((set) => ({
    open: false,
    sessions: [],
    activeSessionId: null,
    messagesBySession: {},
    surfacedEntitiesBySession: {},
    entityPanelOpenBySession: {},
    busySessions: {},

    setOpen: (open) => set({ open }),
    // Entity panel open/closed is remembered per session: switching restores the
    // panel state and contents of the session being opened, never wiping them.
    setEntityPanelOpen: (open) =>
        set((state) =>
            state.activeSessionId
                ? {
                      entityPanelOpenBySession: {
                          ...state.entityPanelOpenBySession,
                          [state.activeSessionId]: open
                      }
                  }
                : {}
        ),
    setSessions: (sessions) => set({ sessions }),
    setActiveSession: (activeSessionId) => set({ activeSessionId }),

    hydrateSession: (session) =>
        set((state) => ({
            messagesBySession: {
                ...state.messagesBySession,
                [session.id]: session.messages.map(
                    (message): UIMessage => ({
                        id: message.id,
                        role: message.role,
                        text: message.content,
                        streaming: false,
                        toolCalls: []
                    })
                )
            },
            // Restore the persisted right-panel state for this session.
            entityPanelOpenBySession: {
                ...state.entityPanelOpenBySession,
                [session.id]: session.entityPanelOpen
            },
            surfacedEntitiesBySession: {
                ...state.surfacedEntitiesBySession,
                [session.id]: session.surfacedEntities
            }
        })),

    appendUserMessage: (sessionId, text) =>
        set((state) =>
            updateMessages(state, sessionId, (messages) => {
                messages.push({
                    id: randomId('user'),
                    role: 'user',
                    text,
                    streaming: false,
                    toolCalls: []
                });
                return messages;
            })
        ),

    dropTrailingUserMessage: (sessionId) =>
        set((state) =>
            updateMessages(state, sessionId, (messages) => {
                if (messages[messages.length - 1]?.role === 'user') {
                    messages.pop();
                }
                return messages;
            })
        ),

    markBusy: (sessionId, busy) =>
        set((state) => ({
            busySessions: { ...state.busySessions, [sessionId]: busy }
        })),

    applyDelta: (event) =>
        set((state) =>
            updateMessages(state, event.sessionId, (messages) =>
                withAssistantMessage(messages, event.turnId, (message) => {
                    message.text += event.text;
                    message.streaming = true;
                    return message;
                })
            )
        ),

    applyToolCall: (event) =>
        set((state) =>
            updateMessages(state, event.sessionId, (messages) =>
                withAssistantMessage(messages, event.turnId, (message) => {
                    message.toolCalls = [
                        ...message.toolCalls,
                        {
                            id: event.toolCallId,
                            name: event.name,
                            args: event.args,
                            status: 'pending',
                            summary: '',
                            entities: []
                        }
                    ];
                    return message;
                })
            )
        ),

    applyToolResult: (event) =>
        set((state) =>
            updateMessages(state, event.sessionId, (messages) =>
                withAssistantMessage(messages, event.turnId, (message) => {
                    message.toolCalls = message.toolCalls.map((call) =>
                        call.id === event.toolCallId
                            ? {
                                  ...call,
                                  status: event.ok ? 'done' : 'error',
                                  summary: event.summary,
                                  entities: event.entities
                              }
                            : call
                    );
                    return message;
                })
            )
        ),

    applyTurnEntities: (event) =>
        set((state) => ({
            surfacedEntitiesBySession: {
                ...state.surfacedEntitiesBySession,
                [event.sessionId]: event.entities
            },
            // Auto-open this session's panel when it surfaces entities, but never
            // force-close it — respect a manual toggle on an empty turn.
            entityPanelOpenBySession:
                event.entities.length > 0
                    ? {
                          ...state.entityPanelOpenBySession,
                          [event.sessionId]: true
                      }
                    : state.entityPanelOpenBySession
        })),

    applyDone: (event) =>
        set((state) => ({
            ...updateMessages(state, event.sessionId, (messages) =>
                withAssistantMessage(messages, event.turnId, (message) => {
                    message.streaming = false;
                    return message;
                })
            ),
            busySessions: { ...state.busySessions, [event.sessionId]: false },
            sessions: markSessionIdle(state.sessions, event.sessionId)
        })),

    applyError: (event) =>
        set((state) => ({
            ...updateMessages(state, event.sessionId, (messages) =>
                withAssistantMessage(messages, event.turnId, (message) => {
                    message.streaming = false;
                    message.error = event.message;
                    return message;
                })
            ),
            busySessions: { ...state.busySessions, [event.sessionId]: false },
            sessions: markSessionIdle(state.sessions, event.sessionId)
        }))
}));
