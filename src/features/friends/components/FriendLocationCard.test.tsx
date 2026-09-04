// @vitest-environment jsdom

import { cleanup, fireEvent, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { FriendRecord } from '@/domain/friends/types';
import { useFriendLocationTimeStore } from '@/state/friendLocationTimeStore';
import { useFriendRosterStore } from '@/state/friendRosterStore';

import { getFriendsLocationsDensityConfig } from '../friendsLocationsDensity';
import { FriendLocationCard } from './FriendLocationCard';

vi.mock('react-i18next', () => ({
    initReactI18next: {
        type: '3rdParty',
        init: () => {}
    },
    useTranslation: () => ({ t: (key: string) => key })
}));
vi.mock('@/components/Location', () => ({
    Location: ({ location }: { location: string }) => (
        <span data-location={location} />
    )
}));
vi.mock('@/components/user-hover-card/UserHoverCard', () => ({
    UserHoverCard: ({ children }: { children: ReactNode }) => children
}));
vi.mock('@/services/entityMediaService', () => ({ userImage: () => '' }));
vi.mock('@/components/friends/FriendInstanceTimer', () => ({
    FriendInstanceTimer: ({
        epoch,
        traveling,
        format
    }: {
        epoch: number;
        traveling: boolean;
        format: 'default' | 'short';
    }) => (
        <span
            data-epoch={epoch}
            data-traveling={String(traveling)}
            data-format={format}
        />
    )
}));

describe('FriendLocationCard presentation', () => {
    const friend: FriendRecord = {
        id: 'usr_friend',
        displayName: 'Friend',
        statusDescription: 'Exploring worlds',
        tags: [],
        state: 'online',
        stateBucket: 'online',
        location: 'wrld_test:123',
        $trustLevel: '',
        $friendNumber: 0,
        $trustClass: '',
        $trustSortNum: 0,
        $isModerator: false,
        $isTroll: false,
        $isProbableTroll: false,
        $platform: ''
    };

    afterEach(cleanup);

    it.each(['standard', 'compact', 'dense'])(
        'preserves the content modes at %s density',
        (density) => {
            const densityConfig = getFriendsLocationsDensityConfig(density);
            const { container, getByText, queryByText, rerender } = render(
                <FriendLocationCard
                    friend={friend}
                    presentation={{ density: densityConfig }}
                />
            );

            expect(getByText('Friend')).toBeTruthy();
            expect(container.querySelector('[data-location]')).not.toBeNull();
            if (density === 'dense') {
                const header = container.querySelector(
                    '[data-slot="card-header"]'
                );
                expect(
                    header?.classList.contains(
                        'w-[var(--friend-card-avatar-size)]'
                    )
                ).toBe(true);
                expect(
                    header?.parentElement?.style.getPropertyValue(
                        '--friend-card-avatar-size'
                    )
                ).toBe(`${densityConfig.avatarSize}px`);
            }
            expect(Boolean(queryByText('Exploring worlds'))).toBe(
                densityConfig.showStatusDescription
            );

            rerender(
                <FriendLocationCard
                    friend={friend}
                    presentation={{
                        density: densityConfig,
                        contentMode: 'status'
                    }}
                />
            );
            expect(container.querySelector('[data-location]')).toBeNull();
            expect(Boolean(queryByText('Exploring worlds'))).toBe(
                densityConfig.showStatusDescription
            );

            rerender(
                <FriendLocationCard
                    friend={friend}
                    presentation={{
                        density: densityConfig,
                        contentMode: 'identity'
                    }}
                />
            );
            expect(getByText('Friend')).toBeTruthy();
            expect(container.querySelector('[data-location]')).toBeNull();
            expect(queryByText('Exploring worlds')).toBeNull();
        }
    );

    it('does not reserve a description node for a friend without a signature', () => {
        const { container } = render(
            <FriendLocationCard friend={{ ...friend, statusDescription: '' }} />
        );

        expect(
            container.querySelector('[data-slot="card-description"]')
        ).toBeNull();
        expect(container.querySelector('[data-location]')).not.toBeNull();
    });

    it('keeps card keyboard activation separate from location clicks', () => {
        const openUser = vi.fn();
        const { container, getByRole } = render(
            <FriendLocationCard friend={friend} actions={{ openUser }} />
        );
        const card = getByRole('button', {
            name: 'common.actions.view_details: Friend'
        });

        fireEvent.click(card);
        fireEvent.keyDown(card, { key: 'Enter' });
        fireEvent.keyDown(card, { key: ' ' });
        expect(openUser).toHaveBeenCalledTimes(3);

        const location = container.querySelector('[data-location]');
        expect(location).not.toBeNull();
        if (location) {
            fireEvent.click(location);
            fireEvent.keyDown(location, { key: 'Enter' });
        }
        expect(openUser).toHaveBeenCalledTimes(3);
    });
});

describe('FriendLocationCard local mode', () => {
    afterEach(() => {
        cleanup();
        useFriendLocationTimeStore.getState().reset();
        useFriendRosterStore.setState({ friendsById: {} });
    });

    it.each(['offline', 'traveling', 'wrld_remote:2'])(
        'renders the local room and elapsed timer despite the raw %s ref',
        (remoteLocation) => {
            const friend: FriendRecord = {
                id: 'usr_friend',
                displayName: 'Friend',
                tags: [],
                state: remoteLocation === 'offline' ? 'offline' : 'online',
                stateBucket:
                    remoteLocation === 'offline' ? 'offline' : 'online',
                location: remoteLocation,
                $trustLevel: '',
                $friendNumber: 0,
                $trustClass: '',
                $trustSortNum: 0,
                $isModerator: false,
                $isTroll: false,
                $isProbableTroll: false,
                $platform: ''
            };
            useFriendRosterStore.setState({
                friendsById: { [friend.id]: friend }
            });
            useFriendLocationTimeStore.getState().replaceSnapshot([
                {
                    userId: friend.id,
                    location: 'wrld_local:1',
                    sinceMs: 1_000,
                    source: 'gameLog'
                }
            ]);
            const { container, rerender, getByText } = render(
                <FriendLocationCard
                    friend={{
                        ...friend,
                        ref: {
                            id: friend.id,
                            state: friend.state,
                            stateBucket: friend.state,
                            location: friend.location,
                            travelingToLocation: 'wrld_remote:2'
                        }
                    }}
                    location={{
                        raw: 'wrld_local:1',
                        timerLocation: 'wrld_local:1',
                        traveling: false,
                        source: 'gameLog'
                    }}
                />
            );
            expect(
                container
                    .querySelector('[data-location]')
                    ?.getAttribute('data-location')
            ).toBe('wrld_local:1');
            expect(
                container
                    .querySelector('[data-epoch]')
                    ?.getAttribute('data-epoch')
            ).toBe('1000');
            expect(
                container
                    .querySelector('[data-traveling]')
                    ?.getAttribute('data-traveling')
            ).toBe('false');
            for (const density of ['standard', 'compact', 'dense']) {
                rerender(
                    <FriendLocationCard
                        friend={friend}
                        location={{
                            raw: 'wrld_local:1',
                            timerLocation: 'wrld_local:1',
                            traveling: false,
                            source: 'gameLog'
                        }}
                        presentation={{
                            density: getFriendsLocationsDensityConfig(density)
                        }}
                    />
                );
                const name = getByText('Friend');
                expect(container.querySelectorAll('[data-epoch]')).toHaveLength(
                    1
                );
                expect(
                    name.parentElement
                        ?.querySelector('[data-epoch]')
                        ?.getAttribute('data-epoch')
                ).toBe('1000');
                expect(
                    name.parentElement
                        ?.querySelector('[data-epoch]')
                        ?.getAttribute('data-format')
                ).toBe(density === 'dense' ? 'short' : 'default');
                expect(name.parentElement?.classList.contains('flex-col')).toBe(
                    density !== 'dense'
                );
            }
        }
    );
});
