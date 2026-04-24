import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { useTranslation } from 'react-i18next';
import { logoutFromReactShell } from '@/services/authExecutionService.js';
import {
    setSidebarCollapsedPreference,
    setTableDensityPreference,
    setThemeModePreference
} from '@/services/preferencesService.js';
import { triggerToolByKey } from '@/services/toolActionService.js';
import {
    DASHBOARD_NAV_KEY_PREFIX
} from '@/shared/constants/dashboard.js';
import { formatReleaseDisplayVersion } from '@/shared/utils/releaseVersion.js';
import { useDashboardStore } from '@/state/dashboardStore.js';
import { useModalStore } from '@/state/modalStore.js';
import { usePreferencesStore } from '@/state/preferencesStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { useSessionStore } from '@/state/sessionStore.js';
import { useShellStore } from '@/state/shellStore.js';
import { useVrcNotificationStore } from '@/state/vrcNotificationStore.js';

import { CustomNavDialog } from './CustomNavDialog.jsx';
import {
    isDashboardEntry,
    isEntryActive,
    isToolEntry,
    removeNavKeyFromLayout,
} from './AppNavMenuParts.jsx';
import {
    AppNavCreateDashboardHeader,
    AppNavFooter,
    AppNavMenuContent
} from './AppNavMenuSections.jsx';
import {
    getPathForNavEntry,
    loadNavMenuModel,
    NAV_LAYOUT_UPDATED_EVENT,
    routePathByName,
    saveNavMenuModel
} from './navMenuModel.js';

function resolveActiveIndex(menuItems, pathname) {
    for (const item of menuItems) {
        if (item.children?.length) {
            const activeChild = item.children.find((entry) =>
                isEntryActive(entry, pathname)
            );
            if (activeChild) {
                return activeChild.index;
            }
            continue;
        }
        if (isEntryActive(item, pathname)) {
            return item.index;
        }
    }
    return '';
}

