import type { FavoriteLoadStatus } from '@/domain/favorites/types';
import type { FriendSortMethod } from '@/shared/utils/friend';

import type { SidebarPreferences } from '../friends-sidebar/friendsSidebarModel';
import type {
    SidebarTabLayout,
    SidebarTabLayoutItem
} from './sidebarTabLayout';

export type SidePanelSortMethod = FriendSortMethod | '';

export type SidePanelPreferences = Required<
    Pick<
        SidebarPreferences,
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
    sidebarTabLayout: SidebarTabLayout;
};

export type SidePanelBooleanPreferenceKey =
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
    railCountLabel: string;
    title: string;
    icon: string;
    layoutItem: SidebarTabLayoutItem;
};

export type SidePanelFavoriteLoadStatus = FavoriteLoadStatus;
