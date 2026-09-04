// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react';
import type { PropsWithChildren, ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getPlayerDetailFromInstance: vi.fn().mockResolvedValue([])
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, values?: { count?: number }) =>
            key === 'view.game_log.sessions.friends_count'
                ? `${values?.count ?? 0} friends`
                : key
    })
}));

vi.mock('@/components/Location', () => ({
    Location: ({ hint }: { hint?: string }) => <span>{hint}</span>
}));

vi.mock('@/components/user-hover-card/UserHoverCard', () => ({
    UserHoverCard: ({ children }: PropsWithChildren) => children
}));

vi.mock('@/lib/useKnownUser', () => ({
    useKnownUserFacts: (userIds: string[]) =>
        Object.fromEntries(
            userIds.map((userId) => [
                userId,
                {
                    id: userId,
                    currentAvatarThumbnailImageUrl: `https://example.test/${userId}.png`
                }
            ])
        )
}));

vi.mock('@/services/entityMediaService', () => ({
    userImage: (user: { currentAvatarThumbnailImageUrl?: string } | null) =>
        user?.currentAvatarThumbnailImageUrl || ''
}));

vi.mock('@/ui/shadcn/avatar', () => ({
    Avatar: ({ children }: PropsWithChildren) => <span>{children}</span>,
    AvatarImage: ({ src }: { src?: string }) => <img src={src} alt="" />,
    AvatarFallback: ({ children }: PropsWithChildren) => <span>{children}</span>
}));

vi.mock('@/repositories/gameLogRepository', () => ({
    default: {
        getPlayerDetailFromInstance: mocks.getPlayerDetailFromInstance
    }
}));

vi.mock('@/services/gameLogUserDialogService', () => ({
    openGameLogUser: vi.fn()
}));

vi.mock('@/ui/shadcn/collapsible', () => ({
    Collapsible: ({ children }: PropsWithChildren) => <div>{children}</div>,
    CollapsibleContent: ({ children }: PropsWithChildren) => (
        <div>{children}</div>
    ),
    CollapsibleTrigger: ({ render }: { render: ReactElement }) => render
}));

vi.mock('@/ui/shadcn/hover-card', () => ({
    HoverCard: ({ children }: PropsWithChildren) => <div>{children}</div>,
    HoverCardTrigger: ({ render }: { render: ReactElement }) => render,
    HoverCardContent: ({
        children,
        side
    }: PropsWithChildren<{ side?: string }>) => (
        <div data-testid="friends-hover-card" data-side={side}>
            {children}
        </div>
    )
}));

vi.mock('./GameLogSessionEventRow', () => ({
    SessionEventGroups: () => null
}));

import { GameLogSessionAffinityContext } from '../gameLogSessionAffinity';
import { GameLogSessionsView } from './GameLogSessionsView';

describe('GameLogSessionsView', () => {
    afterEach(() => {
        cleanup();
        vi.clearAllMocks();
    });

    it('shows every session friend with an avatar below the +n trigger', () => {
        const friends = [
            ['usr_alice', 'Alice'],
            ['usr_bob', 'Bob'],
            ['usr_carla', 'Carla'],
            ['usr_dan', 'Dan']
        ];

        const sessionView = (
            <GameLogSessionsView
                isGameRunning={false}
                defaultOpen
                sessionOpenOverrides={new Map()}
                onSessionOpenChange={vi.fn()}
                sessions={[
                    {
                        id: 1,
                        created_at: '2026-08-10T00:00:00.000Z',
                        duration: 60_000,
                        location: 'wrld_test:1',
                        worldId: 'wrld_test',
                        worldName: 'Test World',
                        groupName: '',
                        playerDurationRows: [],
                        events: friends.map(([userId, displayName], index) => ({
                            type: 'OnPlayerJoined',
                            created_at: `2026-08-10T00:0${index}:00.000Z`,
                            userId,
                            displayName
                        }))
                    }
                ]}
            />
        );
        const view = render(
            <GameLogSessionAffinityContext
                value={{
                    favoriteIdSet: new Set(['usr_dan']),
                    friendIdSet: new Set(friends.map(([userId]) => userId))
                }}
            >
                {sessionView}
            </GameLogSessionAffinityContext>
        );

        expect(
            screen.getByRole('button', { name: '4 friends' }).textContent
        ).toBe('+1');
        const hoverCard = screen.getByTestId('friends-hover-card');
        expect(hoverCard.dataset.side).toBe('bottom');

        for (const [userId, displayName] of friends) {
            const row = within(hoverCard).getByText(displayName).closest('li');
            expect(row).not.toBeNull();
            expect(row?.querySelector('img')?.getAttribute('src')).toBe(
                `https://example.test/${userId}.png`
            );
        }
        expect(
            within(hoverCard)
                .getAllByRole('listitem')
                .map((row) => row.textContent)
        ).toEqual(['DDan', 'AAlice', 'BBob', 'CCarla']);

        view.rerender(
            <GameLogSessionAffinityContext
                value={{
                    favoriteIdSet: new Set(['usr_bob']),
                    friendIdSet: new Set(['usr_alice', 'usr_bob'])
                }}
            >
                {sessionView}
            </GameLogSessionAffinityContext>
        );
        expect(screen.queryByRole('button', { name: '4 friends' })).toBeNull();
        expect(screen.queryByTestId('friends-hover-card')).toBeNull();
        expect(screen.getByLabelText('2 friends')).not.toBeNull();
        expect(screen.queryByRole('button', { name: 'Dan' })).toBeNull();
        expect(
            within(screen.getByLabelText('2 friends'))
                .getAllByRole('button')
                .map((button) => button.getAttribute('aria-label'))
        ).toEqual(['Bob', 'Alice']);
    });

    it('uses the batched duration rows without querying each session', () => {
        render(
            <GameLogSessionsView
                isGameRunning={false}
                defaultOpen
                sessionOpenOverrides={new Map()}
                onSessionOpenChange={vi.fn()}
                sessions={[
                    {
                        id: 1,
                        created_at: '2026-08-10T00:00:00.000Z',
                        duration: 0,
                        location: 'wrld_test:1',
                        worldId: 'wrld_test',
                        worldName: 'Test World',
                        groupName: '',
                        playerDurationRows: [
                            {
                                displayName: 'Alice',
                                userId: 'usr_alice',
                                time: 60_000
                            },
                            {
                                displayName: 'Alice',
                                userId: 'usr_alice',
                                time: 90_000
                            }
                        ],
                        events: []
                    }
                ]}
            />,
            {
                wrapper: ({ children }) => (
                    <GameLogSessionAffinityContext
                        value={{
                            favoriteIdSet: new Set(),
                            friendIdSet: new Set()
                        }}
                    >
                        {children}
                    </GameLogSessionAffinityContext>
                )
            }
        );

        expect(screen.getByText(/2m/)).not.toBeNull();
        expect(mocks.getPlayerDetailFromInstance).not.toHaveBeenCalled();
    });
});
