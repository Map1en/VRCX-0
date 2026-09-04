// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
    SidebarAutoHideContext,
    SidebarAutoHideSnapshot
} from '@/platform/tauri/bindings';

const mocks = vi.hoisted(() => ({
    appGetSidebarAutoHide: vi.fn<() => Promise<SidebarAutoHideSnapshot>>(),
    appSetSidebarAutoHide: vi.fn<(enabled: boolean) => Promise<boolean>>(),
    appSetSidebarAutoHideContext:
        vi.fn<(context: SidebarAutoHideContext) => Promise<void>>(),
    appSuspendSidebarAutoHide: vi.fn<(suspended: boolean) => Promise<void>>(),
    subscribe:
        vi.fn<
            (
                name: string,
                callback: (snapshot: SidebarAutoHideSnapshot) => void
            ) => Promise<() => void>
        >()
}));

vi.mock('@/platform/tauri/bindings', () => ({ commands: mocks }));
vi.mock('@/platform/tauri/events', () => ({
    tauriEvents: { subscribe: mocks.subscribe }
}));
vi.mock('@/services/shellIntegrationService', () => ({
    setTaskbarOverlayNotification: vi.fn(),
    setTrayIconNotification: vi.fn()
}));

beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
    mocks.appGetSidebarAutoHide.mockResolvedValue({
        enabled: false,
        failed: false
    });
    mocks.subscribe.mockResolvedValue(() => undefined);
    mocks.appSetSidebarAutoHide.mockImplementation(async (enabled) => enabled);
    mocks.appSetSidebarAutoHideContext.mockResolvedValue(undefined);
    mocks.appSuspendSidebarAutoHide.mockResolvedValue(undefined);
    document.body.replaceChildren();
});

