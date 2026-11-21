// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useFriendLocationTimeStore } from '@/state/friendLocationTimeStore';
import { useFriendRosterStore } from '@/state/friendRosterStore';
import { activePresence, onlinePresence } from '@/test/presenceFixtures';

type QueryOptions = {
    enabled?: boolean;
    queryFn: () => Promise<unknown>;
};

type RuntimeStoreState = {
    auth: {
        currentUserEndpoint: string;
        currentUserSnapshot: Record<string, unknown> | null;
    };
    gameState: {
        isGameRunning: boolean;
        currentLocation: string;
        currentLocationStartedAt: string | null;
    };
};

const mocks = vi.hoisted(() => ({
    getUserProfile: vi.fn(() => Promise.resolve({})),
    knownCreatorUser: null as Record<string, unknown> | null,
    currentUserSnapshot: null as Record<string, unknown> | null,
    currentLocation: '',
    currentLocationStartedAt: null as string | null,
    queryData: null as Record<string, unknown> | null
}));

vi.mock('@tanstack/react-query', async (importOriginal) => {
    const actual =
        await importOriginal<typeof import('@tanstack/react-query')>();
    const { useEffect } = await import('react');
    return {
        ...actual,
        useQuery: (options: QueryOptions) => {
            const { enabled, queryFn } = options;
            useEffect(() => {
                if (enabled) {
                    void queryFn();
                }
            }, [enabled, queryFn]);
            return { data: mocks.queryData };
        }
    };
});

vi.mock(
    '@/components/sidebar/friends-sidebar/friendsSidebarModel',
    async (importOriginal) => ({
        ...(await importOriginal<
            typeof import('@/components/sidebar/friends-sidebar/friendsSidebarModel')
        >()),
        resolveSidebarStatusDotClassName: () => ''
    })
);

vi.mock('@/components/UserListItem', () => ({
    UserListItem: ({
        displayName,
        imageUrl,
        namePrefix,
        subline
    }: {
        displayName: unknown;
        imageUrl?: string;
        namePrefix?: ReactNode;
        subline?: ReactNode;
    }) => (
        <div
            data-testid="user-detail-tile"
            data-display-name={
                typeof displayName === 'string' ? displayName : ''
            }
            data-image-url={imageUrl}
        >
            {namePrefix}
            {subline}
        </div>
    )
}));

vi.mock('@/lib/useKnownUser', () => ({
    useKnownUserFact: () => mocks.knownCreatorUser
}));

vi.mock('@/repositories/userProfileRepository', () => ({
    default: {
        getUserProfile: mocks.getUserProfile
    }
}));

vi.mock('@/services/dialogService', () => ({
    openUserDialog: vi.fn()
}));

vi.mock('@/services/entityMediaService', () => ({
    userImage: (user: unknown) => {
        if (
            user &&
            typeof user === 'object' &&
            'thumbnailImageUrl' in user &&
            typeof user.thumbnailImageUrl === 'string'
        ) {
            return user.thumbnailImageUrl;
        }
        return '';
    }
}));

vi.mock('@/shared/utils/userStatus', () => ({
    userStatusLabel: (
        user: unknown,
        t: (key: string, options?: { defaultValue: string }) => string
    ) => {
        const presence =
            user && typeof user === 'object' && '$presence' in user
                ? user.$presence
                : null;
        const kind =
            presence && typeof presence === 'object' && 'kind' in presence
                ? String(presence.kind)
                : '';
        return kind ? t(`dialog.user.status.${kind}`) : '';
    }
}));

vi.mock('@/state/runtimeStore', () => ({
    useRuntimeStore: <T,>(selector: (state: RuntimeStoreState) => T): T =>
        selector({
            auth: {
                currentUserEndpoint: 'https://api.vrchat.cloud',
                currentUserSnapshot: mocks.currentUserSnapshot
            },
            gameState: {
                isGameRunning: false,
                currentLocation: mocks.currentLocation,
                currentLocationStartedAt: mocks.currentLocationStartedAt
            }
        })
}));

vi.mock('@/ui/shadcn/spinner', () => ({
    Spinner: () => null
}));

