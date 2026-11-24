import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getString: vi.fn(),
    setString: vi.fn()
}));

vi.mock('@/repositories/configRepository', () => ({
    default: {
        getString: mocks.getString,
        setString: mocks.setString
    }
}));

const WORLD_ID = 'wrld_11111111-1111-1111-1111-111111111111';
const FAVORITE_TAB = {
    id: 'favorite-a',
    type: 'favoriteCollection',
    name: 'Close friends',
    icon: 'lucide:UserStar',
    visible: true,
    sourceGroupKeys: []
};

async function loadStore(savedLayout: unknown[]) {
    vi.resetModules();
    mocks.getString.mockResolvedValue(JSON.stringify(savedLayout));
    const service = await import('./sidebarTabService');
    const store = await import('@/state/sidebarTabStore');
    return { ...service, ...store };
}

function savedLayout() {
    const [, value] = mocks.setString.mock.lastCall ?? [];
    return JSON.parse(String(value)) as Array<Record<string, unknown>>;
}

describe('pinning a world to the sidebar', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.setString.mockResolvedValue(null);
    });

    it('adds the world tab after the tabs saved earlier, selects it, and saves the layout', async () => {
        const store = await loadStore([FAVORITE_TAB]);

        await store.pinWorldRoomsTab({ worldId: WORLD_ID, name: 'Karaoke' });

        const { tabLayout, activeTab } = store.useSidebarTabStore.getState();
        const worldTab = tabLayout.at(-1);
        expect(tabLayout.map((item) => item.id)).toEqual([
            'friends',
            'favorite-a',
            'groups',
            worldTab?.id
        ]);
        expect(worldTab).toMatchObject({
            type: 'worldRooms',
            worldId: WORLD_ID,
            name: 'Karaoke',
            visible: true
        });
        expect(activeTab).toBe(worldTab?.id);
        expect(savedLayout().map((item) => item.id)).toEqual(
            tabLayout.map((item) => item.id)
        );
    });

    it('selects the existing tab when the world is pinned again', async () => {
        const store = await loadStore([]);
        await store.pinWorldRoomsTab({ worldId: WORLD_ID, name: 'Karaoke' });
        const firstTabId = store.useSidebarTabStore.getState().activeTab;
        store.setSidebarActiveTab('friends');

        await store.pinWorldRoomsTab({ worldId: WORLD_ID, name: 'Karaoke' });

        const { tabLayout, activeTab } = store.useSidebarTabStore.getState();
        expect(activeTab).toBe(firstTabId);
        expect(
            tabLayout.filter((item) => item.type === 'worldRooms')
        ).toHaveLength(1);
    });

    it('shows the world tab again when it was hidden', async () => {
        const store = await loadStore([
            {
                id: 'world-karaoke',
                type: 'worldRooms',
                worldId: WORLD_ID,
                name: 'Karaoke',
                visible: false
            }
        ]);

        await store.pinWorldRoomsTab({ worldId: WORLD_ID, name: 'Karaoke' });

        expect(
            store.useSidebarTabStore
                .getState()
                .tabLayout.find((item) => item.id === 'world-karaoke')
        ).toMatchObject({ visible: true });
        expect(store.useSidebarTabStore.getState().activeTab).toBe(
            'world-karaoke'
        );
    });

    it('reports a failure when the layout cannot be saved', async () => {
        const store = await loadStore([]);
        mocks.setString.mockRejectedValue(new Error('disk full'));

        await expect(
            store.pinWorldRoomsTab({ worldId: WORLD_ID, name: 'Karaoke' })
        ).rejects.toThrow('disk full');
    });
});

