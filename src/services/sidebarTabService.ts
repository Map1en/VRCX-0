import configRepository from '@/repositories/configRepository';
import {
    normalizeSidebarTabLayout,
    serializeSidebarTabLayout,
    upsertWorldRoomsTab,
    type SidebarTabLayout
} from '@/shared/utils/sidebarTabLayout';
import {
    setSidebarActiveTab,
    setSidebarTabLayout,
    useSidebarTabStore
} from '@/state/sidebarTabStore';

let tabLayoutHydration: Promise<void> | null = null;

export function hydrateSidebarTabLayout() {
    tabLayoutHydration ??= configRepository
        .getString('sidebarTabLayout', '[]')
        .then((storedLayout) => {
            if (!useSidebarTabStore.getState().tabLayoutHydrated) {
                setSidebarTabLayout(normalizeSidebarTabLayout(storedLayout));
            }
        })
        .catch((error: unknown) => {
            tabLayoutHydration = null;
            throw error;
        });
    return tabLayoutHydration;
}

export function saveSidebarTabLayout(layout: SidebarTabLayout) {
    const tabLayout = normalizeSidebarTabLayout(layout);
    setSidebarTabLayout(tabLayout);
    return configRepository.setString(
        'sidebarTabLayout',
        serializeSidebarTabLayout(tabLayout)
    );
}

export async function pinWorldRoomsTab(world: {
    worldId: string;
    name: string;
}) {
    await hydrateSidebarTabLayout();
    const { layout, tabId } = upsertWorldRoomsTab(
        useSidebarTabStore.getState().tabLayout,
        world
    );
    const saving = saveSidebarTabLayout(layout);
    setSidebarActiveTab(tabId);
    await saving;
}

export async function unpinWorldRoomsTab(worldId: string) {
    await hydrateSidebarTabLayout();
    const { tabLayout, activeTab } = useSidebarTabStore.getState();
    const removedIds = new Set(
        tabLayout
            .filter(
                (item) => item.type === 'worldRooms' && item.worldId === worldId
            )
            .map((item) => item.id)
    );
    const saving = saveSidebarTabLayout(
        tabLayout.filter((item) => !removedIds.has(item.id))
    );
    if (removedIds.has(activeTab)) {
        setSidebarActiveTab('friends');
    }
    await saving;
}
