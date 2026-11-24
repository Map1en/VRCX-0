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

import { useShellStore } from '@/state/shellStore';

import {
    clearShellMenuNotifications,
    notifyShellMenu,
    removeShellMenuNotify,
    setShellNotificationIconDot,
    setShellNotificationLayout,
    setShellTaskbarIconDot,
    setShellVrcUnseenNotificationCount
} from './shellNotificationDotService';

describe('shell notification dot sync', () => {
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

    it('includes notification menu unread state only in table layout', () => {
        notifyShellMenu('notification');

        expect(useShellStore.getState().trayIconNotify).toBe(false);
        expect(mocks.setTrayIconNotification).not.toHaveBeenCalled();

        setShellNotificationLayout('table');

        expect(useShellStore.getState().trayIconNotify).toBe(true);
        expect(mocks.setTrayIconNotification).toHaveBeenLastCalledWith(true);
    });

    it('shows friend-log and unseen VRChat notifications in either layout', () => {
        notifyShellMenu('friend-log');

        expect(useShellStore.getState().trayIconNotify).toBe(true);
        expect(mocks.setTrayIconNotification).toHaveBeenCalledWith(true);

        useShellStore.setState({
            notifiedMenus: [],
            vrcUnseenNotificationCount: 0,
            trayIconNotify: false
        });
        mocks.setTrayIconNotification.mockClear();
        setShellVrcUnseenNotificationCount(2);

        expect(useShellStore.getState().trayIconNotify).toBe(true);
        expect(mocks.setTrayIconNotification).toHaveBeenCalledWith(true);
    });

    it('does not repeat the shell command while the derived state is unchanged', () => {
        setShellVrcUnseenNotificationCount(1);
        setShellVrcUnseenNotificationCount(2);
        notifyShellMenu('friend-log');

        expect(mocks.setTrayIconNotification).toHaveBeenCalledTimes(1);
        expect(mocks.setTrayIconNotification).toHaveBeenCalledWith(true);
    });

    it('suppresses menu notifications while their route is already open', () => {
        window.location.hash = '#/social/friend-log?view=recent';

        notifyShellMenu('friend-log');

        expect(useShellStore.getState().notifiedMenus).toEqual([]);
        expect(useShellStore.getState().trayIconNotify).toBe(false);
        expect(mocks.setTrayIconNotification).not.toHaveBeenCalled();
    });

    it('turns off the tray indicator when icon dots are disabled', () => {
        useShellStore.setState({
            notifiedMenus: ['friend-log'],
            trayIconNotify: true
        });

        setShellNotificationIconDot(false);

        expect(useShellStore.getState().trayIconNotify).toBe(false);
        expect(mocks.setTrayIconNotification).toHaveBeenCalledWith(false);
    });

    it('drives the taskbar overlay from the same trigger as the tray icon', () => {
        notifyShellMenu('friend-log');

        expect(useShellStore.getState().taskbarIconNotify).toBe(true);
        expect(mocks.setTaskbarOverlayNotification).toHaveBeenCalledWith(true);

        clearShellMenuNotifications();

        expect(useShellStore.getState().taskbarIconNotify).toBe(false);
        expect(mocks.setTaskbarOverlayNotification).toHaveBeenLastCalledWith(
            false
        );
    });

    it('keeps the tray and taskbar indicators independently switchable', () => {
        useShellStore.setState({ taskbarIconDot: false });
        mocks.setTrayIconNotification.mockClear();
        mocks.setTaskbarOverlayNotification.mockClear();

        notifyShellMenu('friend-log');

        expect(useShellStore.getState().trayIconNotify).toBe(true);
        expect(useShellStore.getState().taskbarIconNotify).toBe(false);
        expect(mocks.setTaskbarOverlayNotification).not.toHaveBeenCalled();

        useShellStore.setState({ notificationIconDot: false });
        setShellTaskbarIconDot(true);

        expect(useShellStore.getState().trayIconNotify).toBe(false);
        expect(useShellStore.getState().taskbarIconNotify).toBe(true);
        expect(mocks.setTaskbarOverlayNotification).toHaveBeenLastCalledWith(
            true
        );
    });

    it('resends both indicators when a dot or layout preference is applied', () => {
        setShellNotificationLayout('notification-center');
        setShellNotificationIconDot(true);
        setShellTaskbarIconDot(true);

        expect(mocks.setTrayIconNotification.mock.calls).toEqual([
            [false],
            [false],
            [false]
        ]);
        expect(mocks.setTaskbarOverlayNotification.mock.calls).toEqual([
            [false],
            [false],
            [false]
        ]);
    });

    it('clears the indicators when the last notified menu is removed', () => {
        notifyShellMenu('friend-log');
        mocks.setTrayIconNotification.mockClear();

        removeShellMenuNotify('friend-log');

        expect(useShellStore.getState()).toMatchObject({
            notifiedMenus: [],
            trayIconNotify: false,
            taskbarIconNotify: false
        });
        expect(mocks.setTrayIconNotification).toHaveBeenCalledWith(false);
    });

    it('skips the sync for empty or unknown menu keys', () => {
        useShellStore.setState({ trayIconNotify: true });

        notifyShellMenu('');
        removeShellMenuNotify('');
        removeShellMenuNotify('feed');

        expect(useShellStore.getState().trayIconNotify).toBe(true);
        expect(mocks.setTrayIconNotification).not.toHaveBeenCalled();
    });

    it('keeps the mirrored state when the shell command fails', async () => {
        mocks.setTrayIconNotification.mockRejectedValue(new Error('tray'));
        mocks.setTaskbarOverlayNotification.mockRejectedValue(
            new Error('taskbar')
        );

        notifyShellMenu('friend-log');
        await Promise.resolve();

        expect(useShellStore.getState()).toMatchObject({
            trayIconNotify: true,
            taskbarIconNotify: true
        });
    });
});
