import { create } from 'zustand';

import {
    setTaskbarOverlayNotification,
    setTrayIconNotification
} from '@/services/shellIntegrationService';
import { DEFAULT_THEME_COLOR_KEY } from '@/shared/constants/themes';
import {
    DEFAULT_TIME_UNIT_LABELS,
    type TimeUnitLabels
} from '@/shared/utils/dateTime';
import { normalizeThemeColor } from '@/shared/utils/themeColor';

const MIN_NAV_WIDTH = 64;
const MAX_NAV_WIDTH = 480;

export type ThemeMode = 'system' | 'light' | 'dark';
export type TableDensity = 'standard' | 'compact';
export type NotificationLayout = 'notification-center' | 'table';
export type WindowDisplayMode = 'normal' | 'sidebar';

const WINDOW_DISPLAY_MODE_STORAGE_KEY = 'vrcx-main-window-display-mode';

function loadWindowDisplayMode(): WindowDisplayMode {
    if (typeof window === 'undefined') {
        return 'normal';
    }
    try {
        return window.localStorage.getItem(WINDOW_DISPLAY_MODE_STORAGE_KEY) ===
            'sidebar'
            ? 'sidebar'
            : 'normal';
    } catch {
        return 'normal';
    }
}

function saveWindowDisplayMode(windowDisplayMode: WindowDisplayMode): void {
    if (typeof window === 'undefined') {
        return;
    }
    try {
        window.localStorage.setItem(
            WINDOW_DISPLAY_MODE_STORAGE_KEY,
            windowDisplayMode
        );
    } catch {
        return;
    }
}

type ShellStore = {
    sidebarOpen: boolean;
    rightSidebarOpen: boolean;
    navWidth: number;
    locale: string;
    themeMode: ThemeMode;
    themeColor: string;
    tableDensity: TableDensity;
    notificationLayout: NotificationLayout;
    windowDisplayMode: WindowDisplayMode;
    notificationIconDot: boolean;
    taskbarIconDot: boolean;
    displayVRCPlusIconsAsAvatar: boolean;
    hideNicknames: boolean;
    zoomLevel: number | null;
    dateCulture: string;
    dateIsoFormat: boolean;
    dateHour12: boolean;
    timeUnitLabels: TimeUnitLabels;
    notifiedMenus: string[];
    lastSettingsTab: string;
    shortcutHintsVisible: boolean;
    vrcUnseenNotificationCount: number;
    trayIconNotify: boolean;
    taskbarIconNotify: boolean;
    setSidebarOpen(sidebarOpen: boolean): void;
    setNavWidth(navWidth: number): void;
    toggleSidebar(): void;
    setRightSidebarOpen(rightSidebarOpen: boolean): void;
    toggleRightSidebar(): void;
    setLocale(locale: string): void;
    setThemeMode(themeMode: ThemeMode): void;
    setThemeColor(themeColor: string): void;
    setTableDensity(tableDensity: TableDensity): void;
    setNotificationLayout(notificationLayout: NotificationLayout): void;
    setWindowDisplayMode(
        windowDisplayMode: WindowDisplayMode,
        remember?: boolean
    ): void;
    setNotificationIconDot(notificationIconDot: boolean): void;
    setTaskbarIconDot(taskbarIconDot: boolean): void;
    setAppearancePreferences(options?: {
        displayVRCPlusIconsAsAvatar?: boolean;
        hideNicknames?: boolean;
    }): void;
    setZoomLevel(zoomLevel: number): void;
    setDatePreferences(options: {
        dateCulture: string;
        dateIsoFormat: boolean;
        dateHour12: boolean;
    }): void;
    setTimeUnitLabels(labels: TimeUnitLabels): void;
    setLastSettingsTab(lastSettingsTab: string): void;
    setShortcutHintsVisible(visible: boolean): void;
    setVrcUnseenNotificationCount(unseenCount: number): void;
    updateTrayIconNotification(force?: boolean): void;
    notifyMenu(index: string): void;
    removeNotify(index: string): void;
    clearAllNotifications(): void;
};

type ShellStoreState = Omit<
    ShellStore,
    | 'setSidebarOpen'
    | 'setNavWidth'
    | 'toggleSidebar'
    | 'setRightSidebarOpen'
    | 'toggleRightSidebar'
    | 'setLocale'
    | 'setThemeMode'
    | 'setThemeColor'
    | 'setTableDensity'
    | 'setNotificationLayout'
    | 'setWindowDisplayMode'
    | 'setNotificationIconDot'
    | 'setTaskbarIconDot'
    | 'setAppearancePreferences'
    | 'setZoomLevel'
    | 'setDatePreferences'
    | 'setTimeUnitLabels'
    | 'setLastSettingsTab'
    | 'setShortcutHintsVisible'
    | 'setVrcUnseenNotificationCount'
    | 'updateTrayIconNotification'
    | 'notifyMenu'
    | 'removeNotify'
    | 'clearAllNotifications'
>;

const initialState: ShellStoreState = {
    sidebarOpen: true,
    rightSidebarOpen: true,
    navWidth: 240,
    locale: 'en',
    themeMode: 'system',
    themeColor: DEFAULT_THEME_COLOR_KEY,
    tableDensity: 'standard',
    notificationLayout: 'notification-center',
    windowDisplayMode: loadWindowDisplayMode(),
    notificationIconDot: true,
    taskbarIconDot: true,
    displayVRCPlusIconsAsAvatar: true,
    hideNicknames: false,
    zoomLevel: null,
    dateCulture: 'en-gb',
    dateIsoFormat: false,
    dateHour12: false,
    timeUnitLabels: DEFAULT_TIME_UNIT_LABELS,
    notifiedMenus: [],
    lastSettingsTab: 'system',
    shortcutHintsVisible: false,
    vrcUnseenNotificationCount: 0,
    trayIconNotify: false,
    taskbarIconNotify: false
};

