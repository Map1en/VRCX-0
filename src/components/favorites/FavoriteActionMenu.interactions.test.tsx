// @vitest-environment jsdom

import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor
} from '@testing-library/react';
import { createContext, useContext } from 'react';
import type { PropsWithChildren, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FavoriteKind } from '@/domain/favorites/types';

const mocks = vi.hoisted(() => ({
    addFavorite: vi.fn(),
    addLocalFavorite: vi.fn(),
    createLocalFavoriteGroup: vi.fn(),
    deleteFavorite: vi.fn(),
    favoriteState: {} as Record<string, unknown>,
    prompt: vi.fn()
}));

vi.mock('@/components/favorites/useLocalWorldFavorites', () => ({
    useLocalWorldFavorites: () => ({
        favoritesByGroup: {},
        groupNames: [],
        reload: vi.fn(),
        status: 'ready'
    })
}));

vi.mock('@/repositories/favoritePersistenceRepository', () => ({
    default: {
        addLocalFavorite: mocks.addLocalFavorite,
        createLocalFavoriteGroup: mocks.createLocalFavoriteGroup,
        removeLocalFavorite: vi.fn()
    }
}));

vi.mock('@/repositories/vrchatFavoriteRepository', () => ({
    default: {
        addFavorite: mocks.addFavorite,
        deleteFavorite: mocks.deleteFavorite
    }
}));

vi.mock('@/services/favoriteAvatarCacheService', () => ({
    persistAvatarDetails: vi.fn()
}));

vi.mock('@/services/favoriteWorldCacheService', () => ({
    persistWorldDetails: vi.fn()
}));

vi.mock('@/state/favoriteStore', () => ({
    useFavoriteStore: <T,>(selector: (state: FavoriteStoreState) => T) =>
        selector({
            favoriteAvatarGroups: [],
            favoriteFriendGroups: [],
            favoriteWorldGroups: [],
            localAvatarFavoriteGroups: [],
            localAvatarFavorites: {},
            localFriendFavoriteGroups: [],
            localFriendFavorites: {},
            remoteFavoritesByObjectId: {},
            ...mocks.favoriteState
        })
}));

vi.mock('@/state/modalStore', () => ({
    useModalStore: <T,>(selector: (state: ModalStoreState) => T) =>
        selector({ prompt: mocks.prompt })
}));

vi.mock('@/ui/shadcn/button', () => ({
    Button: ({
        children,
        size: _size,
        variant: _variant,
        ...props
    }: PropsWithChildren<{ size?: unknown; variant?: unknown }>) => (
        <button {...props}>{children}</button>
    )
}));

vi.mock('@/ui/shadcn/dropdown-menu', () => {
    const Container = ({ children }: PropsWithChildren) => (
        <div>{children}</div>
    );
    const GroupContext = createContext(false);
    const Group = ({ children }: PropsWithChildren) => (
        <GroupContext.Provider value>{children}</GroupContext.Provider>
    );
    const Label = ({ children }: PropsWithChildren) => {
        if (!useContext(GroupContext)) {
            throw new Error('MenuGroupContext is missing');
        }
        return <div>{children}</div>;
    };
    const Item = ({
        children,
        closeOnClick: _closeOnClick,
        variant: _variant,
        ...props
    }: PropsWithChildren<{ closeOnClick?: boolean; variant?: unknown }>) => (
        <button {...props}>{children}</button>
    );

    const CheckboxItem = ({
        children,
        checked,
        disabled,
        onCheckedChange
    }: PropsWithChildren<{
        checked?: boolean;
        disabled?: boolean;
        onCheckedChange?: (checked: boolean) => void;
    }>) => (
        <button
            role="menuitemcheckbox"
            aria-checked={Boolean(checked)}
            disabled={disabled}
            onClick={() => onCheckedChange?.(!checked)}
        >
            {children}
        </button>
    );

    return {
        DropdownMenu: Container,
        DropdownMenuCheckboxItem: CheckboxItem,
        DropdownMenuContent: Container,
        DropdownMenuGroup: Group,
        DropdownMenuItem: Item,
        DropdownMenuLabel: Label,
        DropdownMenuSeparator: () => <hr />,
        DropdownMenuSub: Container,
        DropdownMenuSubContent: Container,
        DropdownMenuSubTrigger: Item,
        DropdownMenuTrigger: ({
            render,
            children,
            ...props
        }: PropsWithChildren<{ render?: ReactNode }>) =>
            render ?? <button {...props}>{children}</button>
    };
});

vi.mock('@/ui/shadcn/spinner', () => ({
    Spinner: () => <span />
}));

import {
    FavoriteActionMenu,
    FavoriteActionSub,
    FavoriteBadgeMenu
} from './FavoriteActionMenu';

type FavoriteStoreState = {
    favoriteAvatarGroups: [];
    favoriteFriendGroups: [];
    favoriteWorldGroups: [];
    localAvatarFavoriteGroups: [];
    localAvatarFavorites: {};
    localFriendFavoriteGroups: [];
    localFriendFavorites: {};
    remoteFavoritesByObjectId: {};
};

type ModalStoreState = {
    prompt: typeof mocks.prompt;
};

