// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getString: vi.fn(),
    setString: vi.fn(),
    toast: vi.fn()
}));

vi.mock('@/repositories/configRepository', () => ({
    default: { getString: mocks.getString, setString: mocks.setString }
}));
vi.mock('@/services/toastService', () => ({
    toast: { add: mocks.toast }
}));

const WORLD_ID = 'wrld_11111111-1111-1111-1111-111111111111';
const PIN = 'dialog.world.instances.pin_to_sidebar';
const UNPIN = 'dialog.world.instances.unpin_from_sidebar';

async function openDialog(savedLayout: unknown[]) {
    vi.resetModules();
    mocks.getString.mockResolvedValue(JSON.stringify(savedLayout));
    const { WorldSidebarPinButton } = await import('./WorldSidebarPinButton');
    const { useSidebarTabStore } = await import('@/state/sidebarTabStore');
    render(<WorldSidebarPinButton worldId={WORLD_ID} name="Karaoke" />);
    return useSidebarTabStore;
}

function worldTabs(store: Awaited<ReturnType<typeof openDialog>>) {
    return store
        .getState()
        .tabLayout.filter((item) => item.type === 'worldRooms');
}

beforeEach(() => {
    mocks.setString.mockResolvedValue(null);
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('world dialog sidebar pin button', () => {
    it('pins a world that is not in the sidebar', async () => {
        const store = await openDialog([]);

        fireEvent.click(await screen.findByRole('button', { name: PIN }));

        expect(await screen.findByRole('button', { name: UNPIN })).toBeTruthy();
        expect(worldTabs(store)).toMatchObject([{ worldId: WORLD_ID }]);
        expect(mocks.toast).toHaveBeenCalledWith({
            type: 'success',
            title: 'dialog.world.instances.pinned_to_sidebar'
        });
    });

    it('unpins a world that the saved sidebar already shows', async () => {
        const store = await openDialog([
            {
                id: 'world-karaoke',
                type: 'worldRooms',
                worldId: WORLD_ID,
                name: 'Karaoke'
            }
        ]);

        fireEvent.click(await screen.findByRole('button', { name: UNPIN }));

        expect(await screen.findByRole('button', { name: PIN })).toBeTruthy();
        expect(worldTabs(store)).toEqual([]);
        expect(mocks.toast).toHaveBeenCalledWith({
            type: 'success',
            title: 'dialog.world.instances.unpinned_from_sidebar'
        });
    });

    it('offers to pin again when the world tab is hidden', async () => {
        await openDialog([
            {
                id: 'world-karaoke',
                type: 'worldRooms',
                worldId: WORLD_ID,
                name: 'Karaoke',
                visible: false
            }
        ]);

        expect(await screen.findByRole('button', { name: PIN })).toBeTruthy();
    });

    it('reports when the sidebar cannot be saved', async () => {
        await openDialog([]);
        mocks.setString.mockRejectedValue(new Error('disk full'));

        fireEvent.click(await screen.findByRole('button', { name: PIN }));

        await vi.waitFor(() =>
            expect(mocks.toast).toHaveBeenCalledWith({
                type: 'error',
                title: 'dialog.world.instances.pin_to_sidebar_failed'
            })
        );
    });
});
