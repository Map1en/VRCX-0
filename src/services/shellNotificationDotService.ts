import {
    setTaskbarOverlayNotification,
    setTrayIconNotification
} from '@/services/shellIntegrationService';
import { type NotificationLayout, useShellStore } from '@/state/shellStore';

type ShellNotificationDotState = ReturnType<typeof useShellStore.getState>;

function notificationDotActive(state: ShellNotificationDotState): boolean {
    const hasUnreadVrcNotifications = state.vrcUnseenNotificationCount > 0;
    if (state.notificationLayout === 'notification-center') {
        return Boolean(
            hasUnreadVrcNotifications ||
            state.notifiedMenus.includes('friend-log')
        );
    }
    return Boolean(
        hasUnreadVrcNotifications ||
        state.notifiedMenus.includes('notification') ||
        state.notifiedMenus.includes('friend-log')
    );
}

export function syncShellNotificationDot(force = false): void {
    const state = useShellStore.getState();
    const active = notificationDotActive(state);
    const nextTrayIconNotify = state.notificationIconDot && active;
    const nextTaskbarIconNotify = state.taskbarIconDot && active;
    if (
        force ||
        useShellStore.getState().trayIconNotify !== nextTrayIconNotify
    ) {
        state.setTrayIconNotify(nextTrayIconNotify);
        setTrayIconNotification(nextTrayIconNotify).catch(() => {});
    }
    if (
        force ||
        useShellStore.getState().taskbarIconNotify !== nextTaskbarIconNotify
    ) {
        state.setTaskbarIconNotify(nextTaskbarIconNotify);
        setTaskbarOverlayNotification(nextTaskbarIconNotify).catch(() => {});
    }
}

export function setShellNotificationLayout(
    notificationLayout: NotificationLayout
): void {
    useShellStore.getState().setNotificationLayout(notificationLayout);
    syncShellNotificationDot(true);
}

export function setShellNotificationIconDot(
    notificationIconDot: boolean
): void {
    useShellStore.getState().setNotificationIconDot(notificationIconDot);
    syncShellNotificationDot(true);
}

export function setShellTaskbarIconDot(taskbarIconDot: boolean): void {
    useShellStore.getState().setTaskbarIconDot(taskbarIconDot);
    syncShellNotificationDot(true);
}

export function setShellVrcUnseenNotificationCount(unseenCount: number): void {
    useShellStore.getState().setVrcUnseenNotificationCount(unseenCount);
    syncShellNotificationDot();
}

export function notifyShellMenu(index: string): void {
    if (!index) {
        return;
    }
    useShellStore.getState().notifyMenu(index);
    syncShellNotificationDot();
}

export function removeShellMenuNotify(index: string): void {
    if (!index || !useShellStore.getState().notifiedMenus.includes(index)) {
        return;
    }
    useShellStore.getState().removeNotify(index);
    syncShellNotificationDot();
}

export function clearShellMenuNotifications(): void {
    useShellStore.getState().clearAllNotifications();
    syncShellNotificationDot();
}
