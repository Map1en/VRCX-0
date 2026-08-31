// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { FriendRecord } from '@/domain/friends/types';
import { useFriendLocationTimeStore } from '@/state/friendLocationTimeStore';
import { useFriendRosterStore } from '@/state/friendRosterStore';

import { FriendLocationCard } from './FriendLocationCard';

vi.mock('react-i18next', () => ({
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
        traveling
    }: {
        epoch: number;
        traveling: boolean;
    }) => <span data-epoch={epoch} data-traveling={String(traveling)} />
}));

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
            const { container } = render(
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
        }
    );
});
