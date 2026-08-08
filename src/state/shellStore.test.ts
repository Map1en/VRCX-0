// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    setTrayIconNotification: vi.fn<() => Promise<void>>()
}));

vi.mock('@/services/shellIntegrationService', () => ({
    setTrayIconNotification: mocks.setTrayIconNotification
}));

import { useShellStore } from './shellStore';

describe('shellStore tray notification ownership', () => {
    beforeEach(() => {
        mocks.setTrayIconNotification.mockReset().mockResolvedValue(undefined);
        window.location.hash = '#/feed';
        useShellStore.setState({
            notificationLayout: 'notification-center',
            notificationIconDot: true,
            notifiedMenus: [],
            vrcUnseenNotificationCount: 0,
            trayIconNotify: false
        });
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
});