export function AppNavMenu({ isCollapsed }) {
    const navigate = useNavigate();
    const location = useLocation();
    const { t } = useTranslation();
    const sidebarOpen = useShellStore((state) => state.sidebarOpen);
    const themeMode = useShellStore((state) => state.themeMode);
    const tableDensity = useShellStore((state) => state.tableDensity);
    const notifiedMenus = useShellStore((state) => state.notifiedMenus);
    const removeNavNotification = useShellStore((state) => state.removeNotify);
    const dashboards = useDashboardStore((state) => state.dashboards);
    const dashboardsLoaded = useDashboardStore((state) => state.loaded);
    const ensureDashboardsLoaded = useDashboardStore(
        (state) => state.ensureLoaded
    );
    const createDashboard = useDashboardStore((state) => state.createDashboard);
    const deleteDashboard = useDashboardStore((state) => state.deleteDashboard);
    const setEditingDashboardId = useDashboardStore(
        (state) => state.setEditingDashboardId
    );
    const confirm = useModalStore((state) => state.confirm);
    const isLoggedIn = useSessionStore((state) => state.isLoggedIn);
    const sessionPhase = useSessionStore((state) => state.sessionPhase);
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const vrcUnseenNotificationCount = useVrcNotificationStore(
        (state) => state.unseenCount
    );
    const markAllVrcNotificationsSeen = useVrcNotificationStore(
        (state) => state.markAllSeen
    );
    const loadVrcNotifications = useVrcNotificationStore(
        (state) => state.loadForCurrentUser
    );
    const [menuItems, setMenuItems] = useState([]);
    const [navLayout, setNavLayout] = useState([]);
    const [navHiddenKeys, setNavHiddenKeys] = useState([]);
    const [navDefinitions, setNavDefinitions] = useState([]);
    const [defaultNavLayout, setDefaultNavLayout] = useState([]);
    const preferencesHydrated = usePreferencesStore(
        (state) => state.preferencesHydrated
    );
    const notificationLayout = usePreferencesStore(
        (state) => state.notificationLayout
    );
    const [customNavDialogOpen, setCustomNavDialogOpen] = useState(false);
    const showNewDashboardButton = usePreferencesStore(
        (state) => state.showNewDashboardButton
    );
    const [isCreatingDashboard, setIsCreatingDashboard] = useState(false);
    const appVersion = formatReleaseDisplayVersion(VERSION || '') || '-';
    const notifiedKeys = new Set(notifiedMenus);
    if (vrcUnseenNotificationCount > 0) {
        notifiedKeys.add('notification');
    }
    const hasNotifications = notifiedKeys.size > 0;

    useEffect(() => {
        void ensureDashboardsLoaded().catch(() => {});
    }, [ensureDashboardsLoaded]);

    useEffect(() => {
        if (sessionPhase !== 'ready' || !currentUserId) {
            return;
        }
        void loadVrcNotifications().catch(() => {});
    }, [currentUserId, loadVrcNotifications, sessionPhase]);

    useEffect(() => {
        if (!preferencesHydrated) {
            return undefined;
        }
        let active = true;
        async function loadModel() {
            const model = await loadNavMenuModel({
                dashboards: useDashboardStore.getState().dashboards,
                notificationLayout,
                t
            });
            if (!active || !model) {
                return;
            }
            setNavLayout(model.layout);
            setNavHiddenKeys(model.hiddenKeys);
            setNavDefinitions(model.definitions);
            setDefaultNavLayout(model.defaultLayout);
            setMenuItems(model.menuItems);
        }

        void loadModel().catch((error) => {
            console.warn('Failed to load navigation layout:', error);
            if (active) {
                setMenuItems([]);
            }
        });

        const handleNavLayoutUpdated = () => {
            void loadModel().catch((error) => {
                console.warn('Failed to reload navigation layout:', error);
            });
        };
        window.addEventListener(
            NAV_LAYOUT_UPDATED_EVENT,
            handleNavLayoutUpdated
        );
        return () => {
            active = false;
            window.removeEventListener(
                NAV_LAYOUT_UPDATED_EVENT,
                handleNavLayoutUpdated
            );
        };
    }, [dashboards, notificationLayout, preferencesHydrated, t]);

    const activeIndex = resolveActiveIndex(menuItems, location.pathname);
    const shouldShowCreateDashboard =
        showNewDashboardButton || (dashboardsLoaded && dashboards.length === 0);

    useEffect(() => {
        if (!activeIndex) {
            return;
        }
        removeNavNotification(activeIndex);
    }, [activeIndex, removeNavNotification]);

    async function handleCreateDashboard() {
        setIsCreatingDashboard(true);
        try {
            const dashboard = await createDashboard(
                t('dashboard.default_name')
            );
            setEditingDashboardId(dashboard.id);
            navigate(`/dashboard/${dashboard.id}`);
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('component.app_nav_menu.generated_toast.failed_to_create_dashboard')
            );
        } finally {
            setIsCreatingDashboard(false);
        }
    }

    async function handleMarkAllNotificationsRead() {
        const store = useVrcNotificationStore.getState();
        if (!store.unseenCount) {
            removeNavNotification('notification');
            return;
        }
        try {
            await markAllVrcNotificationsSeen();
            removeNavNotification('notification');
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('component.app_nav_menu.generated_toast.failed_to_mark_notifications_as_seen')
            );
        }
    }

    async function handleSelectEntry(entry) {
        if (!entry) {
            return;
        }
        if (entry.action?.type === 'tool') {
            await triggerToolByKey(entry.action.toolKey, { navigate, t });
            return;
        }
        const path = getPathForNavEntry(entry);
        if (path) {
            navigate(path);
        }
    }

    async function handleEditDashboard(entry) {
        if (!isDashboardEntry(entry)) {
            return;
        }
        const dashboardId = String(entry.index || '').replace(
            DASHBOARD_NAV_KEY_PREFIX,
            ''
        );
        if (!dashboardId) {
            return;
        }
        setEditingDashboardId(dashboardId);
        if (location.pathname !== `/dashboard/${dashboardId}`) {
            navigate(`/dashboard/${dashboardId}`);
        }
    }

    async function handleDeleteDashboard(entry) {
        if (!isDashboardEntry(entry)) {
            return;
        }
        const dashboardId = String(entry.index || '').replace(
            DASHBOARD_NAV_KEY_PREFIX,
            ''
        );
        if (!dashboardId) {
            return;
        }
        const result = await confirm({
            title: t('dashboard.confirmations.delete_title'),
            description: t('dashboard.confirmations.delete_description'),
            destructive: true
        });
        if (!result.ok) {
            return;
        }
        try {
            await deleteDashboard(dashboardId);
            if (location.pathname === `/dashboard/${dashboardId}`) {
                navigate('/feed', { replace: true });
            }
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('component.app_nav_menu.generated_toast.failed_to_delete_dashboard')
            );
        }
    }

    async function saveAndApplyNavLayout(nextLayout, nextHiddenKeys) {
        const model = await saveNavMenuModel({
            layout: nextLayout,
            hiddenKeys: nextHiddenKeys,
            dashboards: useDashboardStore.getState().dashboards,
            notificationLayout,
            t
        });
        setNavLayout(model.layout);
        setNavHiddenKeys(model.hiddenKeys);
        setNavDefinitions(model.definitions);
        setDefaultNavLayout(model.defaultLayout);
        setMenuItems(model.menuItems);
        return model;
    }

    async function handleCustomNavSave(nextLayout, nextHiddenKeys) {
        try {
            await saveAndApplyNavLayout(nextLayout, nextHiddenKeys);
            setCustomNavDialogOpen(false);
            toast.success(t('message.update_success'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('component.app_nav_menu.generated_toast.failed_to_save_custom_navigation')
            );
        }
    }

    async function handleDashboardCreatedFromCustomNav(
        dashboardId,
        nextLayout,
        nextHiddenKeys
    ) {
        try {
            await saveAndApplyNavLayout(nextLayout, nextHiddenKeys);
            setCustomNavDialogOpen(false);
            setEditingDashboardId(dashboardId);
            navigate(`/dashboard/${dashboardId}`);
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('component.app_nav_menu.generated_toast.failed_to_save_dashboard_navigation')
            );
        }
    }

    async function handleUnpinToolEntry(entry) {
        if (!isToolEntry(entry)) {
            return;
        }
        try {
            const navKey = entry.index || entry.key;
            await saveAndApplyNavLayout(
                removeNavKeyFromLayout(navLayout, navKey),
                navHiddenKeys
            );
            toast.success(t('nav_menu.custom_nav.unpinned'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('component.app_nav_menu.generated_toast.failed_to_unpin_tool_from_navigation')
            );
        }
    }

    async function handleLogout() {
        try {
            const didLogout = await logoutFromReactShell();
            if (didLogout) {
                navigate('/login', {
                    replace: true
                });
            }
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('component.app_nav_menu.generated_toast.failed_to_sign_out_of_vrcx_0')
            );
        }
    }

    return (
        <>
            <AppNavCreateDashboardHeader
                visible={shouldShowCreateDashboard}
                disabled={isCreatingDashboard}
                onCreateDashboard={handleCreateDashboard}
                t={t}
            />

            <AppNavMenuContent
                menuItems={menuItems}
                isCollapsed={isCollapsed}
                activeIndex={activeIndex}
                pathname={location.pathname}
                notifiedKeys={notifiedKeys}
                hasNotifications={hasNotifications}
                onSelect={handleSelectEntry}
                onMarkAllRead={handleMarkAllNotificationsRead}
                onCreateDashboard={handleCreateDashboard}
                onEditDashboard={handleEditDashboard}
                onDeleteDashboard={handleDeleteDashboard}
                onUnpinTool={handleUnpinToolEntry}
                onOpenCustomNav={() => setCustomNavDialogOpen(true)}
                t={t}
            />

            <AppNavFooter
                appVersion={appVersion}
                isLoggedIn={isLoggedIn}
                sidebarOpen={sidebarOpen}
                tableDensity={tableDensity}
                themeMode={themeMode}
                onLogout={handleLogout}
                onNavigateSettings={() => navigate(routePathByName.settings)}
                onOpenCustomNav={() => setCustomNavDialogOpen(true)}
                onSetTableDensity={setTableDensityPreference}
                onSetThemeMode={setThemeModePreference}
                onToggleSidebar={() =>
                    setSidebarCollapsedPreference(sidebarOpen)
                }
                onToggleTheme={() =>
                    setThemeModePreference(
                        themeMode === 'light' ? 'dark' : 'light'
                    )
                }
                t={t}
            />
            <CustomNavDialog
                open={customNavDialogOpen}
                layout={navLayout}
                hiddenKeys={navHiddenKeys}
                defaultLayout={defaultNavLayout}
                defaultHiddenKeys={[]}
                definitions={navDefinitions}
                onOpenChange={setCustomNavDialogOpen}
                onSave={handleCustomNavSave}
                onDashboardCreated={handleDashboardCreatedFromCustomNav}
                t={t}
            />
        </>
    );
}
