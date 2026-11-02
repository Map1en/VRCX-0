// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { UIUserChoice } from '@/domain/assistant/types';
import { useAssistantChatStore } from '@/state/assistantChatStore';

const mocks = vi.hoisted(() => ({
    appAssistantAnswerChoice: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appAssistantAnswerChoice: mocks.appAssistantAnswerChoice
    }
}));

import { AssistantChoiceCard } from './AssistantChoiceCard';

const CHOICE: UIUserChoice = {
    id: 'choice_1',
    sessionId: 'session_1',
    query: 'Ali',
    status: 'pending',
    candidates: [
        {
            userId: 'usr_alice',
            displayName: 'Alice',
            isFriend: true,
            encounterCount: 4,
            lastSeen: '2026-10-01T12:00:00Z'
        },
        {
            userId: 'usr_alicia',
            displayName: 'Alicia',
            isFriend: false,
            encounterCount: 1,
            lastSeen: '2026-09-01T12:00:00Z'
        }
    ]
};

function seedPendingChoice() {
    useAssistantChatStore.setState({
        messagesBySession: {
            session_1: [
                {
                    id: 'asst_1',
                    role: 'assistant',
                    text: '',
                    turnId: 'turn_1',
                    streaming: true,
                    toolCalls: [],
                    choices: [CHOICE]
                }
            ]
        }
    });
}

function storedChoice() {
    return useAssistantChatStore.getState().messagesBySession.session_1[0]
        .choices?.[0];
}

describe('AssistantChoiceCard', () => {
    afterEach(() => {
        cleanup();
        vi.clearAllMocks();
        useAssistantChatStore.getState().resetAssistantChatState();
    });

    it('sends the picked candidate and settles the choice', async () => {
        mocks.appAssistantAnswerChoice.mockResolvedValue(null);
        seedPendingChoice();
        render(<AssistantChoiceCard choice={CHOICE} active />);

        fireEvent.click(screen.getByRole('radio', { name: /Alicia/ }));
        fireEvent.click(
            screen.getByRole('button', { name: 'assistant.choice.confirm' })
        );

        await vi.waitFor(() =>
            expect(mocks.appAssistantAnswerChoice).toHaveBeenCalledWith(
                'session_1',
                'choice_1',
                'usr_alicia'
            )
        );
        expect(storedChoice()).toMatchObject({
            status: 'picked',
            pickedUserId: 'usr_alicia'
        });
    });

    it('lets the assistant ask in text when the choice is skipped', async () => {
        mocks.appAssistantAnswerChoice.mockResolvedValue(null);
        seedPendingChoice();
        render(<AssistantChoiceCard choice={CHOICE} active />);

        fireEvent.click(
            screen.getByRole('button', { name: 'assistant.choice.skip' })
        );

        await vi.waitFor(() =>
            expect(mocks.appAssistantAnswerChoice).toHaveBeenCalledWith(
                'session_1',
                'choice_1',
                null
            )
        );
        expect(storedChoice()?.status).toBe('skipped');
    });

    it('shows a settled note instead of the form once the turn ends', () => {
        render(<AssistantChoiceCard choice={CHOICE} active={false} />);

        expect(screen.queryByRole('radio')).toBeNull();
        expect(screen.getByText('assistant.choice.skipped')).toBeTruthy();
    });
});