describe('unpinning a world from the sidebar', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.setString.mockResolvedValue(null);
    });

    it('removes only that world tab and saves the layout', async () => {
        const store = await loadStore([
            FAVORITE_TAB,
            {
                id: 'world-karaoke',
                type: 'worldRooms',
                worldId: WORLD_ID,
                name: 'Karaoke'
            }
        ]);

        await store.unpinWorldRoomsTab(WORLD_ID);

        const ids = store.useSidebarTabStore
            .getState()
            .tabLayout.map((item) => item.id);
        expect(ids).toEqual(['friends', 'favorite-a', 'groups']);
        expect(savedLayout().map((item) => item.id)).toEqual(ids);
    });

    it('does not leave the removed tab selected', async () => {
        const store = await loadStore([]);
        await store.pinWorldRoomsTab({ worldId: WORLD_ID, name: 'Karaoke' });

        await store.unpinWorldRoomsTab(WORLD_ID);

        expect(store.useSidebarTabStore.getState().activeTab).toBe('friends');
    });
});

describe('customizing sidebar tabs', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.setString.mockResolvedValue(null);
    });

    it('keeps the customized layout over a saved layout that finishes loading later', async () => {
        const store = await loadStore([FAVORITE_TAB]);
        const customized = store.useSidebarTabStore
            .getState()
            .tabLayout.map((item) =>
                item.id === 'groups' ? { ...item, visible: false } : item
            );

        const hydration = store.hydrateSidebarTabLayout();
        await store.saveSidebarTabLayout(customized);
        await hydration;

        const visibility = (layout: Array<{ id: string; visible: unknown }>) =>
            layout.map((item) => [item.id, item.visible]);
        expect(
            visibility(store.useSidebarTabStore.getState().tabLayout)
        ).toEqual([
            ['friends', true],
            ['groups', false]
        ]);
        expect(
            visibility(savedLayout() as Array<{ id: string; visible: unknown }>)
        ).toEqual([
            ['friends', true],
            ['groups', false]
        ]);
    });
});

describe('hydrating the saved sidebar layout', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.setString.mockResolvedValue(null);
    });

    it('reads the saved layout once for every caller', async () => {
        const store = await loadStore([FAVORITE_TAB]);

        await Promise.all([
            store.hydrateSidebarTabLayout(),
            store.hydrateSidebarTabLayout()
        ]);
        await store.hydrateSidebarTabLayout();

        expect(mocks.getString).toHaveBeenCalledOnce();
        expect(mocks.getString).toHaveBeenCalledWith('sidebarTabLayout', '[]');
        expect(store.useSidebarTabStore.getState()).toMatchObject({
            tabLayoutHydrated: true
        });
        expect(
            store.useSidebarTabStore.getState().tabLayout.map((item) => item.id)
        ).toEqual(['friends', 'favorite-a', 'groups']);
    });

    it('retries reading the layout after a failed read', async () => {
        const store = await loadStore([]);
        mocks.getString
            .mockRejectedValueOnce(new Error('IPC failed'))
            .mockResolvedValueOnce(JSON.stringify([FAVORITE_TAB]));

        await expect(store.hydrateSidebarTabLayout()).rejects.toThrow(
            'IPC failed'
        );
        expect(store.useSidebarTabStore.getState().tabLayoutHydrated).toBe(
            false
        );

        await store.hydrateSidebarTabLayout();

        expect(mocks.getString).toHaveBeenCalledTimes(2);
        expect(store.useSidebarTabStore.getState().tabLayoutHydrated).toBe(
            true
        );
    });

    it('normalizes a saved layout before mirroring and persisting it', async () => {
        const store = await loadStore([]);

        await store.saveSidebarTabLayout([]);

        const ids = store.useSidebarTabStore
            .getState()
            .tabLayout.map((item) => item.id);
        expect(ids).toEqual(['friends', 'groups']);
        expect(store.useSidebarTabStore.getState().tabLayoutHydrated).toBe(
            true
        );
        expect(mocks.setString).toHaveBeenCalledWith(
            'sidebarTabLayout',
            expect.any(String)
        );
        expect(savedLayout().map((item) => item.id)).toEqual(ids);
    });
});
