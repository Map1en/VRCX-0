import { create } from 'zustand';

import type {
    AssistantChoiceRequestEvent,
    AssistantDeltaEvent,
    AssistantDoneEvent,
    AssistantErrorEvent,
    AssistantToolCallEvent,
    AssistantToolResultEvent,
    AssistantTurnEntitiesEvent,
    AssistantDraft,
    Entity,
    SessionSummary,
    UIMessage
} from '@/domain/assistant/types';
import type { Message, Session } from '@/platform/tauri/bindings';

interface AssistantChatState {
    open: boolean;
    authScopeVersion: number;
    sessions: SessionSummary[];
    activeSessionId: string | null;
    messagesBySession: Record<string, UIMessage[]>;
    surfacedEntitiesBySession: Record<string, Entity[]>;
    entityPanelOpenBySession: Record<string, boolean>;
    busySessions: Record<string, boolean>;
    assistantDraft: AssistantDraft | null;
    setOpen: (open: boolean) => void;
    startAssistantDraft: (draft: AssistantDraft) => void;
    setEntityPanelOpen: (open: boolean) => void;
    setSessions: (sessions: SessionSummary[]) => void;
    setActiveSession: (sessionId: string | null) => void;
    evictSessionData: (sessionId: string) => void;
    removeSession: (sessionId: string) => void;
    resetAssistantChatState: () => void;
    hydrateSession: (session: Session) => void;
    appendUserMessage: (sessionId: string, text: string) => void;
    dropTrailingUserMessage: (sessionId: string) => void;
    markBusy: (sessionId: string, busy: boolean) => void;
    applyDelta: (event: AssistantDeltaEvent) => void;
    applyToolCall: (event: AssistantToolCallEvent) => void;
    applyToolResult: (event: AssistantToolResultEvent) => void;
    applyChoiceRequest: (event: AssistantChoiceRequestEvent) => void;
    resolveChoice: (
        sessionId: string,
        choiceId: string,
        userId: string | null
    ) => void;
    applyTurnEntities: (event: AssistantTurnEntitiesEvent) => void;
    applyDone: (event: AssistantDoneEvent) => void;
    applyError: (event: AssistantErrorEvent) => void;
}

type AssistantChatData = Pick<
    AssistantChatState,
    | 'open'
    | 'authScopeVersion'
    | 'sessions'
    | 'activeSessionId'
    | 'messagesBySession'
    | 'surfacedEntitiesBySession'
    | 'entityPanelOpenBySession'
    | 'busySessions'
    | 'assistantDraft'
>;

const initialState: AssistantChatData = {
    open: false,
    authScopeVersion: 0,
    sessions: [],
    activeSessionId: null,
    messagesBySession: {},
    surfacedEntitiesBySession: {},
    entityPanelOpenBySession: {},
    busySessions: {},
    assistantDraft: null
};

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

// Persisted tool rows belong to the assistant reply that follows them; a run
// that ended before its reply (cancel/error) still shows its tool cards.
function foldTranscript(messages: Message[], running: boolean): UIMessage[] {
    const folded: UIMessage[] = [];
    let pending: UIMessage | null = null;
    const settle = (message: UIMessage): UIMessage => ({
        ...message,
        toolCalls: message.toolCalls.map((call) =>
            call.status === 'pending' && !running
                ? { ...call, status: 'error' }
                : call
        )
    });
    for (const message of messages) {
        switch (message.role) {
            case 'user':
                if (pending) {
                    folded.push(settle(pending));
                    pending = null;
                }
                folded.push({
                    id: message.id,
                    role: 'user',
                    text: message.content,
                    streaming: false,
                    toolCalls: []
                });
                break;
            case 'assistant':
                folded.push(
                    settle({
                        id: message.id,
                        role: 'assistant',
                        text: message.content,
                        streaming: false,
                        toolCalls: pending?.toolCalls ?? []
                    })
                );
                pending = null;
                break;
            case 'tool_call':
                if (!message.toolCall) {
                    break;
                }
                pending ??= {
                    id: message.id,
                    role: 'assistant',
                    text: '',
                    streaming: false,
                    toolCalls: []
                };
                pending.toolCalls.push({
                    id: message.toolCall.id,
                    name: message.toolCall.name,
                    args: message.toolCall.arguments,
                    status: 'pending',
                    summary: '',
                    entities: [],
                    charts: []
                });
                break;
            case 'tool_result': {
                const result = message.toolResult;
                if (!result || !pending) {
                    break;
                }
                pending.toolCalls = pending.toolCalls.map((call) =>
                    call.id === result.toolCallId
                        ? {
                              ...call,
                              status: result.ok ? 'done' : 'error',
                              summary: result.summary,
                              entities: result.entities,
                              charts: result.charts ?? [],
                              screenshots: result.screenshots
                          }
                        : call
                );
                break;
            }
        }
    }
    if (pending) {
        folded.push(settle(pending));
    }
    return folded;
}

