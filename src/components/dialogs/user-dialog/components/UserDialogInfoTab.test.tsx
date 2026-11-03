// @vitest-environment jsdom

import {
    act,
    cleanup,
    fireEvent,
    render,
    screen,
    within
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/components/economy/useEconomyBalance', () => ({
    useEconomyBalance: () => ({ data: 2450, refetch: vi.fn() })
}));

import { useAssistantChatStore } from '@/state/assistantChatStore';
import { usePreferencesStore } from '@/state/preferencesStore';

import {
    UserDialogActivitySummaryPanel,
    UserDialogBioPanel
} from './UserDialogInfoTab';

afterEach(cleanup);

describe('UserDialogActivitySummaryPanel', () => {
    it('shows the relationship timeline without navigating on click', async () => {
        const onOpenFeed = vi.fn();
        const onOpenInstanceHistory = vi.fn();
        const history = [
            {
                rowId: 3,
                type: 'Unfriend' as const,
                created_at: '2026-09-01T00:00:00Z'
            },
            {
                rowId: 2,
                type: 'Friend' as const,
                created_at: '2026-01-01T00:00:00Z'
            },
            {
                rowId: 1,
                type: 'Unfriend' as const,
                created_at: '2025-01-01T00:00:00Z'
            }
        ];
        render(
            <UserDialogActivitySummaryPanel
                friendedAt="2024-01-01T00:00:00Z"
                relationshipHistory={history}
                onOpenFeed={onOpenFeed}
                onOpenInstanceHistory={onOpenInstanceHistory}
                isCurrentUser={false}
                isFriend={false}
                lastSeen={undefined}
                presenceActivityAt={undefined}
                profile={{ id: 'usr_test' }}
                userTimeSpent={0}
                userJoinCount={0}
            />
        );
        const trigger = screen.getByRole('button', {
            name: /dialog.user.info.unfriended/
        });
        expect(trigger.textContent).toContain('2026');
        expect(trigger.textContent).not.toContain('2024');
        fireEvent.click(trigger);
        const popup = await screen.findByRole('dialog', {
            name: 'dialog.user.info.relationship_history'
        });
        expect(
            within(popup)
                .getAllByRole('listitem')
                .map((row) => row.querySelector('time')?.dateTime)
        ).toEqual(history.map((row) => row.created_at));
        expect(
            within(popup).getAllByText('view.friend_log.filters.Unfriend')
        ).toHaveLength(2);
        expect(
            within(popup).getByText('view.friend_log.filters.Friend')
        ).toBeTruthy();
        expect(onOpenFeed).not.toHaveBeenCalled();
        expect(onOpenInstanceHistory).not.toHaveBeenCalled();
    });

    it('opens a single relationship event only after clicking', async () => {
        const user = userEvent.setup();
        render(
            <UserDialogActivitySummaryPanel
                friendedAt={undefined}
                relationshipHistory={[
                    {
                        rowId: 1,
                        type: 'Friend',
                        created_at: '2026-09-01T00:00:00Z'
                    }
                ]}
                isCurrentUser={false}
                isFriend
                lastSeen={undefined}
                presenceActivityAt={undefined}
                profile={{ id: 'usr_test' }}
                userTimeSpent={0}
                userJoinCount={0}
            />
        );
        const trigger = screen.getByRole('button', {
            name: /dialog.user.info.friended/
        });
        await user.hover(trigger);
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 400));
        });
        expect(screen.queryByRole('dialog')).toBeNull();
        await user.click(trigger);
        const popup = await screen.findByRole('dialog', {
            name: 'dialog.user.info.relationship_history'
        });
        expect(within(popup).getAllByRole('listitem')).toHaveLength(1);
    });

    it('does not offer an empty relationship popup', () => {
        render(
            <UserDialogActivitySummaryPanel
                friendedAt={undefined}
                relationshipHistory={[]}
                isCurrentUser={false}
                isFriend={false}
                lastSeen={undefined}
                presenceActivityAt={undefined}
                profile={{ id: 'usr_test' }}
                userTimeSpent={0}
                userJoinCount={0}
            />
        );
        expect(
            screen.queryByRole('button', { name: /dialog.user.info.friended/ })
        ).toBeNull();
    });

    it('opens instance history from join count but not time together', () => {
        const onOpenInstanceHistory = vi.fn();

        render(
            <UserDialogActivitySummaryPanel
                friendedAt={undefined}
                isCurrentUser={false}
                isFriend
                lastSeen={undefined}
                onOpenInstanceHistory={onOpenInstanceHistory}
                presenceActivityAt={undefined}
                profile={{ id: 'usr_test' }}
                userTimeSpent={0}
                userJoinCount={0}
            />
        );

        fireEvent.click(
            screen.getByRole('button', {
                name: /dialog\.user\.info\.join_count/
            })
        );
        expect(
            screen.queryByRole('button', {
                name: /dialog\.user\.info\.time_together/
            })
        ).toBeNull();
        expect(screen.getByText('dialog.user.info.time_together')).toBeTruthy();

        expect(onOpenInstanceHistory).toHaveBeenCalledOnce();
    });

    it('hides the friended date for the current user', () => {
        render(
            <UserDialogActivitySummaryPanel
                friendedAt="2026-08-12T00:00:00Z"
                isCurrentUser
                isFriend={false}
                lastSeen={undefined}
                presenceActivityAt={undefined}
                profile={{ id: 'usr_self' }}
                userTimeSpent={0}
                userJoinCount={0}
            />
        );

        expect(screen.queryByText('dialog.user.info.friended')).toBeNull();
        expect(
            screen
                .getAllByText(/^dialog\.user\.info\./)
                .map((element) => element.textContent)
        ).toEqual([
            'dialog.user.info.activity_summary',
            'dialog.user.info.last_activity',
            'dialog.user.info.play_time',
            'dialog.user.info.vrc_credits',
            'dialog.user.info.date_joined'
        ]);
        expect(screen.getByText(`${(2450).toLocaleString()}V`)).toBeTruthy();
    });

    it('opens Feed from last activity only for friends', () => {
        const onOpenFeed = vi.fn();
        const { rerender } = render(
            <UserDialogActivitySummaryPanel
                friendedAt={undefined}
                isCurrentUser={false}
                isFriend={false}
                lastSeen={undefined}
                onOpenFeed={onOpenFeed}
                presenceActivityAt={'2026-08-12T00:00:00Z'}
                profile={{ id: 'usr_test' }}
                userTimeSpent={0}
                userJoinCount={0}
            />
        );

        expect(
            screen.queryByRole('button', {
                name: /dialog\.user\.info\.last_activity/
            })
        ).toBeNull();

        rerender(
            <UserDialogActivitySummaryPanel
                friendedAt={undefined}
                isCurrentUser={false}
                isFriend
                lastSeen={undefined}
                onOpenFeed={onOpenFeed}
                presenceActivityAt={'2026-08-12T00:00:00Z'}
                profile={{ id: 'usr_test' }}
                userTimeSpent={0}
                userJoinCount={0}
            />
        );

        fireEvent.click(
            screen.getByRole('button', {
                name: /dialog\.user\.info\.last_activity/
            })
        );
        expect(onOpenFeed).toHaveBeenCalledOnce();
    });

    it('starts an assistant chat about the person unless the shortcuts are off', () => {
        const panel = (
            <UserDialogActivitySummaryPanel
                friendedAt={undefined}
                isCurrentUser={false}
                isFriend
                lastSeen={undefined}
                presenceActivityAt={undefined}
                profile={{ id: 'usr_test', displayName: 'Mika' }}
                userTimeSpent={0}
                userJoinCount={0}
            />
        );
        const { rerender } = render(panel);

        fireEvent.click(
            screen.getByRole('button', {
                name: 'assistant.title'
            })
        );
        expect(useAssistantChatStore.getState()).toMatchObject({
            open: true,
            mentionDraft: { kind: 'user', id: 'usr_test', name: 'Mika' }
        });

        act(() =>
            usePreferencesStore.setState({ showAssistantShortcuts: false })
        );
        rerender(panel);
        expect(
            screen.queryByRole('button', {
                name: 'assistant.title'
            })
        ).toBeNull();
        usePreferencesStore.setState({ showAssistantShortcuts: true });
    });
});

describe('UserDialogBioPanel', () => {
    it('offers bio editing only when an edit handler is provided', () => {
        const onEditBio = vi.fn();
        const { rerender } = render(
            <UserDialogBioPanel
                profile={{ id: 'usr_test', bio: 'hello' }}
                bioLinks={[]}
            />
        );
        expect(
            screen.queryByRole('button', {
                name: 'dialog.user.actions.edit_profile'
            })
        ).toBeNull();

        rerender(
            <UserDialogBioPanel
                profile={{ id: 'usr_self', bio: 'hello' }}
                bioLinks={[]}
                onEditBio={onEditBio}
            />
        );
        fireEvent.click(
            screen.getByRole('button', {
                name: 'dialog.user.actions.edit_profile'
            })
        );
        expect(onEditBio).toHaveBeenCalledOnce();
    });
});
