// @vitest-environment jsdom

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PresenceView } from '@/domain/friends/presence';
import type { FriendRecord } from '@/domain/friends/types';
import { getFriendsLocationsDensityConfig } from '@/features/friends/friendsLocationsDensity';
import { useFriendLocationTimeStore } from '@/state/friendLocationTimeStore';
import { usePreferencesStore } from '@/state/preferencesStore';
import {
    offlinePresence,
    onlinePresence,
    pendingPresence,
    travelingPresence
} from '@/test/presenceFixtures';

import type { FriendLocationCardLocationModel } from './FriendLocationCard';

vi.mock('@/components/Location', () => ({
    Location: () => <span />
}));

vi.mock('./FriendLocationCard', () => ({
    FriendLocationCard: ({
        location,
        presentation,
        capabilities
    }: {
        location?: FriendLocationCardLocationModel;
        presentation?: {
            showAvatarFrame?: boolean;
            showNameplate?: boolean;
        };
        capabilities?: {
            useLocation?: boolean;
            sendInvite?: boolean;
            requestInvite?: boolean;
            boop?: boolean;
        };
    }) => (
        <span
            data-timer-location={String(location?.timerLocation ?? '')}
            data-location={location?.raw}
            data-source={location?.source}
            data-can-use-location={String(Boolean(capabilities?.useLocation))}
            data-can-send-invite={String(Boolean(capabilities?.sendInvite))}
            data-can-request-invite={String(
                Boolean(capabilities?.requestInvite)
            )}
            data-can-boop={String(Boolean(capabilities?.boop))}
            data-show-avatar-frame={String(
                Boolean(presentation?.showAvatarFrame)
            )}
            data-show-nameplate={String(Boolean(presentation?.showNameplate))}
        />
    )
}));

import {
    FriendsLocationCardItem,
    FriendsLocationsCollapsibleGroupHeader,
    FriendsLocationsSectionHeader
} from './FriendsLocationsViewParts';

function friendAt(place: string | PresenceView): FriendRecord {
    return {
        id: 'usr_friend',
        displayName: 'Friend',
        tags: [],
        $presence: typeof place === 'string' ? onlinePresence(place) : place,
        $trustLevel: '',
        $friendNumber: 0,
        $trustClass: '',
        $trustSortNum: 0,
        $isModerator: false,
        $isTroll: false,
        $isProbableTroll: false,
        $platform: ''
    };
}

describe('FriendsLocations section headings', () => {
    afterEach(cleanup);

    it('keeps static headings static and exposes the collapsible group state', () => {
        const section = {
            key: 'private',
            groupKey: 'private',
            title: 'Private rooms',
            description: '',
            friends: [friendAt('private')],
            worldId: '',
            groupId: '',
            collapsed: false
        };
        const onToggle = vi.fn();
        const { getByRole, getByText, queryByRole, rerender } = render(
            <FriendsLocationsSectionHeader
                section={section}
                onOpenWorld={vi.fn()}
                onOpenGroup={vi.fn()}
            />
        );
        expect(getByText('Private rooms')).toBeTruthy();
        expect(getByText('1')).toBeTruthy();
        expect(queryByRole('button')).toBeNull();

        rerender(
            <FriendsLocationsCollapsibleGroupHeader
                section={section}
                onToggle={onToggle}
            />
        );
        const header = getByRole('button', { name: 'Private rooms 1' });
        expect(header.getAttribute('aria-expanded')).toBe('true');
        fireEvent.click(header);
        expect(onToggle).toHaveBeenCalledWith('private');

        rerender(
            <FriendsLocationsCollapsibleGroupHeader
                section={{ ...section, collapsed: true }}
                onToggle={onToggle}
            />
        );
        expect(header.getAttribute('aria-expanded')).toBe('false');
    });
});

