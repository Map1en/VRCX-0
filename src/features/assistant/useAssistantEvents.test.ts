// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    handlers: new Map<string, (payload: unknown) => void>(),
    subscribe: vi.fn((name: string, handler: (payload: unknown) => void) => {
        mocks.handlers.set(name, handler);
        return Promise.resolve(() => {});
    }),
    recordToolError: vi.fn(),
    recordTurnError: vi.fn()
}));

vi.mock('@/platform/tauri/client', () => ({
    tauriClient: {
        events: {
            subscribe: mocks.subscribe
        }
    }
}));

vi.mock('@/services/telemetry/telemetryAssistantHealth', () => ({
    recordAssistantToolError: mocks.recordToolError,
    recordAssistantTurnError: mocks.recordTurnError
}));

import { useAssistantChatStore } from '@/state/assistantChatStore';
import { useRuntimeStore } from '@/state/runtimeStore';

import { useAssistantEvents } from './useAssistantEvents';

describe('useAssistantEvents auth scope', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.handlers.clear();
        useAssistantChatStore.getState().resetAssistantChatState();
        useAssistantChatStore.getState().setOpen(true);
        useRuntimeStore.getState().resetRuntimeState();
        useRuntimeStore.getState().setAuthBootstrap({
            currentUserId: 'usr_current'
        });
    });

    afterEach(() => {
        cleanup();
    });

    it('ignores events emitted by a previous account', async () => {
        renderHook(() => useAssistantEvents());
        await waitFor(() => {
            expect(mocks.handlers.has('assistantDelta')).toBe(true);
        });
        const handleDelta = mocks.handlers.get('assistantDelta');
        expect(handleDelta).toBeDefined();

        act(() => {
            handleDelta?.({
                ownerUserId: 'usr_previous',
                sessionId: 'session-1',
                turnId: 'turn-1',
                text: 'previous account',
                replace: true
            });
        });
        expect(
            useAssistantChatStore.getState().messagesBySession['session-1']
        ).toBeUndefined();

        act(() => {
            handleDelta?.({
                ownerUserId: 'usr_current',
                sessionId: 'session-1',
                turnId: 'turn-1',
                text: 'current account',
                replace: true
            });
        });
        expect(
            useAssistantChatStore.getState().messagesBySession['session-1']
        ).toMatchObject([{ text: 'current account' }]);
    });

    it('drops buffered deltas when the current account changes', async () => {
        renderHook(() => useAssistantEvents());
        await waitFor(() => {
            expect(mocks.handlers.has('assistantDelta')).toBe(true);
        });
        const handleDelta = mocks.handlers.get('assistantDelta');

        act(() => {
            handleDelta?.({
                ownerUserId: 'usr_current',
                sessionId: 'session-1',
                turnId: 'turn-1',
                text: 'buffered previous account text',
                replace: false
            });
            useRuntimeStore.getState().setAuthBootstrap({
                currentUserId: 'usr_next'
            });
        });
        await act(
            () =>
                new Promise<void>((resolve) => {
                    requestAnimationFrame(() => resolve());
                })
        );

        expect(
            useAssistantChatStore.getState().messagesBySession['session-1']
        ).toBeUndefined();
    });

    it('ignores same-account events after the assistant auth scope resets', async () => {
        renderHook(() => useAssistantEvents());
        await waitFor(() => {
            expect(mocks.handlers.has('assistantDelta')).toBe(true);
        });
        useAssistantChatStore.getState().resetAssistantChatState();

        act(() => {
            mocks.handlers.get('assistantDelta')?.({
                ownerUserId: 'usr_current',
                sessionId: 'session-1',
                turnId: 'turn-1',
                text: 'stale same-account text',
                replace: true
            });
        });

        expect(
            useAssistantChatStore.getState().messagesBySession['session-1']
        ).toBeUndefined();
    });

    it('attaches a choice request to the running turn as a pending choice', async () => {
        renderHook(() => useAssistantEvents());
        await waitFor(() => {
            expect(mocks.handlers.has('assistantChoiceRequest')).toBe(true);
        });
        const candidate = {
            userId: 'usr_alice',
            displayName: 'Alice',
            isFriend: true,
            encounterCount: 4,
            lastSeen: '2026-10-01T12:00:00Z'
        };

        act(() => {
            mocks.handlers.get('assistantChoiceRequest')?.({
                ownerUserId: 'usr_current',
                sessionId: 'session-1',
                turnId: 'turn-1',
                toolCallId: 'call-1',
                choiceId: 'choice-1',
                query: 'Ali',
                candidates: [candidate]
            });
        });

        expect(
            useAssistantChatStore.getState().messagesBySession['session-1']
        ).toMatchObject([
            {
                role: 'assistant',
                turnId: 'turn-1',
                choices: [
                    {
                        id: 'choice-1',
                        sessionId: 'session-1',
                        query: 'Ali',
                        status: 'pending',
                        candidates: [candidate]
                    }
                ]
            }
        ]);
    });

    it('evicts a retained busy transcript after it finishes while closed', async () => {
        renderHook(() => useAssistantEvents());
        await waitFor(() => {
            expect(mocks.handlers.has('assistantDone')).toBe(true);
        });
        useAssistantChatStore.setState({
            sessions: [
                {
                    id: 'session-1',
                    title: 'Running',
                    pinned: false,
                    busy: true,
                    updatedAt: '2026-08-11T00:00:00Z'
                }
            ],
            messagesBySession: { 'session-1': [] },
            busySessions: { 'session-1': true }
        });
        useAssistantChatStore.getState().setOpen(false);

        act(() => {
            mocks.handlers.get('assistantDone')?.({
                ownerUserId: 'usr_current',
                sessionId: 'session-1',
                turnId: 'turn-1'
            });
        });

        expect(useAssistantChatStore.getState()).toMatchObject({
            open: false,
            sessions: [
                {
                    id: 'session-1',
                    busy: false
                }
            ],
            messagesBySession: {},
            busySessions: {}
        });
    });
});