describe('sidebar auto-hide', () => {
    it('hydrates the native preference and keeps the old value on a failed write', async () => {
        const service = await import('./sidebarAutoHideService');
        const { useSidebarAutoHideStore } =
            await import('@/state/sidebarAutoHideStore');
        await service.initializeSidebarAutoHide();
        expect(useSidebarAutoHideStore.getState()).toEqual({
            enabled: false,
            failed: false,
            hydrated: true
        });
        mocks.appSetSidebarAutoHide.mockRejectedValueOnce(
            new Error('write failed')
        );
        await expect(service.setSidebarAutoHideEnabled(true)).rejects.toThrow(
            'write failed'
        );
        expect(useSidebarAutoHideStore.getState().enabled).toBe(false);
        await service.setSidebarAutoHideEnabled(true);
        expect(useSidebarAutoHideStore.getState().enabled).toBe(true);
    });

    it('does not send unchanged context on each interaction check', async () => {
        const service = await import('./sidebarAutoHideService');
        await service.syncSidebarAutoHideContext(false);
        await service.syncSidebarAutoHideContext(false);
        await service.syncSidebarAutoHideContext(true);
        expect(mocks.appSetSidebarAutoHideContext).toHaveBeenCalledTimes(2);
        expect(mocks.appSetSidebarAutoHideContext).toHaveBeenLastCalledWith(
            expect.objectContaining({ blocked: true })
        );
    });

    it('does not call native suspension on Linux', async () => {
        const { useRuntimeStore } = await import('@/state/runtimeStore');
        useRuntimeStore.setState((state) => ({
            hostCapabilities: { ...state.hostCapabilities, platform: 'linux' }
        }));
        const service = await import('./sidebarAutoHideService');
        await service.suspendSidebarAutoHide(true);
        await service.suspendSidebarAutoHide(false);
        expect(mocks.appSuspendSidebarAutoHide).not.toHaveBeenCalled();
        expect(mocks.appSetSidebarAutoHideContext).not.toHaveBeenCalled();
    });

    it('sends the current mode before lifting native suspension', async () => {
        const { useRuntimeStore } = await import('@/state/runtimeStore');
        const { useShellStore } = await import('@/state/shellStore');
        useRuntimeStore.setState((state) => ({
            hostCapabilities: { ...state.hostCapabilities, platform: 'windows' }
        }));
        const service = await import('./sidebarAutoHideService');
        await service.suspendSidebarAutoHide(true);
        useShellStore.setState({ windowDisplayMode: 'normal' });
        await service.suspendSidebarAutoHide(false);
        expect(mocks.appSetSidebarAutoHideContext).toHaveBeenCalledWith(
            expect.objectContaining({ sidebarMode: false })
        );
        expect(
            mocks.appSetSidebarAutoHideContext.mock.invocationCallOrder[0]
        ).toBeLessThan(
            mocks.appSuspendSidebarAutoHide.mock.invocationCallOrder[1]
        );
    });

    it('blocks for visible menus and dialogs but not closed overlays', async () => {
        const service = await import('./sidebarAutoHideService');
        const menu = document.createElement('div');
        menu.setAttribute('role', 'menu');
        menu.setAttribute('data-open', '');
        Object.defineProperty(menu, 'getClientRects', {
            value: () => {
                throw new Error('Layout must not be read');
            }
        });
        document.body.append(menu);
        expect(service.isSidebarAutoHideInteractionBlocked()).toBe(true);
        menu.setAttribute('data-closed', '');
        expect(service.isSidebarAutoHideInteractionBlocked()).toBe(false);
    });

    it('receives failure and recovery state without overwriting a newer event during hydration', async () => {
        const service = await import('./sidebarAutoHideService');
        const { useSidebarAutoHideStore } =
            await import('@/state/sidebarAutoHideStore');
        await service.subscribeSidebarAutoHideState();
        const onStatus = mocks.subscribe.mock.calls[0][1];
        mocks.appGetSidebarAutoHide.mockImplementation(async () => {
            onStatus({ enabled: true, failed: true });
            return { enabled: true, failed: false };
        });
        await service.initializeSidebarAutoHide();
        expect(useSidebarAutoHideStore.getState()).toEqual({
            enabled: true,
            failed: true,
            hydrated: true
        });
        onStatus({ enabled: true, failed: false });
        expect(useSidebarAutoHideStore.getState().failed).toBe(false);
    });

    it('observes portal open state without polling, reading layout, or watching friend list mutations', async () => {
        const service = await import('./sidebarAutoHideService');
        const root = document.createElement('div');
        root.id = 'root';
        document.body.append(root);
        const changes = vi.fn<(blocked: boolean) => void>();
        const timer = vi.spyOn(window, 'setInterval');
        const dispose = service.observeSidebarAutoHideInteractions(changes);
        await new Promise<void>((resolve) => queueMicrotask(resolve));
        changes.mockClear();
        root.append(document.createElement('div'));
        await new Promise<void>((resolve) => queueMicrotask(resolve));
        expect(changes).not.toHaveBeenCalled();
        const portal = document.createElement('div');
        const menu = document.createElement('div');
        menu.setAttribute('role', 'menu');
        menu.setAttribute('data-open', '');
        portal.append(menu);
        document.body.append(portal);
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        expect(changes).toHaveBeenLastCalledWith(true);
        menu.setAttribute('data-closed', '');
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        expect(changes).toHaveBeenLastCalledWith(false);
        expect(timer).not.toHaveBeenCalled();
        dispose();
        changes.mockClear();
        menu.removeAttribute('data-closed');
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        expect(changes).not.toHaveBeenCalled();
        timer.mockRestore();
    });

    it('keeps a failure reported while enabling instead of clearing it with the command result', async () => {
        const service = await import('./sidebarAutoHideService');
        const { useSidebarAutoHideStore } =
            await import('@/state/sidebarAutoHideStore');
        await service.subscribeSidebarAutoHideState();
        const onStatus = mocks.subscribe.mock.calls[0][1];
        mocks.appSetSidebarAutoHide.mockImplementation(async () => {
            onStatus({ enabled: true, failed: true });
            return true;
        });
        await service.setSidebarAutoHideEnabled(true);
        expect(useSidebarAutoHideStore.getState().failed).toBe(true);
    });

    it.each([
        ['data-closed', ''],
        ['data-base-ui-inert', ''],
        ['hidden', ''],
        ['inert', ''],
        ['aria-hidden', 'true']
    ])(
        'ignores a listbox inside a %s ancestor even with an open ancestor',
        async (attribute, value) => {
            const service = await import('./sidebarAutoHideService');
            const openAncestor = document.createElement('div');
            openAncestor.setAttribute('data-open', '');
            const closedAncestor = document.createElement('div');
            closedAncestor.setAttribute(attribute, value);
            const list = document.createElement('div');
            list.setAttribute('role', 'listbox');
            closedAncestor.append(list);
            openAncestor.append(closedAncestor);
            document.body.append(openAncestor);
            expect(service.isSidebarAutoHideInteractionBlocked()).toBe(false);
        }
    );

    it.each(['data-base-ui-inert', 'inert'])(
        'observes %s changes on a popup ancestor',
        async (attribute) => {
            const service = await import('./sidebarAutoHideService');
            const popup = document.createElement('div');
            popup.setAttribute('data-open', '');
            const list = document.createElement('div');
            list.setAttribute('role', 'listbox');
            popup.append(list);
            document.body.append(popup);
            const changes = vi.fn<(blocked: boolean) => void>();
            const dispose = service.observeSidebarAutoHideInteractions(changes);
            try {
                await new Promise<void>((resolve) => setTimeout(resolve, 0));
                expect(changes).toHaveBeenLastCalledWith(true);
                changes.mockClear();
                popup.setAttribute(attribute, '');
                await new Promise<void>((resolve) => setTimeout(resolve, 0));
                expect(changes).toHaveBeenLastCalledWith(false);
                changes.mockClear();
                popup.removeAttribute(attribute);
                await new Promise<void>((resolve) => setTimeout(resolve, 0));
                expect(changes).toHaveBeenLastCalledWith(true);
            } finally {
                dispose();
            }
        }
    );
});
