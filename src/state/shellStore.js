import { create } from 'zustand';

import { backend } from '@/platform/index.js';

const DEFAULT_TIME_UNIT_LABELS = Object.freeze({
    y: 'y',
    d: 'd',
    h: 'h',
    m: 'm',
    s: 's'
});

const MIN_NAV_WIDTH = 64;
const MAX_NAV_WIDTH = 480;

const initialState = {
    sidebarOpen: true,
    navWidth: 240,
    locale: 'en',
    themeMode: 'system',
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

const tableDensityValues = new Set(['standard', 'comfortable', 'compact']);

export function normalizeTableDensity(value) {
    return tableDensityValues.has(value) ? value : 'standard';
}

export function normalizeNavWidth(value) {
    const width = Number.parseInt(value, 10);
    if (!Number.isFinite(width)) {
        return 240;
    }
    return Math.min(MAX_NAV_WIDTH, Math.max(MIN_NAV_WIDTH, width));
}

const routePathByMenuKey = Object.freeze({
    notification: '/notification',
    'friend-log': '/social/friend-log'
});

function getCurrentHashRoutePath() {
    if (typeof window === 'undefined') {
        return '';
    }
    const hashPath = window.location.hash?.startsWith('#')
        ? window.location.hash.slice(1)
        : window.location.pathname;
    return (hashPath || '').split('?')[0].split('#')[0] || '/';
}

function isCurrentMenuRoute(index) {
    const path = routePathByMenuKey[index];
    return Boolean(path && getCurrentHashRoutePath() === path);
}

function resolveTrayIconNotify(state) {
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

export const useShellStore = create((set, get) => ({
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
    setLocale(locale) {
        set({ locale: locale || 'en' });
    },
    setThemeMode(themeMode) {
        set({ themeMode: themeMode || 'system' });
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
    setAppearancePreferences({ displayVRCPlusIconsAsAvatar, hideNicknames } = {}) {
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
        const nextCount = Number.parseInt(unseenCount, 10);
        set({
            vrcUnseenNotificationCount: Number.isFinite(nextCount) ? nextCount : 0
        });
        get().updateTrayIconNotification();
    },
    updateTrayIconNotification(force = false) {
        const nextTrayIconNotify = resolveTrayIconNotify(get());
        if (!force && get().trayIconNotify === nextTrayIconNotify) {
            return;
        }
        set({ trayIconNotify: nextTrayIconNotify });
        void backend.app.SetTrayIconNotification(nextTrayIconNotify).catch(() => {});
    },
    notifyMenu(index) {
        if (!index) {
            return;
        }
        set((state) => (
            isCurrentMenuRoute(index) || state.notifiedMenus.includes(index)
                ? {}
                : {
                      notifiedMenus: [...state.notifiedMenus, index]
                  }
        ));
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
