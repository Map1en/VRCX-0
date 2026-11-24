import { create } from 'zustand';

import {
    DEFAULT_SIDEBAR_TAB_LAYOUT,
    type SidebarTabLayout
} from '@/shared/utils/sidebarTabLayout';

type SidebarTabState = {
    tabLayout: SidebarTabLayout;
    tabLayoutHydrated: boolean;
    activeTab: string;
};

export const useSidebarTabStore = create<SidebarTabState>(() => ({
    tabLayout: DEFAULT_SIDEBAR_TAB_LAYOUT,
    tabLayoutHydrated: false,
    activeTab: 'friends'
}));

export function setSidebarTabLayout(tabLayout: SidebarTabLayout) {
    useSidebarTabStore.setState({ tabLayout, tabLayoutHydrated: true });
}

export function setSidebarActiveTab(activeTab: string) {
    useSidebarTabStore.setState({ activeTab });
}
