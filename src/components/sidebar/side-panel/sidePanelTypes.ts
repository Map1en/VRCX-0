import type { FriendSortMethod } from '@/shared/utils/friend';
import type { FavoriteLoadStatus } from '@/state/favoriteStoreTypes';

import type { SidebarPreferences } from '../friends-sidebar/friendsSidebarModel';
import type {
    SidebarTabDisplayMode,
    SidebarTabLayout,
    SidebarTabLayoutItem
} from './sidebarTabLayout';

export type SidePanelSortMethod = FriendSortMethod | '';

export type SidePanelPreferences = Required<
    Pick<
        SidebarPreferences,
        | 'isShowCurrentUserInSameInstance'
        | 'isHideFriendsInSameInstance'
        | 'isSameInstanceAboveFavorites'
        | 'isSidebarDivideByFriendGroup'
        | 'sidebarFavoriteGroupOrder'
        | 'sidebarFavoriteGroups'
        | 'sidebarGroupByInstance'
    >
> & {
    sidebarSortMethod1: SidePanelSortMethod;
    sidebarSortMethod2: SidePanelSortMethod;
    sidebarSortMethod3: SidePanelSortMethod;
    sidebarTabDisplayMode: SidebarTabDisplayMode;
    sidebarTabLayout: SidebarTabLayout;
};

export type SidePanelBooleanPreferenceKey =
    | 'isShowCurrentUserInSameInstance'
    | 'isHideFriendsInSameInstance'
    | 'isSameInstanceAboveFavorites'
    | 'isSidebarDivideByFriendGroup'
    | 'sidebarGroupByInstance';

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
    title: string;
    icon: string;
    layoutItem: SidebarTabLayoutItem;
};

export type SidePanelFavoriteLoadStatus = FavoriteLoadStatus;
