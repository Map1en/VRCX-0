// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { UIApproval } from '@/domain/assistant/types';
import { useAssistantChatStore } from '@/state/assistantChatStore';

const mocks = vi.hoisted(() => ({
    appAssistantAnswerApproval: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appAssistantAnswerApproval: mocks.appAssistantAnswerApproval
    }
}));

import { AssistantApprovalCard } from './AssistantApprovalCard';

const APPROVAL: UIApproval = {
    id: 'approval_1',
    sessionId: 'session_1',
    status: 'pending',
    fields: [
        { name: 'userId', value: 'usr_alice' },
        { name: 'note', value: 'met at the club' }
    ],
    favoriteMove: null
};

function seedPendingApproval() {
    useAssistantChatStore.setState({
        messagesBySession: {
            session_1: [
                {
                    id: 'asst_1',
                    role: 'assistant',
                    text: '',
                    turnId: 'turn_1',
                    streaming: true,
                    toolCalls: [
                        {
                            id: 'call_1',
                            name: 'set_friend_note',
                            args: '{}',
                            status: 'pending',
                            summary: '',
                            entities: [],
                            charts: [],
                            approval: APPROVAL
                        }
                    ]
                }
            ]
        }
    });
}

function LocationProbe() {
    const location = useLocation();
    return <output>{`${location.pathname}${location.search}`}</output>;
}

function storedApproval() {
    return useAssistantChatStore.getState().messagesBySession.session_1[0]
        .toolCalls[0].approval;
}

describe('AssistantApprovalCard', () => {
    afterEach(() => {
        cleanup();
        vi.clearAllMocks();
        useAssistantChatStore.getState().resetAssistantChatState();
    });

    it('shows exactly what will run before asking', () => {
        render(
            <AssistantApprovalCard tool="set_friend_note" approval={APPROVAL} />
        );

        expect(screen.getByText('assistant.approval.title')).toBeTruthy();
        expect(screen.getByText('usr_alice')).toBeTruthy();
        expect(screen.getByText('met at the club')).toBeTruthy();
    });

    it.each([
        ['assistant.approval.approve', true, 'approved'],
        ['assistant.approval.deny', false, 'denied']
    ] as const)(
        'sends %s and settles the card',
        async (button, approved, status) => {
            mocks.appAssistantAnswerApproval.mockResolvedValue(null);
            seedPendingApproval();
            render(
                <AssistantApprovalCard
                    tool="set_friend_note"
                    approval={APPROVAL}
                />
            );

            fireEvent.click(screen.getByRole('button', { name: button }));

            await vi.waitFor(() =>
                expect(mocks.appAssistantAnswerApproval).toHaveBeenCalledWith(
                    'session_1',
                    'approval_1',
                    approved
                )
            );
            expect(storedApproval()?.status).toBe(status);
        }
    );

    it('offers a favorite ID backup before a favorite move and keeps the approval pending', () => {
        seedPendingApproval();
        useAssistantChatStore.setState({
            open: true,
            busySessions: { session_1: true }
        });
        const approval: UIApproval = {
            ...APPROVAL,
            fields: [
                { name: 'kind', value: 'avatar' },
                { name: 'entityIds', value: '["avtr_a"]' },
                { name: 'targetGroup', value: 'avatars2' }
            ]
        };
        render(
            <MemoryRouter initialEntries={['/']}>
                <AssistantApprovalCard
                    tool="favorite_move"
                    approval={approval}
                />
                <LocationProbe />
            </MemoryRouter>
        );

        expect(screen.getByText('assistant.approval.backup_hint')).toBeTruthy();
        fireEvent.click(
            screen.getByRole('button', {
                name: 'assistant.approval.backup_open'
            })
        );

        expect(screen.getByRole('status').textContent).toBe(
            '/favorites/avatars?export=1'
        );
        expect(useAssistantChatStore.getState().open).toBe(false);
        expect(mocks.appAssistantAnswerApproval).not.toHaveBeenCalled();
        expect(storedApproval()?.status).toBe('pending');
    });

    it('summarizes a favorite move batch by name and approves it all at once', () => {
        mocks.appAssistantAnswerApproval.mockResolvedValue(null);
        const approval: UIApproval = {
            ...APPROVAL,
            fields: [
                { name: 'entityIds', value: '["wrld_a","wrld_b","wrld_c"]' }
            ],
            favoriteMove: {
                kind: 'world',
                target: { name: 'worlds2', displayName: 'Game and sleep' },
                items: [
                    {
                        entityId: 'wrld_a',
                        name: 'Night Lake',
                        source: { name: 'worlds1', displayName: 'Chill' },
                        status: 'wouldMove'
                    },
                    {
                        entityId: 'wrld_b',
                        name: 'Rainy Room',
                        source: { name: 'worlds3', displayName: '' },
                        status: 'wouldMove'
                    },
                    {
                        entityId: 'wrld_c',
                        name: null,
                        source: null,
                        status: 'notFavorited'
                    }
                ]
            }
        };
        render(
            <MemoryRouter>
                <AssistantApprovalCard
                    tool="favorite_move"
                    approval={approval}
                />
            </MemoryRouter>
        );

        expect(screen.getByText('Night Lake')).toBeTruthy();
        expect(screen.getByText('Rainy Room')).toBeTruthy();
        expect(screen.getByText('wrld_c')).toBeTruthy();
        expect(
            screen.getByText('assistant.approval.favorite_move.not_favorited')
        ).toBeTruthy();

        fireEvent.click(
            screen.getByRole('button', {
                name: 'assistant.approval.approve_all'
            })
        );
        expect(mocks.appAssistantAnswerApproval).toHaveBeenCalledWith(
            'session_1',
            'approval_1',
            true
        );
    });
});
