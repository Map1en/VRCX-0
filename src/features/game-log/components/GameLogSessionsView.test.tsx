// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react';
import { cloneElement } from 'react';
import type { PropsWithChildren, ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', async (importOriginal) => ({
    ...(await importOriginal<typeof import('react-i18next')>()),
    useTranslation: () => ({
        t: (key: string, values?: { count?: number }) =>
            key === 'view.game_log.sessions.friends_count'
                ? `${values?.count ?? 0} friends`
                : key === 'view.game_log.sessions.players_count'
                  ? `${values?.count ?? 0} players`
                  : key === 'view.game_log.sessions.videos_count'
                    ? `${values?.count ?? 0} videos`
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
    Avatar: ({
        children,
        render,
        ...props
    }: PropsWithChildren<{ render?: ReactElement }>) =>
        render ? (
            cloneElement(render, props, children)
        ) : (
            <span>{children}</span>
        ),
    AvatarGroup: ({ children }: PropsWithChildren) => <div>{children}</div>,
    AvatarImage: ({ src }: { src?: string }) => <img src={src} alt="" />,
    AvatarFallback: ({ children }: PropsWithChildren) => <span>{children}</span>
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
            ['usr_dan', 'Dan'],
            ['usr_eve', 'Eve'],
            ['usr_finn', 'Finn']
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
                        remote: false,
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
            screen.getByRole('button', { name: '6 friends' }).textContent
        ).toBe('+1');
        for (const name of ['Dan', 'Alice', 'Bob', 'Carla', 'Eve']) {
            expect(screen.getByRole('button', { name })).not.toBeNull();
        }
        expect(screen.queryByRole('button', { name: 'Finn' })).toBeNull();
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
        ).toEqual(['DDan', 'AAlice', 'BBob', 'CCarla', 'EEve', 'FFinn']);

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
        expect(screen.queryByRole('button', { name: '6 friends' })).toBeNull();
        expect(screen.queryByTestId('friends-hover-card')).toBeNull();
        expect(screen.getByLabelText('2 friends')).not.toBeNull();
        expect(screen.queryByRole('button', { name: 'Dan' })).toBeNull();
        expect(
            within(screen.getByLabelText('2 friends'))
                .getAllByRole('button')
                .map((button) => button.getAttribute('aria-label'))
        ).toEqual(['Bob', 'Alice']);
    });

    it('shows the session duration accumulated from batched player rows', () => {
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
                        remote: false,
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
    });

    it('groups sessions by day and summarizes players and videos', () => {
        const view = render(
            <GameLogSessionsView
                isGameRunning={false}
                defaultOpen
                sessionOpenOverrides={new Map()}
                onSessionOpenChange={vi.fn()}
                sessions={[
                    {
                        id: 2,
                        created_at: '2026-08-11T12:00:00',
                        duration: 0,
                        location: 'wrld_b:1',
                        worldId: 'wrld_b',
                        worldName: 'Second World',
                        groupName: '',
                        remote: false,
                        playerDurationRows: [],
                        events: [
                            {
                                type: 'OnPlayerJoined',
                                created_at: '2026-08-11T12:01:00',
                                userId: 'usr_alice',
                                displayName: 'Alice'
                            },
                            {
                                type: 'JoinGroup',
                                created_at: '2026-08-11T12:02:00',
                                count: 2,
                                members: [
                                    {
                                        userId: 'usr_alice',
                                        displayName: 'Alice',
                                        created_at: '2026-08-11T12:02:00',
                                        isFavorite: false
                                    },
                                    {
                                        userId: 'usr_bob',
                                        displayName: 'Bob',
                                        created_at: '2026-08-11T12:02:00',
                                        isFavorite: false
                                    }
                                ]
                            },
                            {
                                type: 'VideoPlay',
                                created_at: '2026-08-11T12:03:00',
                                playCount: 2
                            }
                        ]
                    },
                    {
                        id: 1,
                        created_at: '2026-08-10T12:00:00',
                        duration: 0,
                        location: 'wrld_a:1',
                        worldId: 'wrld_a',
                        worldName: 'First World',
                        groupName: '',
                        remote: false,
                        playerDurationRows: [
                            {
                                displayName: 'Carol',
                                userId: 'usr_carol',
                                time: 60_000
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

        const sections = view.container.querySelectorAll('section');
        expect(sections).toHaveLength(2);
        expect(
            within(sections[0] as HTMLElement).getByText(/2 players · 2 videos/)
        ).not.toBeNull();
        expect(
            within(sections[1] as HTMLElement).getByText(/1 players/)
        ).not.toBeNull();
    });

    it('labels remote sessions as another device without an expand toggle', () => {
        const session = {
            created_at: '2026-08-10T12:00:00',
            duration: 60_000,
            worldId: 'wrld_a',
            groupName: '',
            playerDurationRows: [],
            events: []
        };
        render(
            <GameLogSessionsView
                isGameRunning={false}
                defaultOpen={false}
                sessionOpenOverrides={new Map()}
                onSessionOpenChange={vi.fn()}
                sessions={[
                    {
                        ...session,
                        id: 2,
                        location: 'wrld_a:2',
                        worldName: 'Quest World',
                        remote: true
                    },
                    {
                        ...session,
                        id: 1,
                        location: 'wrld_a:1',
                        worldName: 'PC World',
                        remote: false
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

        expect(
            screen.getAllByText('view.game_log.sessions.other_device')
        ).toHaveLength(1);
        expect(
            screen.getAllByRole('button', {
                name: 'view.game_log.sessions.expand_session'
            })
        ).toHaveLength(1);
    });
});