import { InstanceUserTiles } from './WorldDialogInstanceUsers';

describe('InstanceUserTiles', () => {
    afterEach(() => {
        cleanup();
    });

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.knownCreatorUser = null;
        mocks.queryData = null;
        mocks.currentUserSnapshot = null;
        mocks.currentLocation = '';
        mocks.currentLocationStartedAt = null;
        useFriendRosterStore.getState().resetRoster();
        useFriendLocationTimeStore.getState().reset();
    });

    it('shows the current user avatar and time in their current instance', () => {
        const location = 'wrld_test:12345~region(jp)';
        mocks.currentUserSnapshot = {
            id: 'usr_self',
            thumbnailImageUrl: 'https://images.example/self.png'
        };
        mocks.currentLocation = location;
        mocks.currentLocationStartedAt = new Date(
            Date.now() - 5 * 60_000
        ).toISOString();

        render(
            <InstanceUserTiles
                instance={{ users: [{ id: 'usr_self', displayName: 'Self' }] }}
                instanceLocation={location}
                showInstanceDuration
            />
        );

        const tile = screen.getByTestId('user-detail-tile');
        expect(tile.getAttribute('data-image-url')).toBe(
            'https://images.example/self.png'
        );
        expect(tile.textContent).toBe('5m');
    });

    it('fetches an unresolved non-friend instance creator profile', async () => {
        mocks.queryData = {
            id: 'usr_non_friend_owner',
            displayName: 'Remote Owner',
            thumbnailImageUrl: 'https://images.example/remote-owner.png'
        };

        render(
            <InstanceUserTiles
                instance={{ creatorUserId: 'usr_non_friend_owner' }}
            />
        );

        await waitFor(() => {
            expect(mocks.getUserProfile).toHaveBeenCalledWith({
                userId: 'usr_non_friend_owner'
            });
        });
        const tile = screen.getByTestId('user-detail-tile');
        expect(tile.getAttribute('data-display-name')).toBe('Remote Owner');
        expect(tile.getAttribute('data-image-url')).toBe(
            'https://images.example/remote-owner.png'
        );
    });

    it('does not refetch a creator whose known fact has display media', () => {
        mocks.knownCreatorUser = {
            id: 'usr_friend_owner',
            displayName: 'Friend Owner',
            thumbnailImageUrl: 'https://images.example/friend-owner.png'
        };

        render(
            <InstanceUserTiles
                instance={{ creatorUserId: 'usr_friend_owner' }}
            />
        );

        expect(mocks.getUserProfile).not.toHaveBeenCalled();
    });

    it('keeps the creator while filtering other non-friends', () => {
        render(
            <InstanceUserTiles
                instance={{
                    creatorUserId: 'usr_non_friend_owner',
                    creatorUser: {
                        statusDescription: 'Owner signature',
                        $location_at: 1_700_000_000_000
                    },
                    users: [
                        { id: 'usr_self', displayName: 'Self' },
                        { id: 'usr_friend', displayName: 'Friend' },
                        { id: 'usr_non_friend', displayName: 'Non-friend' }
                    ]
                }}
                visibleUserIds={new Set(['usr_self', 'usr_friend'])}
                showInstanceDuration
            />
        );

        expect(
            screen
                .getAllByTestId('user-detail-tile')
                .map((tile) => tile.getAttribute('data-display-name'))
        ).toEqual(['usr_non_friend_owner', 'Self', 'Friend']);
        const creatorTile = screen
            .getAllByTestId('user-detail-tile')
            .find(
                (tile) =>
                    tile.getAttribute('data-display-name') ===
                    'usr_non_friend_owner'
            );
        expect(creatorTile?.textContent).toContain(
            'dialog.world.instances.instance_creator'
        );
        expect(screen.queryByText('Owner signature')).toBeNull();
        expect(
            screen.getByLabelText('dialog.world.instances.instance_creator')
        ).toBeTruthy();
    });

    it('shows the timer for a friend creator', () => {
        useFriendRosterStore.getState().applyFriendPatch({
            userId: 'usr_friend_owner',
            presence: { rev: 1, view: onlinePresence('wrld_test:123') },
            patch: {
                id: 'usr_friend_owner',
                displayName: 'Friend Owner'
            }
        });
        useFriendLocationTimeStore.getState().replaceSnapshot([
            {
                userId: 'usr_friend_owner',
                location: 'wrld_test:123',
                source: 'realtime',
                sinceMs: Date.now() - 600_000
            }
        ]);
        mocks.knownCreatorUser = {
            id: 'usr_friend_owner',
            displayName: 'Friend Owner',
            isFriend: true,
            statusDescription: 'Friend signature',
            thumbnailImageUrl: 'https://images.example/friend-owner.png'
        };

        render(
            <InstanceUserTiles
                instance={{
                    creatorUserId: 'usr_friend_owner',
                    users: [
                        {
                            id: 'usr_friend_owner',
                            $presence: onlinePresence('wrld_test:123')
                        }
                    ]
                }}
                visibleUserIds={new Set(['usr_friend_owner'])}
                showInstanceDuration
            />
        );

        expect(screen.getByText('10m')).toBeTruthy();
        expect(
            screen.queryByText('dialog.world.instances.instance_creator')
        ).toBeNull();
        const tiles = screen.getAllByTestId('user-detail-tile');
        expect(tiles).toHaveLength(1);
        expect(tiles[0]?.getAttribute('data-display-name')).toBe(
            'Friend Owner'
        );
        expect(screen.queryByText('Friend signature')).toBeNull();
    });

    it('shows the Creator label instead of a status for a non-friend creator', () => {
        render(
            <InstanceUserTiles
                instance={{
                    creatorUserId: 'usr_non_friend_owner',
                    creatorUser: { $presence: activePresence() }
                }}
                visibleUserIds={new Set()}
                showInstanceDuration
            />
        );

        expect(
            screen.getByText('dialog.world.instances.instance_creator')
        ).toBeTruthy();
        expect(screen.queryByText('dialog.user.status.active')).toBeNull();
    });

    it('shows the instance timer instead of the status signature', () => {
        useFriendRosterStore.getState().applyFriendPatch({
            userId: 'usr_friend',
            presence: { rev: 1, view: onlinePresence('wrld_test:123') },
            patch: {
                id: 'usr_friend',
                displayName: 'Friend'
            }
        });
        useFriendLocationTimeStore.getState().replaceSnapshot([
            {
                userId: 'usr_friend',
                location: 'wrld_test:123',
                source: 'realtime',
                sinceMs: Date.now() - 600_000
            }
        ]);
        render(
            <InstanceUserTiles
                instance={{
                    users: [
                        {
                            id: 'usr_friend',
                            displayName: 'Friend',
                            $presence: onlinePresence('wrld_test:123'),
                            statusDescription: 'World hopping'
                        }
                    ]
                }}
                showInstanceDuration
            />
        );

        expect(screen.getByText('10m')).toBeTruthy();
        expect(screen.queryByText('World hopping')).toBeNull();
    });

    it('uses the displayed instance for an online friend with a hidden presence location', () => {
        useFriendRosterStore.getState().applyFriendPatch({
            userId: 'usr_friend',
            presence: { rev: 1, view: onlinePresence('private') },
            patch: {
                id: 'usr_friend',
                displayName: 'Friend'
            }
        });
        useFriendLocationTimeStore.getState().replaceSnapshot([
            {
                userId: 'usr_friend',
                location: 'wrld_test:123',
                source: 'realtime',
                sinceMs: Date.now() - 600_000
            }
        ]);
        render(
            <InstanceUserTiles
                instance={{
                    users: [
                        {
                            id: 'usr_friend',
                            displayName: 'Friend',
                            $presence: onlinePresence('private'),
                            statusDescription: 'Do not disturb'
                        }
                    ]
                }}
                instanceLocation="wrld_test:123"
                showInstanceDuration
            />
        );

        expect(screen.getByText('10m')).toBeTruthy();
        expect(screen.queryByText('Do not disturb')).toBeNull();
    });
});
