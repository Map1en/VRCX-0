import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Session } from '@/platform/tauri/bindings';

const mocks = vi.hoisted(() => ({
    listSessions: vi.fn(),
    getSession: vi.fn(),
    deleteSession: vi.fn(),
    renameSession: vi.fn(),
    setPinned: vi.fn(),
    toastAdd: vi.fn()
}));

vi.mock('@/services/toastService', () => ({
    toast: { add: mocks.toastAdd }
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appAssistantListSessions: mocks.listSessions,
        appAssistantGetSession: mocks.getSession,
        appAssistantDeleteSession: mocks.deleteSession,
        appAssistantRenameSession: mocks.renameSession,
        appAssistantSetSessionPinned: mocks.setPinned
    }
}));

import { useAssistantChatStore } from '@/state/assistantChatStore';

import {
    deleteSession,
    openSession,
    refreshSessions,
    renameSession,
    setSessionPinned
} from './assistantActions';

function session(id: string): Session {
    return {
        id,
        title: id,
        messages: [
            {
                id: `message-${id}`,
                seq: 1,
                role: 'user',
                content: id,
                createdAt: '2026-08-11T00:00:00Z',
                toolCall: null,
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
        createdAt: '2026-08-11T00:00:00Z',
        updatedAt: '2026-08-11T00:00:00Z'
    };
}

function deferred<T>(): {
    promise: Promise<T>;
    resolve: (value: T) => void;
} {
    let resolve: (value: T) => void = () => {
        throw new Error('Deferred promise was not initialized.');
    };
    const promise = new Promise<T>((next) => {
        resolve = next;
    });
    return { promise, resolve };
}

describe('assistantActions session lifecycle', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useAssistantChatStore.getState().resetAssistantChatState();
        useAssistantChatStore.getState().setOpen(true);
        mocks.listSessions.mockResolvedValue([]);
        mocks.deleteSession.mockResolvedValue(undefined);
    });

    it('evicts the previous completed transcript when switching sessions', async () => {
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
            messagesBySession: { 'session-1': [] }
        });
        mocks.getSession.mockResolvedValue(session('session-2'));

        await openSession('session-2');

        expect(useAssistantChatStore.getState()).toMatchObject({
            activeSessionId: 'session-2',
            messagesBySession: {
                'session-2': [
                    {
                        id: 'message-session-2',
                        text: 'session-2'
                    }
                ]
            }
        });
        expect(
            useAssistantChatStore.getState().messagesBySession['session-1']
        ).toBeUndefined();
    });

    it('does not repopulate a transcript after the dialog closes during hydration', async () => {
        const pendingSession = deferred<Session | null>();
        mocks.getSession.mockReturnValue(pendingSession.promise);

        const opening = openSession('session-1');
        useAssistantChatStore.getState().setOpen(false);
        pendingSession.resolve(session('session-1'));
        await opening;

        expect(
            useAssistantChatStore.getState().messagesBySession['session-1']
        ).toBeUndefined();
    });

    it('does not apply a session list fetched for an older auth scope', async () => {
        const pendingSessions = deferred<
            Array<{
                id: string;
                title: string;
                pinned: boolean;
                busy: boolean;
                updatedAt: string;
            }>
        >();
        mocks.listSessions.mockReturnValue(pendingSessions.promise);

        const refresh = refreshSessions();
        useAssistantChatStore.getState().resetAssistantChatState();
        pendingSessions.resolve([
            {
                id: 'session-old-account',
                title: 'Old account',
                pinned: false,
                busy: false,
                updatedAt: '2026-08-11T00:00:00Z'
            }
        ]);
        await refresh;

        expect(useAssistantChatStore.getState().sessions).toEqual([]);
    });

    it('removes the deleted session and its local data', async () => {
        useAssistantChatStore.setState({
            activeSessionId: 'session-1',
            sessions: [
                {
                    id: 'session-1',
                    title: 'First',
                    pinned: false,
                    busy: false,
                    updatedAt: '2026-08-11T00:00:00Z'
                }
            ],
            messagesBySession: { 'session-1': [] },
            surfacedEntitiesBySession: { 'session-1': [] },
            entityPanelOpenBySession: { 'session-1': true },
            busySessions: { 'session-1': false }
        });

        deleteSession('session-1');

        expect(mocks.deleteSession).not.toHaveBeenCalled();
        mocks.toastAdd.mock.calls[0][0].onClose();
        await vi.waitFor(() =>
            expect(mocks.deleteSession).toHaveBeenCalledWith('session-1')
        );
        const state = useAssistantChatStore.getState();
        expect(state.activeSessionId).toBeNull();
        expect(state.sessions).toEqual([]);
        expect(state.messagesBySession).toEqual({});
        expect(state.surfacedEntitiesBySession).toEqual({});
        expect(state.entityPanelOpenBySession).toEqual({});
        expect(state.busySessions).toEqual({});
    });

    it('brings a deleted session back when the delete is undone', async () => {
        const first = {
            id: 'session-1',
            title: 'First',
            pinned: false,
            busy: false,
            updatedAt: '2026-08-11T00:00:00Z'
        };
        useAssistantChatStore.setState({ sessions: [first] });
        mocks.listSessions.mockResolvedValue([first]);

        deleteSession('session-1');
        await refreshSessions();
        expect(useAssistantChatStore.getState().sessions).toEqual([]);

        const options = mocks.toastAdd.mock.calls[0][0];
        options.actionProps.onClick();
        options.onClose();

        await vi.waitFor(() =>
            expect(useAssistantChatStore.getState().sessions).toEqual([first])
        );
        expect(mocks.deleteSession).not.toHaveBeenCalled();
    });

    it('renames and pins a session right away and saves it', async () => {
        const first = {
            id: 'session-1',
            title: 'who is online',
            pinned: false,
            busy: false,
            updatedAt: '2026-08-11T00:00:00Z'
        };
        useAssistantChatStore.setState({ sessions: [first] });
        mocks.listSessions.mockReturnValue(new Promise(() => {}));
        mocks.renameSession.mockResolvedValue(null);
        mocks.setPinned.mockResolvedValue(null);

        void renameSession('session-1', '  Weekend recap ');
        void setSessionPinned('session-1', true);

        expect(useAssistantChatStore.getState().sessions).toEqual([
            { ...first, title: 'Weekend recap', pinned: true }
        ]);
        await vi.waitFor(() =>
            expect(mocks.setPinned).toHaveBeenCalledWith('session-1', true)
        );
        expect(mocks.renameSession).toHaveBeenCalledWith(
            'session-1',
            'Weekend recap'
        );
    });
});
