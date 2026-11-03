// @vitest-environment jsdom

import {
    cleanup,
    fireEvent,
    render,
    renderHook,
    screen
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', async (importOriginal) => ({
    ...(await importOriginal<typeof import('react-i18next')>()),
    useTranslation: () => ({
        t: (key: string, options?: { mention?: string }) =>
            options?.mention ? `${key} ${options.mention}` : key
    })
}));

import type { UIMessage } from '@/domain/assistant/types';
import type { FriendRecord } from '@/domain/friends/types';
import { useFriendRosterStore } from '@/state/friendRosterStore';

import { AssistantFollowUps, useMentionPrompts } from './AssistantFollowUps';

function brief(user: string): UIMessage {
    return {
        id: 'asst_1',
        role: 'assistant',
        text: 'You and Alice met last week.',
        streaming: false,
        toolCalls: [
            {
                id: 'tool_1',
                name: 'get_friend_profile',
                args: JSON.stringify({ user }),
                status: 'done',
                summary: '',
                entities: [
                    { kind: 'user', id: 'usr_a', displayName: 'Alice' },
                    { kind: 'world', id: 'wrld_l', displayName: 'Loft' }
                ],
                charts: []
            }
        ]
    };
}

describe('AssistantFollowUps', () => {
    afterEach(cleanup);

    it('offers numbered follow-ups about the briefed friend and sends one by key', () => {
        useFriendRosterStore.setState({
            friendsById: {
                usr_a: { id: 'usr_a', displayName: 'Alice' } as FriendRecord
            }
        });
        const onSend = vi.fn();
        render(<AssistantFollowUps message={brief('usr_a')} onSend={onSend} />);

        expect(screen.getAllByRole('button')).toHaveLength(4);
        expect(
            screen.getByRole('button', {
                name: /follow_up.companions Alice$/
            })
        ).toBeTruthy();

        fireEvent.keyDown(window, { key: '2' });
        expect(onSend).toHaveBeenCalledWith(
            'assistant.follow_up.mutuals [@Alice](vrcx-0://user/open?id=usr_a)'
        );
    });

    it('lets digits through while typing and shows the shorter list for non-friends', () => {
        useFriendRosterStore.setState({ friendsById: {} });
        const onSend = vi.fn();
        render(
            <>
                <textarea defaultValue="hello" />
                <AssistantFollowUps message={brief('Alice')} onSend={onSend} />
            </>
        );

        expect(screen.getAllByRole('button')).toHaveLength(3);
        fireEvent.keyDown(screen.getByRole('textbox'), { key: '1' });
        expect(onSend).not.toHaveBeenCalled();
    });

    it('stays hidden for answers that did not brief a person', () => {
        const { container } = render(
            <AssistantFollowUps
                message={{ ...brief('usr_a'), toolCalls: [] }}
                onSend={vi.fn()}
            />
        );
        expect(container.innerHTML).toBe('');
    });

    it('leads with the brief when opened from a profile', () => {
        useFriendRosterStore.setState({ friendsById: {} });
        const { result } = renderHook(() =>
            useMentionPrompts({ kind: 'user', id: 'usr_b', name: 'Bob' }, true)
        );

        expect(result.current).toHaveLength(4);
        expect(result.current[0]).toEqual({
            label: 'assistant.brief.prompt Bob',
            text: 'assistant.brief.prompt [@Bob](vrcx-0://user/open?id=usr_b)'
        });
    });

    it('follows a world profile answer with questions about that world', () => {
        const onSend = vi.fn();
        render(
            <AssistantFollowUps
                message={{
                    ...brief('usr_a'),
                    toolCalls: [
                        {
                            id: 'tool_2',
                            name: 'get_world_profile',
                            args: JSON.stringify({ world: 'night pier' }),
                            status: 'done',
                            summary: '',
                            entities: [
                                {
                                    kind: 'world',
                                    id: 'wrld_p',
                                    displayName: 'Night Pier'
                                },
                                {
                                    kind: 'user',
                                    id: 'usr_a',
                                    displayName: 'Alice'
                                }
                            ],
                            charts: []
                        }
                    ]
                }}
                onSend={onSend}
            />
        );

        expect(screen.getAllByRole('button')).toHaveLength(3);
        fireEvent.keyDown(window, { key: '3' });
        expect(onSend).toHaveBeenCalledWith(
            'assistant.follow_up.world_popularity [@Night Pier](vrcx-0://world/open?id=wrld_p)'
        );
    });
});