export function normalizeTableDensity(value: unknown): TableDensity {
    return value === 'standard' || value === 'compact' ? value : 'standard';
}

export function normalizeNavWidth(value: unknown): number {
    const width = Number.parseInt(String(value), 10);
    if (!Number.isFinite(width)) {
        return 240;
    }
    return Math.min(MAX_NAV_WIDTH, Math.max(MIN_NAV_WIDTH, width));
}

const routePathByMenuKey: Readonly<Record<string, string>> = Object.freeze({
    notification: '/notification',
    'friend-log': '/social/friend-log'
});

function getCurrentHashRoutePath(): string {
    if (typeof window === 'undefined') {
        return '';
    }
    const hashPath = window.location.hash?.startsWith('#')
        ? window.location.hash.slice(1)
        : window.location.pathname;
    return (hashPath || '').split('?')[0].split('#')[0] || '/';
}

function isCurrentMenuRoute(index: string): boolean {
    const path = routePathByMenuKey[index];
    return Boolean(path && getCurrentHashRoutePath() === path);
}

function notificationDotActive(state: ShellStore): boolean {
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

export const useShellStore = create<ShellStore>((set, get) => ({
    ...initialState,
    setSidebarOpen(sidebarOpen) {
        set({ sidebarOpen });
    },
    setNavWidth(navWidth) {
        set({ navWidth: normalizeNavWidth(navWidth) });
    },
    toggleSidebar() {
        set((state) => ({ sidebarOpen: !state.sidebarOpen }));
    },
    setRightSidebarOpen(rightSidebarOpen) {
        set({ rightSidebarOpen });
    },
    toggleRightSidebar() {
        set((state) => ({ rightSidebarOpen: !state.rightSidebarOpen }));
    },
    setLocale(locale) {
        set({ locale: locale || 'en' });
    },
    setThemeMode(themeMode) {
        set({ themeMode });
    },
    setThemeColor(themeColor) {
        set({ themeColor: normalizeThemeColor(themeColor) });
    },
    setTableDensity(tableDensity) {
        set({ tableDensity });
    },
    setNotificationLayout(notificationLayout) {
        set({ notificationLayout });
        get().updateTrayIconNotification(true);
    },
    setWindowDisplayMode(windowDisplayMode, remember = true) {
        if (remember) {
            saveWindowDisplayMode(windowDisplayMode);
        }
        set({ windowDisplayMode });
    },
    setNotificationIconDot(notificationIconDot) {
        set({ notificationIconDot });
        get().updateTrayIconNotification(true);
    },
    setTaskbarIconDot(taskbarIconDot) {
        set({ taskbarIconDot });
        get().updateTrayIconNotification(true);
    },
    setAppearancePreferences({
        displayVRCPlusIconsAsAvatar,
        hideNicknames
    } = {}) {
        set((state) => ({
            displayVRCPlusIconsAsAvatar:
                displayVRCPlusIconsAsAvatar === undefined
                    ? state.displayVRCPlusIconsAsAvatar
                    : displayVRCPlusIconsAsAvatar,
            hideNicknames:
                hideNicknames === undefined
                    ? state.hideNicknames
                    : hideNicknames
        }));
    },
    setZoomLevel(zoomLevel) {
        set({ zoomLevel });
    },
    setDatePreferences({ dateCulture, dateIsoFormat, dateHour12 }) {
        set({
            dateCulture: dateCulture || 'en-gb',
            dateIsoFormat,
            dateHour12
        });
    },
    setTimeUnitLabels(labels) {
        set({ timeUnitLabels: labels });
    },
    setLastSettingsTab(lastSettingsTab) {
        set({ lastSettingsTab });
    },
    setShortcutHintsVisible(shortcutHintsVisible) {
        set({ shortcutHintsVisible });
    },
    setVrcUnseenNotificationCount(unseenCount) {
        set({ vrcUnseenNotificationCount: unseenCount });
        get().updateTrayIconNotification();
    },
    updateTrayIconNotification(force = false) {
        const active = notificationDotActive(get());
        const nextTrayIconNotify = get().notificationIconDot && active;
        const nextTaskbarIconNotify = get().taskbarIconDot && active;
        if (force || get().trayIconNotify !== nextTrayIconNotify) {
            set({ trayIconNotify: nextTrayIconNotify });
            setTrayIconNotification(nextTrayIconNotify).catch(() => {});
        }
        if (force || get().taskbarIconNotify !== nextTaskbarIconNotify) {
            set({ taskbarIconNotify: nextTaskbarIconNotify });
            setTaskbarOverlayNotification(nextTaskbarIconNotify).catch(
                () => {}
            );
        }
    },
    notifyMenu(index) {
        if (!index) {
            return;
        }
        set((state) =>
            isCurrentMenuRoute(index) || state.notifiedMenus.includes(index)
                ? {}
                : {
                      notifiedMenus: [...state.notifiedMenus, index]
                  }
        );
        get().updateTrayIconNotification();
    },
    removeNotify(index) {
        if (!index) {
            return;
        }
        set((state) => ({
            notifiedMenus: state.notifiedMenus.filter((item) => item !== index)
        }));
        get().updateTrayIconNotification();
    },
    clearAllNotifications() {
        set({ notifiedMenus: [] });
        get().updateTrayIconNotification();
    }
}));

export { DEFAULT_TIME_UNIT_LABELS };
