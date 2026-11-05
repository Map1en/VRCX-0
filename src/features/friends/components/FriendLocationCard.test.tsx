// @vitest-environment jsdom

import { cleanup, fireEvent, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { FriendRecord } from '@/domain/friends/types';
import { useFriendLocationTimeStore } from '@/state/friendLocationTimeStore';
import { useFriendRosterStore } from '@/state/friendRosterStore';
import {
    offlinePresence,
    onlinePresence,
    pendingPresence,
    travelingPresence
} from '@/test/presenceFixtures';

import { getFriendsLocationsDensityConfig } from '../friendsLocationsDensity';
import { FriendLocationCard } from './FriendLocationCard';

vi.mock('@/components/Location', () => ({
    Location: ({ location }: { location: string }) => (
        <span data-location={location} />
    )
}));
vi.mock('@/components/user-hover-card/UserHoverCard', () => ({
    UserHoverCard: ({ children }: { children: ReactNode }) => children
}));
vi.mock('@/services/entityMediaService', () => ({ userImage: () => '' }));
vi.mock('@/components/ProfileDecorations', () => ({
    ProfileAvatarFrame: ({
        templateId,
        active
    }: {
        templateId: string;
        active: boolean;
    }) => <span data-avatar-frame={templateId} data-active={active} />,
    ProfileNameplate: ({
        templateId,
        active
    }: {
        templateId: string;
        active: boolean;
    }) => <span data-nameplate={templateId} data-active={active} />,
    useDecorationHover: () => ({ active: false, hoverProps: {} })
}));
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
        $presence: onlinePresence('wrld_test:123'),
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

    it('labels and dims a friend who may be offline without blinking the actions', () => {
        const animate = vi.fn(() => ({ cancel: vi.fn() }));
        Object.defineProperty(HTMLElement.prototype, 'animate', {
            configurable: true,
            value: animate
        });
        const { container, getByText, queryByText } = render(
            <FriendLocationCard
                friend={{ ...friend, $presence: pendingPresence() }}
            />
        );

        expect(
            container.querySelector('[data-pending-offline]')
        ).not.toBeNull();
        expect(getByText('side_panel.pending_offline')).toBeTruthy();
        expect(queryByText('Exploring worlds')).toBeNull();
        const animated = animate.mock.contexts as unknown as Element[];
        expect(animated.length).toBeGreaterThan(0);
        expect(
            animated.some((element) => element.hasAttribute('data-dim-exempt'))
        ).toBe(false);
    });

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

    it('renders the avatar frame and nameplate independently when enabled', () => {
        const decorated = {
            ...friend,
            iconFrame: 'invt_frame',
            nameplateEffect: 'invt_plate'
        };
        const { container, rerender } = render(
            <FriendLocationCard friend={decorated} />
        );
        expect(container.querySelector('[data-avatar-frame]')).toBeNull();
        expect(container.querySelector('[data-nameplate]')).toBeNull();

        rerender(
            <FriendLocationCard
                friend={decorated}
                presentation={{ showAvatarFrame: true }}
            />
        );
        expect(
            container
                .querySelector('[data-avatar-frame]')
                ?.getAttribute('data-avatar-frame')
        ).toBe('invt_frame');
        expect(container.querySelector('[data-nameplate]')).toBeNull();

        rerender(
            <FriendLocationCard
                friend={decorated}
                presentation={{ showNameplate: true }}
            />
        );
        expect(container.querySelector('[data-avatar-frame]')).toBeNull();
        expect(
            container
                .querySelector('[data-nameplate]')
                ?.getAttribute('data-nameplate')
        ).toBe('invt_plate');
    });

    it('keeps the avatar frame and nameplate animated until the friend lands', () => {
        const decorated = {
            ...friend,
            iconFrame: 'invt_frame',
            nameplateEffect: 'invt_plate'
        };
        const presentation = { showAvatarFrame: true, showNameplate: true };
        const activeStates = (container: HTMLElement) => [
            container
                .querySelector('[data-avatar-frame]')
                ?.getAttribute('data-active'),
            container
                .querySelector('[data-nameplate]')
                ?.getAttribute('data-active')
        ];
        const { container, rerender } = render(
            <FriendLocationCard
                friend={{
                    ...decorated,
                    $presence: travelingPresence('wrld_next:1')
                }}
                presentation={presentation}
            />
        );
        expect(activeStates(container)).toEqual(['true', 'true']);

        rerender(
            <FriendLocationCard
                friend={{
                    ...decorated,
                    $presence: onlinePresence('wrld_next:1')
                }}
                presentation={presentation}
            />
        );
        expect(activeStates(container)).toEqual(['false', 'false']);
    });
});

describe('FriendLocationCard local mode', () => {
    afterEach(() => {
        cleanup();
        useFriendLocationTimeStore.getState().reset();
        useFriendRosterStore.setState({ friendsById: {} });
    });

    it.each([
        ['offline', offlinePresence],
        ['traveling', travelingPresence('wrld_remote:2')],
        ['wrld_remote:2', onlinePresence('wrld_remote:2')]
    ])(
        'renders the local room and elapsed timer despite the remote %s place',
        (_remoteLocation, remotePresence) => {
            const friend: FriendRecord = {
                id: 'usr_friend',
                displayName: 'Friend',
                tags: [],
                $presence: remotePresence,
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
                    friend={friend}
                    location={{
                        raw: 'wrld_local:1',
                        timerLocation: 'wrld_local:1',
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
            }
        }
    );
});
