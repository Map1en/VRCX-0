import type { FavoriteLoadStatus } from '@/domain/favorites/types';
import type { FriendSortMethod } from '@/shared/utils/friend';
import type { SidebarTabLayoutItem } from '@/shared/utils/sidebarTabLayout';

import type { SidebarPreferences } from '../friends-sidebar/friendsSidebarModel';

export type SidePanelSortMethod = FriendSortMethod | '';

export type SidePanelPreferences = Required<
    Pick<
        SidebarPreferences,
        | 'isHideFriendsInSameInstance'
        | 'isSameInstanceAboveFavorites'
        | 'isSidebarDivideByFriendGroup'
        | 'sidebarFavoriteGroupOrder'
        | 'sidebarFavoriteGroups'
        | 'sidebarGroupByInstance'
        | 'sidebarCompactRows'
    >
> & {
    sidebarSortMethod1: SidePanelSortMethod;
    sidebarSortMethod2: SidePanelSortMethod;
    sidebarSortMethod3: SidePanelSortMethod;
};

export type SidePanelBooleanPreferenceKey =
    | 'isHideFriendsInSameInstance'
    | 'isSameInstanceAboveFavorites'
    | 'isSidebarDivideByFriendGroup'
    | 'sidebarGroupByInstance'
    | 'sidebarCompactRows';

export type SidePanelSortPreferenceKey =
    | 'sidebarSortMethod1'
    | 'sidebarSortMethod2'
    | 'sidebarSortMethod3';

export type SidePanelArrayPreferenceKey =
    | 'sidebarFavoriteGroupOrder'
    | 'sidebarFavoriteGroups';

export type SidePanelTabItem = {
    value: string;
    label: string;
    railCountLabel: string;
    title: string;
    icon: string;
    layoutItem: SidebarTabLayoutItem;
};

export type SidePanelFavoriteLoadStatus = FavoriteLoadStatus;