function removeSessionEntry<T>(
    entries: Record<string, T>,
    sessionId: string
): Record<string, T> {
    const next = { ...entries };
    delete next[sessionId];
    return next;
}

function retainSessionEntries<T>(
    entries: Record<string, T>,
    sessionIds: Set<string>
): Record<string, T> {
    return Object.fromEntries(
        Object.entries(entries).filter(([sessionId]) =>
            sessionIds.has(sessionId)
        )
    );
}

function getBusySessionIds(state: AssistantChatState): Set<string> {
    const sessionIds = new Set(
        state.sessions
            .filter((session) => session.busy)
            .map((session) => session.id)
    );
    for (const [sessionId, busy] of Object.entries(state.busySessions)) {
        if (busy) {
            sessionIds.add(sessionId);
        }
    }
    return sessionIds;
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
    ...initialState,

    startAssistantDraft: (draft) =>
        set({ open: true, activeSessionId: null, assistantDraft: draft }),

    setOpen: (open) =>
        set((state) => {
            if (open) {
                return { open: true };
            }
            const busySessionIds = getBusySessionIds(state);
            return {
                open: false,
                messagesBySession: retainSessionEntries(
                    state.messagesBySession,
                    busySessionIds
                ),
                surfacedEntitiesBySession: retainSessionEntries(
                    state.surfacedEntitiesBySession,
                    busySessionIds
                ),
                entityPanelOpenBySession: retainSessionEntries(
                    state.entityPanelOpenBySession,
                    busySessionIds
                ),
                busySessions: retainSessionEntries(
                    state.busySessions,
                    busySessionIds
                )
            };
        }),
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
    setActiveSession: (activeSessionId) =>
        set({ activeSessionId, assistantDraft: null }),
    evictSessionData: (sessionId) =>
        set((state) => {
            if (getBusySessionIds(state).has(sessionId)) {
                return {};
            }
            return {
                messagesBySession: removeSessionEntry(
                    state.messagesBySession,
                    sessionId
                ),
                surfacedEntitiesBySession: removeSessionEntry(
                    state.surfacedEntitiesBySession,
                    sessionId
                ),
                entityPanelOpenBySession: removeSessionEntry(
                    state.entityPanelOpenBySession,
                    sessionId
                ),
                busySessions: removeSessionEntry(state.busySessions, sessionId)
            };
        }),
    removeSession: (sessionId) =>
        set((state) => ({
            sessions: state.sessions.filter(
                (session) => session.id !== sessionId
            ),
            activeSessionId:
                state.activeSessionId === sessionId
                    ? null
                    : state.activeSessionId,
            messagesBySession: removeSessionEntry(
                state.messagesBySession,
                sessionId
            ),
            surfacedEntitiesBySession: removeSessionEntry(
                state.surfacedEntitiesBySession,
                sessionId
            ),
            entityPanelOpenBySession: removeSessionEntry(
                state.entityPanelOpenBySession,
                sessionId
            ),
            busySessions: removeSessionEntry(state.busySessions, sessionId)
        })),
    resetAssistantChatState: () =>
        set((state) => ({
            ...initialState,
            authScopeVersion: state.authScopeVersion + 1
        })),

    hydrateSession: (session) =>
        set((state) => ({
            messagesBySession: {
                ...state.messagesBySession,
                [session.id]: foldTranscript(
                    session.messages,
                    session.activeTurn?.status === 'running'
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
                    message.text = event.replace
                        ? event.text
                        : message.text + event.text;
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
                            entities: [],
                            charts: []
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
                                  entities: event.entities,
                                  charts: event.charts,
                                  screenshots: event.screenshots
                              }
                            : call
                    );
                    return message;
                })
            )
        ),

    applyChoiceRequest: (event) =>
        set((state) =>
            updateMessages(state, event.sessionId, (messages) =>
                withAssistantMessage(messages, event.turnId, (message) => {
                    message.choices = [
                        ...(message.choices ?? []),
                        {
                            id: event.choiceId,
                            sessionId: event.sessionId,
                            query: event.query,
                            candidates: event.candidates,
                            status: 'pending'
                        }
                    ];
                    return message;
                })
            )
        ),

    resolveChoice: (sessionId, choiceId, userId) =>
        set((state) =>
            updateMessages(state, sessionId, (messages) =>
                messages.map((message) =>
                    message.choices?.some((choice) => choice.id === choiceId)
                        ? {
                              ...message,
                              choices: message.choices.map((choice) =>
                                  choice.id === choiceId
                                      ? {
                                            ...choice,
                                            status: userId
                                                ? 'picked'
                                                : 'skipped',
                                            pickedUserId: userId ?? undefined
                                        }
                                      : choice
                              )
                          }
                        : message
                )
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
