// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
    ]
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
});