describe('FriendsLocationCardItem', () => {
    afterEach(() => {
        cleanup();
        useFriendLocationTimeStore.getState().reset();
    });

    it.each([
        ['offline', offlinePresence],
        ['traveling', travelingPresence('wrld_remote:2')],
        ['wrld_remote:2', onlinePresence('wrld_remote:2')]
    ])(
        'uses the local location and timer over remote %s until the local mode ends',
        (remoteLocation, remotePresence) => {
            const location = 'wrld_local:1';
            const friend = friendAt(remotePresence);
            useFriendLocationTimeStore.getState().replaceSnapshot([
                {
                    userId: friend.id,
                    location,
                    sinceMs: 1_000,
                    source: 'gameLog'
                }
            ]);
            const { container } = render(
                <FriendsLocationCardItem
                    friend={friend}
                    currentUserId="usr_self"
                    densityConfig={getFriendsLocationsDensityConfig('compact')}
                    canUseFriendLocation={() => true}
                    canSendInvite
                    canBoop
                    onOpenUser={vi.fn()}
                    onOpenWorld={vi.fn()}
                    onLaunchLocation={vi.fn()}
                    onSelfInviteLocation={vi.fn()}
                    onSendInvite={vi.fn()}
                    onRequestInvite={vi.fn()}
                    onSendBoop={vi.fn()}
                />
            );
            const card = container.querySelector('[data-timer-location]');
            expect(card?.getAttribute('data-timer-location')).toBe(location);
            expect(card?.getAttribute('data-location')).toBe(location);
            expect(card?.getAttribute('data-source')).toBe('gameLog');

            act(() =>
                useFriendLocationTimeStore.getState().replaceSnapshot([
                    {
                        userId: friend.id,
                        location:
                            remoteLocation === 'offline'
                                ? 'offline'
                                : 'wrld_remote:2',
                        sinceMs: remoteLocation === 'offline' ? null : 10_000,
                        source: 'realtime'
                    }
                ])
            );
            expect(card?.getAttribute('data-timer-location')).toBe(
                remoteLocation === 'offline' ? 'offline' : 'wrld_remote:2'
            );
            expect(card?.getAttribute('data-source')).toBe('realtime');
        }
    );

    it('does not offer to join the destination of a traveling friend', () => {
        const destination = 'wrld_dest:1';
        const { container } = render(
            <FriendsLocationCardItem
                friend={friendAt(travelingPresence(destination))}
                currentUserId="usr_self"
                densityConfig={getFriendsLocationsDensityConfig('compact')}
                canUseFriendLocation={(location) => location === destination}
                canSendInvite
                canBoop
                onOpenUser={vi.fn()}
                onOpenWorld={vi.fn()}
                onLaunchLocation={vi.fn()}
                onSelfInviteLocation={vi.fn()}
                onSendInvite={vi.fn()}
                onRequestInvite={vi.fn()}
                onSendBoop={vi.fn()}
            />
        );

        const card = container.querySelector('[data-can-use-location]');
        expect(card?.getAttribute('data-can-use-location')).toBe('false');
    });

    it('passes the stay clock room to the shared card timer', () => {
        const location = 'wrld_test:123';
        const friend = friendAt(location);
        useFriendLocationTimeStore.getState().replaceSnapshot([
            {
                userId: friend.id,
                location,
                sinceMs: 1_000,
                source: 'realtime'
            }
        ]);
        const { container } = render(
            <FriendsLocationCardItem
                friend={friend}
                currentUserId="usr_self"
                densityConfig={getFriendsLocationsDensityConfig('compact')}
                canUseFriendLocation={() => true}
                canSendInvite
                canBoop
                onOpenUser={vi.fn()}
                onOpenWorld={vi.fn()}
                onLaunchLocation={vi.fn()}
                onSelfInviteLocation={vi.fn()}
                onSendInvite={vi.fn()}
                onRequestInvite={vi.fn()}
                onSendBoop={vi.fn()}
            />
        );

        const card = container.querySelector('[data-timer-location]');
        expect(card?.getAttribute('data-timer-location')).toBe(location);
        expect(card?.getAttribute('data-can-use-location')).toBe('true');
        expect(card?.getAttribute('data-can-send-invite')).toBe('true');
        expect(card?.getAttribute('data-can-request-invite')).toBe('true');
        expect(card?.getAttribute('data-can-boop')).toBe('true');
    });

    it('withholds the location for an online friend with a hidden presence location', () => {
        const friend = friendAt('private');
        const html = renderToStaticMarkup(
            <FriendsLocationCardItem
                friend={friend}
                currentUserId="usr_self"
                densityConfig={getFriendsLocationsDensityConfig('compact')}
                canUseFriendLocation={() => false}
                canSendInvite
                canBoop
                onOpenUser={vi.fn()}
                onOpenWorld={vi.fn()}
                onLaunchLocation={vi.fn()}
                onSelfInviteLocation={vi.fn()}
                onSendInvite={vi.fn()}
                onRequestInvite={vi.fn()}
                onSendBoop={vi.fn()}
            />
        );

        expect(html).toContain('data-can-use-location="false"');
    });

    it('withholds invite requests while the friend is pending offline', () => {
        const friend = friendAt(pendingPresence('private'));
        const html = renderToStaticMarkup(
            <FriendsLocationCardItem
                friend={friend}
                currentUserId="usr_self"
                densityConfig={getFriendsLocationsDensityConfig('compact')}
                canUseFriendLocation={() => false}
                canSendInvite
                canBoop
                onOpenUser={vi.fn()}
                onOpenWorld={vi.fn()}
                onLaunchLocation={vi.fn()}
                onSelfInviteLocation={vi.fn()}
                onSendInvite={vi.fn()}
                onRequestInvite={vi.fn()}
                onSendBoop={vi.fn()}
            />
        );

        expect(html).toContain('data-can-request-invite="false"');
    });

    it('disables every social and location action for the current user', () => {
        const location = 'wrld_test:123';
        const friend = friendAt(location);
        const html = renderToStaticMarkup(
            <FriendsLocationCardItem
                friend={friend}
                currentUserId={friend.id}
                densityConfig={getFriendsLocationsDensityConfig('compact')}
                canUseFriendLocation={() => true}
                canSendInvite
                canBoop
                onOpenUser={vi.fn()}
                onOpenWorld={vi.fn()}
                onLaunchLocation={vi.fn()}
                onSelfInviteLocation={vi.fn()}
                onSendInvite={vi.fn()}
                onRequestInvite={vi.fn()}
                onSendBoop={vi.fn()}
            />
        );

        expect(html).toContain('data-can-use-location="false"');
        expect(html).toContain('data-can-send-invite="false"');
        expect(html).toContain('data-can-request-invite="false"');
        expect(html).toContain('data-can-boop="false"');
    });

    it('applies the friends view decoration preferences to the card', () => {
        const location = 'wrld_test:123';
        const friend = friendAt(location);
        const renderCard = () =>
            render(
                <FriendsLocationCardItem
                    friend={friend}
                    currentUserId="usr_self"
                    densityConfig={getFriendsLocationsDensityConfig('compact')}
                    canUseFriendLocation={() => true}
                    canSendInvite
                    canBoop
                    onOpenUser={vi.fn()}
                    onOpenWorld={vi.fn()}
                    onLaunchLocation={vi.fn()}
                    onSelfInviteLocation={vi.fn()}
                    onSendInvite={vi.fn()}
                    onRequestInvite={vi.fn()}
                    onSendBoop={vi.fn()}
                />
            ).container.innerHTML;

        const defaults = renderCard();
        cleanup();
        expect(defaults).toContain('data-show-avatar-frame="true"');
        expect(defaults).toContain('data-show-nameplate="false"');

        usePreferencesStore.setState({
            showFriendsLocationsPeopleAvatarFrame: false,
            showFriendsLocationsPeopleNameplate: true
        });
        try {
            const toggled = renderCard();
            expect(toggled).toContain('data-show-avatar-frame="false"');
            expect(toggled).toContain('data-show-nameplate="true"');
        } finally {
            usePreferencesStore.setState({
                showFriendsLocationsPeopleAvatarFrame: true,
                showFriendsLocationsPeopleNameplate: false
            });
        }
    });
});
