// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    setTrayIconNotification: vi.fn<() => Promise<void>>(),
    setTaskbarOverlayNotification: vi.fn<() => Promise<void>>()
}));

vi.mock('@/services/shellIntegrationService', () => ({
    setTrayIconNotification: mocks.setTrayIconNotification,
    setTaskbarOverlayNotification: mocks.setTaskbarOverlayNotification
}));

import { useShellStore } from './shellStore';

const storedValues = new Map<string, string>();
Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
        clear: () => storedValues.clear(),
        getItem: (key: string) => storedValues.get(key) ?? null,
        removeItem: (key: string) => storedValues.delete(key),
        setItem: (key: string, value: string) => {
            storedValues.set(key, value);
        }
    }
});

describe('shellStore tray notification ownership', () => {
    beforeEach(() => {
        mocks.setTrayIconNotification.mockReset().mockResolvedValue(undefined);
        mocks.setTaskbarOverlayNotification
            .mockReset()
            .mockResolvedValue(undefined);
        window.location.hash = '#/feed';
        useShellStore.setState({
            notificationLayout: 'notification-center',
            notificationIconDot: true,
            taskbarIconDot: true,
            notifiedMenus: [],
            vrcUnseenNotificationCount: 0,
            trayIconNotify: false,
            taskbarIconNotify: false
        });
    });

    it('keeps notified menus unchanged when removing a menu that is not notified', () => {
        useShellStore.setState({ notifiedMenus: ['friend-log'] });
        const notifiedMenus = useShellStore.getState().notifiedMenus;

        useShellStore.getState().removeNotify('feed');

        expect(useShellStore.getState().notifiedMenus).toBe(notifiedMenus);
    });

    it('includes notification menu unread state only in table layout', () => {
        useShellStore.getState().notifyMenu('notification');

        expect(useShellStore.getState().trayIconNotify).toBe(false);
        expect(mocks.setTrayIconNotification).not.toHaveBeenCalled();

        useShellStore.getState().setNotificationLayout('table');

        expect(useShellStore.getState().trayIconNotify).toBe(true);
        expect(mocks.setTrayIconNotification).toHaveBeenLastCalledWith(true);
    });

    it('shows friend-log and unseen VRChat notifications in either layout', () => {
        useShellStore.getState().notifyMenu('friend-log');

        expect(useShellStore.getState().trayIconNotify).toBe(true);
        expect(mocks.setTrayIconNotification).toHaveBeenCalledWith(true);

        useShellStore.setState({
            notifiedMenus: [],
            vrcUnseenNotificationCount: 0,
            trayIconNotify: false
        });
        mocks.setTrayIconNotification.mockClear();
        useShellStore.getState().setVrcUnseenNotificationCount(2);

        expect(useShellStore.getState().trayIconNotify).toBe(true);
        expect(mocks.setTrayIconNotification).toHaveBeenCalledWith(true);
    });

    it('does not repeat the shell command while the derived state is unchanged', () => {
        useShellStore.getState().setVrcUnseenNotificationCount(1);
        useShellStore.getState().setVrcUnseenNotificationCount(2);
        useShellStore.getState().notifyMenu('friend-log');

        expect(mocks.setTrayIconNotification).toHaveBeenCalledTimes(1);
        expect(mocks.setTrayIconNotification).toHaveBeenCalledWith(true);
    });

    it('suppresses menu notifications while their route is already open', () => {
        window.location.hash = '#/social/friend-log?view=recent';

        useShellStore.getState().notifyMenu('friend-log');

        expect(useShellStore.getState().notifiedMenus).toEqual([]);
        expect(useShellStore.getState().trayIconNotify).toBe(false);
        expect(mocks.setTrayIconNotification).not.toHaveBeenCalled();
    });

    it('turns off the tray indicator when icon dots are disabled', () => {
        useShellStore.setState({
            notifiedMenus: ['friend-log'],
            trayIconNotify: true
        });

        useShellStore.getState().setNotificationIconDot(false);

        expect(useShellStore.getState().trayIconNotify).toBe(false);
        expect(mocks.setTrayIconNotification).toHaveBeenCalledWith(false);
    });

    it('drives the taskbar overlay from the same trigger as the tray icon', () => {
        useShellStore.getState().notifyMenu('friend-log');

        expect(useShellStore.getState().taskbarIconNotify).toBe(true);
        expect(mocks.setTaskbarOverlayNotification).toHaveBeenCalledWith(true);

        useShellStore.getState().clearAllNotifications();

        expect(useShellStore.getState().taskbarIconNotify).toBe(false);
        expect(mocks.setTaskbarOverlayNotification).toHaveBeenLastCalledWith(
            false
        );
    });

    it('keeps the tray and taskbar indicators independently switchable', () => {
        useShellStore.setState({ taskbarIconDot: false });
        mocks.setTrayIconNotification.mockClear();
        mocks.setTaskbarOverlayNotification.mockClear();

        useShellStore.getState().notifyMenu('friend-log');

        expect(useShellStore.getState().trayIconNotify).toBe(true);
        expect(useShellStore.getState().taskbarIconNotify).toBe(false);
        expect(mocks.setTaskbarOverlayNotification).not.toHaveBeenCalled();

        useShellStore.setState({ notificationIconDot: false });
        useShellStore.getState().setTaskbarIconDot(true);

        expect(useShellStore.getState().trayIconNotify).toBe(false);
        expect(useShellStore.getState().taskbarIconNotify).toBe(true);
        expect(mocks.setTaskbarOverlayNotification).toHaveBeenLastCalledWith(
            true
        );
    });
});

describe('shellStore settings navigation state', () => {
    it('persists the selected window display mode', () => {
        useShellStore.getState().setWindowDisplayMode('sidebar');

        expect(useShellStore.getState().windowDisplayMode).toBe('sidebar');
        expect(window.localStorage.getItem('VRCX_0_WindowDisplayMode')).toBe(
            'sidebar'
        );

        useShellStore.getState().setWindowDisplayMode('normal');
    });
});
