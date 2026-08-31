// @vitest-environment jsdom

import { act, cleanup, render } from '@testing-library/react';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { FriendRecord } from '@/domain/friends/types';
import { getFriendsLocationsDensityConfig } from '@/features/friends/friendsLocationsDensity';
import { useFriendLocationTimeStore } from '@/state/friendLocationTimeStore';

import type { FriendLocationCardLocationModel } from './FriendLocationCard';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key })
}));

vi.mock('@/components/Location', () => ({
    Location: () => <span />
}));

vi.mock('./FriendLocationCard', () => ({
    FriendLocationCard: ({
        location,
        capabilities
    }: {
        location?: FriendLocationCardLocationModel;
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
            data-traveling={String(Boolean(location?.traveling))}
            data-can-use-location={String(Boolean(capabilities?.useLocation))}
            data-can-send-invite={String(Boolean(capabilities?.sendInvite))}
            data-can-request-invite={String(
                Boolean(capabilities?.requestInvite)
            )}
            data-can-boop={String(Boolean(capabilities?.boop))}
        />
    )
}));

import { FriendsLocationCardItem } from './FriendsLocationsViewParts';

function friendAt(location: string): FriendRecord {
    return {
        id: 'usr_friend',
        displayName: 'Friend',
        tags: [],
        state: 'online',
        stateBucket: 'online',
        location,
        $location_at: 1_700_000_000_000,
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

describe('FriendsLocationCardItem', () => {
    afterEach(() => {
        cleanup();
        useFriendLocationTimeStore.getState().reset();
    });

    it.each(['offline', 'traveling', 'wrld_remote:2'])(
        'uses the local location and timer over remote %s until the local mode ends',
        (remoteLocation) => {
            const location = 'wrld_local:1';
            const friend: FriendRecord & { travelingToLocation: string } = {
                ...friendAt(remoteLocation),
                state: remoteLocation === 'offline' ? 'offline' : 'online',
                travelingToLocation: 'wrld_remote:2'
            };
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
                    section={{
                        key: `instance:${location}`,
                        title: 'Local',
                        description: '',
                        friends: [friend],
                        worldId: 'wrld_local',
                        groupId: '',
                        rawLocation: location
                    }}
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
            expect(card?.getAttribute('data-traveling')).toBe('false');

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
                remoteLocation === 'offline' ? '' : 'wrld_remote:2'
            );
            expect(card?.getAttribute('data-source')).toBe('realtime');
            expect(card?.getAttribute('data-traveling')).toBe(
                String(remoteLocation === 'traveling')
            );
            expect(friend.location).toBe(remoteLocation);
        }
    );

    it('passes the resolved room to the shared card timer', () => {
        const location = 'wrld_test:123';
        const friend = friendAt(location);
        const html = renderToStaticMarkup(
            <FriendsLocationCardItem
                section={{
                    key: `instance:${location}`,
                    title: 'World',
                    description: '',
                    friends: [friend],
                    worldId: 'wrld_test',
                    groupId: '',
                    rawLocation: location
                }}
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

        expect(html).toContain('data-timer-location="wrld_test:123"');
        expect(html).toContain('data-can-use-location="true"');
        expect(html).toContain('data-can-send-invite="true"');
        expect(html).toContain('data-can-request-invite="true"');
        expect(html).toContain('data-can-boop="true"');
    });

    it('uses the section room for an online friend with a hidden presence location', () => {
        const location = 'wrld_test:123';
        const friend = friendAt('private');
        const html = renderToStaticMarkup(
            <FriendsLocationCardItem
                section={{
                    key: `instance:${location}`,
                    title: 'World',
                    description: '',
                    friends: [friend],
                    worldId: 'wrld_test',
                    groupId: '',
                    rawLocation: location
                }}
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

        expect(html).toContain('data-timer-location="wrld_test:123"');
        expect(html).toContain('data-can-use-location="false"');
    });

    it('keeps the section timer while the online friend is pending offline', () => {
        const location = 'wrld_test:123';
        const friend = {
            ...friendAt('private'),
            pendingOffline: true,
            ref: {
                location: 'private',
                pendingOffline: true
            }
        };
        const html = renderToStaticMarkup(
            <FriendsLocationCardItem
                section={{
                    key: `instance:${location}`,
                    title: 'World',
                    description: '',
                    friends: [friend],
                    worldId: 'wrld_test',
                    groupId: '',
                    rawLocation: location
                }}
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

        expect(html).toContain('data-timer-location="wrld_test:123"');
    });

    it('disables every social and location action for the current user', () => {
        const location = 'wrld_test:123';
        const friend = friendAt(location);
        const html = renderToStaticMarkup(
            <FriendsLocationCardItem
                section={{
                    key: `instance:${location}`,
                    title: 'World',
                    description: '',
                    friends: [friend],
                    worldId: 'wrld_test',
                    groupId: '',
                    rawLocation: location
                }}
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
});
