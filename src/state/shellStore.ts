import { create } from 'zustand';

import { setTrayIconNotification } from '@/services/shellIntegrationService';
import {
    DEFAULT_THEME_COLOR_KEY,
    THEME_COLOR_CONFIG
} from '@/shared/constants/themes';
import { DEFAULT_TIME_UNIT_LABELS } from '@/shared/utils/dateTime';

const MIN_NAV_WIDTH = 64;
const MAX_NAV_WIDTH = 480;

type ThemeMode = 'system' | 'light' | 'dark';
type TableDensity = 'standard' | 'compact';
type NotificationLayout = 'notification-center' | 'table';
type TimeUnitLabels = typeof DEFAULT_TIME_UNIT_LABELS;
type ShellStore = {
    sidebarOpen: boolean;
    rightSidebarOpen: boolean;
    navWidth: number;
    locale: string;
    themeMode: ThemeMode;
    themeColor: string;
    tableDensity: TableDensity;
    notificationLayout: NotificationLayout;
    notificationIconDot: boolean;
    displayVRCPlusIconsAsAvatar: boolean;
    hideNicknames: boolean;
    zoomLevel: unknown;
    dateCulture: string;
    dateIsoFormat: boolean;
    dateHour12: boolean;
    timeUnitLabels: TimeUnitLabels;
    notifiedMenus: string[];
    vrcUnseenNotificationCount: number;
    trayIconNotify: boolean;
    setSidebarOpen(sidebarOpen: unknown): void;
    setNavWidth(navWidth: unknown): void;
    toggleSidebar(): void;
    setRightSidebarOpen(rightSidebarOpen: unknown): void;
    toggleRightSidebar(): void;
    setLocale(locale: string): void;
    setThemeMode(themeMode: unknown): void;
    setThemeColor(themeColor: unknown): void;
    setTableDensity(tableDensity: unknown): void;
    setNotificationLayout(notificationLayout: unknown): void;
    setNotificationIconDot(notificationIconDot: unknown): void;
    setAppearancePreferences(options?: {
        displayVRCPlusIconsAsAvatar?: unknown;
        hideNicknames?: unknown;
    }): void;
    setZoomLevel(zoomLevel: unknown): void;
    setDatePreferences(options: {
        dateCulture?: string;
        dateIsoFormat?: unknown;
        dateHour12?: unknown;
    }): void;
    setTimeUnitLabels(labels: unknown): void;
    setVrcUnseenNotificationCount(unseenCount: unknown): void;
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
    | 'setNotificationIconDot'
    | 'setAppearancePreferences'
    | 'setZoomLevel'
    | 'setDatePreferences'
    | 'setTimeUnitLabels'
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
    notificationIconDot: true,
    displayVRCPlusIconsAsAvatar: true,
    hideNicknames: false,
    zoomLevel: null,
    dateCulture: 'en-gb',
    dateIsoFormat: false,
    dateHour12: false,
    timeUnitLabels: DEFAULT_TIME_UNIT_LABELS,
    notifiedMenus: [],
    vrcUnseenNotificationCount: 0,
    trayIconNotify: false
};

const themeModeValues = new Set<unknown>(['system', 'light', 'dark']);
const themeColorValues = new Set(Object.keys(THEME_COLOR_CONFIG));
const tableDensityValues = new Set<unknown>(['standard', 'compact']);

function normalizeThemeMode(value: unknown): ThemeMode {
    if (value === 'midnight') {
        return 'dark';
    }
    return themeModeValues.has(value) ? (value as ThemeMode) : 'system';
}

function normalizeThemeColor(value: unknown): string {
    const normalized = String(value || '')
        .trim()
        .toLowerCase();
    return themeColorValues.has(normalized)
        ? normalized
        : DEFAULT_THEME_COLOR_KEY;
}

export function normalizeTableDensity(value: unknown): TableDensity {
    if (value === 'comfortable') {
        return 'standard';
    }
    return tableDensityValues.has(value) ? (value as TableDensity) : 'standard';
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

function resolveTrayIconNotify(state: ShellStore): boolean {
    if (!state.notificationIconDot) {
        return false;
    }
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
        set({ sidebarOpen: Boolean(sidebarOpen) });
    },
    setNavWidth(navWidth) {
        set({ navWidth: normalizeNavWidth(navWidth) });
    },
    toggleSidebar() {
        set((state) => ({ sidebarOpen: !state.sidebarOpen }));
    },
    setRightSidebarOpen(rightSidebarOpen) {
        set({ rightSidebarOpen: Boolean(rightSidebarOpen) });
    },
    toggleRightSidebar() {
        set((state) => ({ rightSidebarOpen: !state.rightSidebarOpen }));
    },
    setLocale(locale) {
        set({ locale: locale || 'en' });
    },
    setThemeMode(themeMode) {
        set({ themeMode: normalizeThemeMode(themeMode) });
    },
    setThemeColor(themeColor) {
        set({ themeColor: normalizeThemeColor(themeColor) });
    },
    setTableDensity(tableDensity) {
        set({ tableDensity: normalizeTableDensity(tableDensity) });
    },
    setNotificationLayout(notificationLayout) {
        set({
            notificationLayout:
                notificationLayout === 'table' ? 'table' : 'notification-center'
        });
        get().updateTrayIconNotification(true);
    },
    setNotificationIconDot(notificationIconDot) {
        set({ notificationIconDot: Boolean(notificationIconDot) });
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
                    : Boolean(displayVRCPlusIconsAsAvatar),
            hideNicknames:
                hideNicknames === undefined
                    ? state.hideNicknames
                    : Boolean(hideNicknames)
        }));
    },
    setZoomLevel(zoomLevel) {
        set({ zoomLevel });
    },
    setDatePreferences({ dateCulture, dateIsoFormat, dateHour12 }) {
        set({
            dateCulture: dateCulture || 'en-gb',
            dateIsoFormat: Boolean(dateIsoFormat),
            dateHour12: Boolean(dateHour12)
        });
    },
    setTimeUnitLabels(labels) {
        set({
            timeUnitLabels: {
                ...DEFAULT_TIME_UNIT_LABELS,
                ...(labels && typeof labels === 'object' ? labels : {})
            }
        });
    },
    setVrcUnseenNotificationCount(unseenCount) {
        const nextCount = Number.parseInt(String(unseenCount), 10);
        set({
            vrcUnseenNotificationCount: Number.isFinite(nextCount)
                ? nextCount
                : 0
        });
        get().updateTrayIconNotification();
    },
    updateTrayIconNotification(force = false) {
        const nextTrayIconNotify = resolveTrayIconNotify(get());
        if (!force && get().trayIconNotify === nextTrayIconNotify) {
            return;
        }
        set({ trayIconNotify: nextTrayIconNotify });
        setTrayIconNotification(nextTrayIconNotify).catch(() => {});
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
