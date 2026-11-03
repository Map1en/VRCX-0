import { beforeEach, describe, expect, it } from 'vitest';

import type { AssistantChart } from '@/domain/assistant/types';

import { useAssistantChatStore } from './assistantChatStore';

const CHART: AssistantChart = {
    kind: 'topCompanions',
    axis: 'label',
    points: [{ key: 'Alice', value: 120 }]
};

describe('assistantChatStore', () => {
    beforeEach(() => {
        useAssistantChatStore.getState().resetAssistantChatState();
    });

    it('replaces streamed draft text with the canonical final answer', () => {
        const store = useAssistantChatStore.getState();
        store.applyDelta({
            ownerUserId: 'usr_self',
            sessionId: 'session-1',
            turnId: 'turn-1',
            text: '| 1 | [Friend Name 1] | [Time Minutes] |',
            replace: false
        });
        store.applyDelta({
            ownerUserId: 'usr_self',
            sessionId: 'session-1',
            turnId: 'turn-1',
            text: 'Alice has the most mutual connections.',
            replace: true
        });

        expect(
            useAssistantChatStore.getState().messagesBySession['session-1']
        ).toMatchObject([
            {
                text: 'Alice has the most mutual connections.',
                streaming: true
            }
        ]);
    });

    it('evicts completed session data when the dialog closes and keeps active turns', () => {
        useAssistantChatStore.setState({
            open: true,
            activeSessionId: 'session-completed',
            sessions: [
                {
                    id: 'session-completed',
                    title: 'Completed',
                    pinned: false,
                    busy: false,
                    updatedAt: '2026-08-11T00:00:00Z'
                },
                {
                    id: 'session-running',
                    title: 'Running',
                    pinned: false,
                    busy: true,
                    updatedAt: '2026-08-11T00:00:00Z'
                }
            ],
            messagesBySession: {
                'session-completed': [],
                'session-running': []
            },
            surfacedEntitiesBySession: {
                'session-completed': [],
                'session-running': []
            },
            entityPanelOpenBySession: {
                'session-completed': true,
                'session-running': true
            },
            busySessions: {
                'session-completed': false,
                'session-running': true
            }
        });

        useAssistantChatStore.getState().setOpen(false);

        const state = useAssistantChatStore.getState();
        expect(state).toMatchObject({
            open: false,
            activeSessionId: 'session-completed'
        });
        expect(state.messagesBySession).toEqual({ 'session-running': [] });
        expect(state.surfacedEntitiesBySession).toEqual({
            'session-running': []
        });
        expect(state.entityPanelOpenBySession).toEqual({
            'session-running': true
        });
        expect(state.busySessions).toEqual({ 'session-running': true });
    });

    it('removes every mirror owned by a deleted session', () => {
        useAssistantChatStore.setState({
            activeSessionId: 'session-1',
            sessions: [
                {
                    id: 'session-1',
                    title: 'First',
                    pinned: false,
                    busy: false,
                    updatedAt: '2026-08-11T00:00:00Z'
                },
                {
                    id: 'session-2',
                    title: 'Second',
                    pinned: false,
                    busy: false,
                    updatedAt: '2026-08-11T00:00:00Z'
                }
            ],
            messagesBySession: {
                'session-1': [],
                'session-2': []
            },
            surfacedEntitiesBySession: {
                'session-1': [],
                'session-2': []
            },
            entityPanelOpenBySession: {
                'session-1': true,
                'session-2': false
            },
            busySessions: {
                'session-1': false,
                'session-2': false
            }
        });

        useAssistantChatStore.getState().removeSession('session-1');

        const state = useAssistantChatStore.getState();
        expect(state).toMatchObject({
            activeSessionId: null,
            sessions: [
                {
                    id: 'session-2'
                }
            ]
        });
        expect(state.messagesBySession).toEqual({ 'session-2': [] });
        expect(state.surfacedEntitiesBySession).toEqual({ 'session-2': [] });
        expect(state.entityPanelOpenBySession).toEqual({ 'session-2': false });
        expect(state.busySessions).toEqual({ 'session-2': false });
    });

    it('folds persisted tool rows into the assistant reply that follows them', () => {
        const store = useAssistantChatStore.getState();
        store.hydrateSession({
            id: 'session-1',
            title: 'Alice',
            messages: [
                {
                    id: 'm1',
                    seq: 1,
                    role: 'user',
                    content: 'who do I play with?',
                    createdAt: '2026-09-23T00:00:00Z',
                    toolCall: null,
                    toolResult: null
                },
                {
                    id: 'm2',
                    seq: 2,
                    role: 'tool_call',
                    content: '',
                    createdAt: '2026-09-23T00:00:01Z',
                    toolCall: {
                        id: 'call_1',
                        name: 'get_copresence_summary',
                        arguments: '{"limit":5}'
                    },
                    toolResult: null
                },
                {
                    id: 'm3',
                    seq: 3,
                    role: 'tool_result',
                    content: '',
                    createdAt: '2026-09-23T00:00:02Z',
                    toolCall: null,
                    toolResult: {
                        toolCallId: 'call_1',
                        name: 'get_copresence_summary',
                        ok: true,
                        summary: 'Alice tops the list.',
                        entities: [
                            {
                                kind: 'user',
                                id: 'usr_alice',
                                displayName: 'Alice'
                            }
                        ],
                        charts: [CHART]
                    }
                },
                {
                    id: 'm4',
                    seq: 4,
                    role: 'assistant',
                    content: 'Alice, mostly.',
                    createdAt: '2026-09-23T00:00:03Z',
                    toolCall: null,
                    toolResult: null
                },
                {
                    id: 'm5',
                    seq: 5,
                    role: 'user',
                    content: 'and last week?',
                    createdAt: '2026-09-23T00:00:04Z',
                    toolCall: null,
                    toolResult: null
                },
                {
                    id: 'm6',
                    seq: 6,
                    role: 'tool_call',
                    content: '',
                    createdAt: '2026-09-23T00:00:05Z',
                    toolCall: {
                        id: 'call_2',
                        name: 'get_copresence_summary',
                        arguments: '{"timeWindow":"last week"}'
                    },
                    toolResult: null
                }
            ],
            activeTurn: null,
            endpointId: null,
            model: null,
            allowWrites: false,
            playbookMode: 'auto',
            entityPanelOpen: false,
            surfacedEntities: [],
            createdAt: '2026-09-23T00:00:00Z',
            updatedAt: '2026-09-23T00:00:05Z'
        });

        expect(
            useAssistantChatStore.getState().messagesBySession['session-1']
        ).toEqual([
            {
                id: 'm1',
                role: 'user',
                text: 'who do I play with?',
                streaming: false,
                toolCalls: []
            },
            {
                id: 'm4',
                role: 'assistant',
                text: 'Alice, mostly.',
                streaming: false,
                toolCalls: [
                    {
                        id: 'call_1',
                        name: 'get_copresence_summary',
                        args: '{"limit":5}',
                        status: 'done',
                        summary: 'Alice tops the list.',
                        entities: [
                            {
                                kind: 'user',
                                id: 'usr_alice',
                                displayName: 'Alice'
                            }
                        ],
                        charts: [CHART]
                    }
                ]
            },
            {
                id: 'm5',
                role: 'user',
                text: 'and last week?',
                streaming: false,
                toolCalls: []
            },
            {
                id: 'm6',
                role: 'assistant',
                text: '',
                streaming: false,
                toolCalls: [
                    {
                        id: 'call_2',
                        name: 'get_copresence_summary',
                        args: '{"timeWindow":"last week"}',
                        status: 'error',
                        summary: '',
                        entities: [],
                        charts: []
                    }
                ]
            }
        ]);
    });

    it('resets all account-scoped assistant state', () => {
        const authScopeVersion =
            useAssistantChatStore.getState().authScopeVersion;
        useAssistantChatStore.setState({
            open: true,
            activeSessionId: 'session-1',
            sessions: [
                {
                    id: 'session-1',
                    title: 'First',
                    pinned: false,
                    busy: true,
                    updatedAt: '2026-08-11T00:00:00Z'
                }
            ],
            messagesBySession: { 'session-1': [] },
            surfacedEntitiesBySession: { 'session-1': [] },
            entityPanelOpenBySession: { 'session-1': true },
            busySessions: { 'session-1': true }
        });

        useAssistantChatStore.getState().resetAssistantChatState();

        const state = useAssistantChatStore.getState();
        expect(state).toMatchObject({
            open: false,
            authScopeVersion: authScopeVersion + 1,
            sessions: [],
            activeSessionId: null
        });
        expect(state.messagesBySession).toEqual({});
        expect(state.surfacedEntitiesBySession).toEqual({});
        expect(state.entityPanelOpenBySession).toEqual({});
        expect(state.busySessions).toEqual({});
    });

    it('opens a blank chat about a person until another session is opened', () => {
        useAssistantChatStore.setState({ activeSessionId: 'session-1' });

        useAssistantChatStore.getState().startAssistantDraft({
            topic: 'profile',
            target: { kind: 'user', id: 'usr_a', name: 'Alice' }
        });
        let state = useAssistantChatStore.getState();
        expect(state.open).toBe(true);
        expect(state.activeSessionId).toBeNull();
        expect(state.assistantDraft).toEqual({
            topic: 'profile',
            target: { kind: 'user', id: 'usr_a', name: 'Alice' }
        });

        state.setActiveSession('session-2');
        state = useAssistantChatStore.getState();
        expect(state.assistantDraft).toBeNull();
    });
});