describe('FavoriteActionMenu local group creation', () => {
    beforeEach(() => {
        mocks.addLocalFavorite.mockReset().mockResolvedValue(1);
        mocks.createLocalFavoriteGroup.mockReset().mockResolvedValue(undefined);
        mocks.prompt.mockReset().mockResolvedValue({
            ok: true,
            value: 'Frequently used'
        });
    });

    afterEach(() => {
        cleanup();
    });

    it.each<[FavoriteKind, string]>([
        ['friend', 'usr_friend'],
        ['world', 'wrld_world'],
        ['avatar', 'avtr_avatar']
    ])(
        'creates a local %s group and adds the current entity',
        async (kind, entityId) => {
            render(
                <FavoriteActionMenu
                    kind={kind}
                    entityId={entityId}
                    entity={{ id: entityId, name: entityId }}
                    iconOnly
                />
            );

            fireEvent.click(
                screen.getByRole('button', {
                    name: 'view.favorite.worlds.new_group'
                })
            );

            await waitFor(() =>
                expect(mocks.createLocalFavoriteGroup).toHaveBeenCalledWith({
                    kind,
                    groupName: 'Frequently used'
                })
            );
            expect(mocks.addLocalFavorite).toHaveBeenCalledWith({
                kind,
                entityId,
                groupName: 'Frequently used'
            });
        }
    );
});

vi.mock('@/services/toastService', () => ({
    toast: { add: vi.fn(), close: vi.fn() }
}));

describe('FavoriteActionMenu VRChat favorite groups', () => {
    const groups = [
        {
            key: 'friend:group_0',
            name: 'group_0',
            type: 'friend',
            displayName: 'Best Friends',
            count: 1,
            capacity: 150
        },
        {
            key: 'friend:group_1',
            name: 'group_1',
            type: 'friend',
            displayName: 'Karaoke',
            count: 0,
            capacity: 150
        }
    ];

    function openMenu(favoritedIn: string | null) {
        mocks.favoriteState = {
            favoriteFriendGroups: groups,
            remoteFavoritesByObjectId: favoritedIn
                ? {
                      usr_friend: {
                          type: 'friend',
                          tags: [favoritedIn],
                          $groupKey: `friend:${favoritedIn}`
                      }
                  }
                : {}
        };
        render(
            <FavoriteActionMenu
                kind="friend"
                entityId="usr_friend"
                entity={{ id: 'usr_friend', displayName: 'Alice' }}
            />
        );
    }

    function groupItem(name: string) {
        return screen.getByRole('menuitemcheckbox', {
            name: new RegExp(`^${name} `)
        });
    }

    beforeEach(() => {
        mocks.addFavorite.mockReset().mockResolvedValue({});
        mocks.deleteFavorite.mockReset().mockResolvedValue({});
    });

    afterEach(() => {
        cleanup();
        mocks.favoriteState = {};
    });

    it('checks the group the entity is favorited in', () => {
        openMenu('group_0');

        expect(groupItem('Best Friends').getAttribute('aria-checked')).toBe(
            'true'
        );
        expect(groupItem('Karaoke').getAttribute('aria-checked')).toBe('false');
    });

    it('unfavorites when the checked group is clicked', async () => {
        openMenu('group_0');

        fireEvent.click(groupItem('Best Friends'));

        await waitFor(() =>
            expect(mocks.deleteFavorite).toHaveBeenCalledWith({
                objectId: 'usr_friend'
            })
        );
        expect(mocks.addFavorite).not.toHaveBeenCalled();
    });

    it('moves the favorite to another group in one action', async () => {
        openMenu('group_0');

        fireEvent.click(groupItem('Karaoke'));

        await waitFor(() =>
            expect(mocks.addFavorite).toHaveBeenCalledWith({
                type: 'friend',
                favoriteId: 'usr_friend',
                tags: 'group_1'
            })
        );
        expect(mocks.deleteFavorite).toHaveBeenCalledWith({
            objectId: 'usr_friend'
        });
        expect(mocks.deleteFavorite.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.addFavorite.mock.invocationCallOrder[0]
        );
    });

    it('adds the favorite to the clicked group when it is not favorited yet', async () => {
        openMenu(null);

        fireEvent.click(groupItem('Karaoke'));

        await waitFor(() =>
            expect(mocks.addFavorite).toHaveBeenCalledWith({
                type: 'friend',
                favoriteId: 'usr_friend',
                tags: 'group_1'
            })
        );
        expect(mocks.deleteFavorite).not.toHaveBeenCalled();
    });

    it('shows the badge only once favorited and names the group on it', () => {
        mocks.favoriteState = {
            favoriteFriendGroups: groups,
            remoteFavoritesByObjectId: {}
        };
        const { rerender } = render(
            <FavoriteBadgeMenu kind="friend" entityId="usr_friend" />
        );
        expect(
            screen.queryByRole('button', {
                name: 'view.favorite.label.favorited'
            })
        ).toBeNull();

        mocks.favoriteState = {
            favoriteFriendGroups: groups,
            remoteFavoritesByObjectId: {
                usr_friend: {
                    type: 'friend',
                    tags: ['group_0'],
                    $groupKey: 'friend:group_0'
                }
            }
        };
        rerender(<FavoriteBadgeMenu kind="friend" entityId="usr_friend" />);

        expect(
            screen
                .getByRole('button', { name: 'view.favorite.label.favorited' })
                .getAttribute('title')
        ).toBe('Best Friends');
    });

    it('favorites from the more-actions submenu', async () => {
        mocks.favoriteState = {
            favoriteFriendGroups: groups,
            remoteFavoritesByObjectId: {}
        };
        render(<FavoriteActionSub kind="friend" entityId="usr_friend" />);

        fireEvent.click(groupItem('Karaoke'));

        await waitFor(() =>
            expect(mocks.addFavorite).toHaveBeenCalledWith({
                type: 'friend',
                favoriteId: 'usr_friend',
                tags: 'group_1'
            })
        );
    });
});
