// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type QueryOptions = {
    enabled?: boolean;
    queryFn: () => Promise<unknown>;
};

type RuntimeStoreState = {
    auth: {
        currentUserEndpoint: string;
        currentUserSnapshot: null;
    };
    gameState: {
        isGameRunning: boolean;
    };
};

const mocks = vi.hoisted(() => ({
    getUserProfile: vi.fn(() => Promise.resolve({})),
    knownCreatorUser: null as Record<string, unknown> | null,
    queryData: null as Record<string, unknown> | null
}));

vi.mock('@tanstack/react-query', async (importOriginal) => {
    const actual =
        await importOriginal<typeof import('@tanstack/react-query')>();
    const { useEffect } = await import('react');
    return {
        ...actual,
        useQuery: (options: QueryOptions) => {
            useEffect(() => {
                if (options.enabled) {
                    void options.queryFn();
                }
            }, [options.enabled]);
            return { data: mocks.queryData };
        }
    };
});

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key })
}));

vi.mock('@/components/sidebar/friends-sidebar/friendsSidebarModel', () => ({
    resolveSidebarStatusDotClassName: () => ''
}));

vi.mock('@/components/UserDetailTile', () => ({
    UserDetailTile: ({
        displayName,
        imageUrl
    }: {
        displayName: unknown;
        imageUrl?: string;
    }) => (
        <div
            data-testid="user-detail-tile"
            data-display-name={
                typeof displayName === 'string' ? displayName : ''
            }
            data-image-url={imageUrl}
        />
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
    userStatusLabel: () => ''
}));

vi.mock('@/state/runtimeStore', () => ({
    useRuntimeStore: <T,>(selector: (state: RuntimeStoreState) => T): T =>
        selector({
            auth: {
                currentUserEndpoint: 'https://api.vrchat.cloud',
                currentUserSnapshot: null
            },
            gameState: {
                isGameRunning: false
            }
        })
}));

vi.mock('@/ui/shadcn/spinner', () => ({
    Spinner: () => null
}));

import { InstanceUserTiles } from './WorldDialogInstanceUsers';

describe('InstanceUserTiles', () => {
    afterEach(cleanup);

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.knownCreatorUser = null;
        mocks.queryData = null;
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

    it('filters non-friends before rendering or resolving profiles', () => {
        render(
            <InstanceUserTiles
                instance={{
                    creatorUserId: 'usr_non_friend_owner',
                    users: [
                        { id: 'usr_self', displayName: 'Self' },
                        { id: 'usr_friend', displayName: 'Friend' },
                        { id: 'usr_non_friend', displayName: 'Non-friend' }
                    ]
                }}
                visibleUserIds={new Set(['usr_self', 'usr_friend'])}
            />
        );

        expect(mocks.getUserProfile).not.toHaveBeenCalled();
        expect(
            screen
                .getAllByTestId('user-detail-tile')
                .map((tile) => tile.getAttribute('data-display-name'))
        ).toEqual(['Self', 'Friend']);
    });
});
