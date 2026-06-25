import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import {
    setSidebarCollapsedPreference,
    setThemeModePreference
} from '@/services/preferencesService';
import { triggerToolByKey } from '@/services/toolActionService';
import { DASHBOARD_NAV_KEY_PREFIX } from '@/shared/constants/dashboard';
import { useBackgroundImageStore } from '@/state/backgroundImageStore';
import {
    communityThemeControlsAppearance,
    useCommunityThemeStore
} from '@/state/communityThemeStore';
import { useDashboardStore } from '@/state/dashboardStore';
import { useModalStore } from '@/state/modalStore';
import { usePreferencesStore } from '@/state/preferencesStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useSessionStore } from '@/state/sessionStore';
import { useShellStore } from '@/state/shellStore';
import { useVrcNotificationStore } from '@/state/vrcNotificationStore';

import {
    isDashboardEntry,
    isEntryActive,
    isToolEntry,
    removeNavKeyFromLayout
} from './AppNavMenuParts';
import {
    AppNavCreateDashboardHeader,
    AppNavFooter,
    AppNavMenuContent
} from './AppNavMenuSections';
import { CustomNavDialog } from './CustomNavDialog';
import {
    getPathForNavEntry,
    loadNavMenuModel,
    NAV_CUSTOMIZE_REQUESTED_EVENT,
    NAV_LAYOUT_UPDATED_EVENT,
    routePathByName,
    saveNavMenuModel,
    type NavDefinition,
    type NavLayoutEntry,
    type NavMenuItem,
    type NavMenuModel
} from './navMenuModel';

function resolveActiveIndex(menuItems: NavMenuItem[], pathname: string) {
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

function useAppNavModel({
    dashboards,
    notificationLayout,
    preferencesHydrated,
    t
}: any) {
    const [menuItems, setMenuItems] = useState<NavMenuItem[]>([]);
    const [navLayout, setNavLayout] = useState<NavLayoutEntry[]>([]);
    const [navHiddenKeys, setNavHiddenKeys] = useState<string[]>([]);
    const [navDefinitions, setNavDefinitions] = useState<NavDefinition[]>([]);
    const [defaultNavLayout, setDefaultNavLayout] = useState<NavLayoutEntry[]>(
        []
    );

    function applyModel(model: NavMenuModel) {
        setNavLayout(model.layout);
        setNavHiddenKeys(model.hiddenKeys);
        setNavDefinitions(model.definitions);
        setDefaultNavLayout(model.defaultLayout);
        setMenuItems(model.menuItems);
    }

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
            applyModel(model);
        }

        loadModel().catch((error: any) => {
            console.warn('Failed to load navigation layout:', error);
            if (active) {
                setMenuItems([]);
            }
        });

        const handleNavLayoutUpdated = () => {
            loadModel().catch((error: any) => {
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

    async function saveAndApplyNavLayout(
        nextLayout: unknown,
        nextHiddenKeys: unknown
    ) {
        const model = await saveNavMenuModel({
            layout: nextLayout,
            hiddenKeys: nextHiddenKeys,
            dashboards: useDashboardStore.getState().dashboards,
            notificationLayout,
            t
        });
        applyModel(model);
        return model;
    }

    return {
        defaultNavLayout,
        menuItems,
        navDefinitions,
        navHiddenKeys,
        navLayout,
        saveAndApplyNavLayout
    };
}

function useAppNavNotifications({
    activeIndex,
    currentUserId,
    sessionPhase,
    t
}: any) {
    const notifiedMenus = useShellStore((state: any) => state.notifiedMenus);
    const removeNavNotification = useShellStore(
        (state: any) => state.removeNotify
    );
    const vrcUnseenNotificationCount = useVrcNotificationStore(
        (state: any) => state.unseenCount
    );
    const markAllVrcNotificationsSeen = useVrcNotificationStore(
        (state: any) => state.markAllSeen
    );
    const loadVrcNotifications = useVrcNotificationStore(
        (state: any) => state.loadForCurrentUser
    );
    const notifiedKeys = new Set(notifiedMenus);
    if (vrcUnseenNotificationCount > 0) {
        notifiedKeys.add('notification');
    }

    useEffect(() => {
        if (sessionPhase !== 'ready' || !currentUserId) {
            return;
        }
        loadVrcNotifications().catch(() => {});
    }, [currentUserId, loadVrcNotifications, sessionPhase]);

    useEffect(() => {
        if (!activeIndex) {
            return;
        }
        removeNavNotification(activeIndex);
    }, [activeIndex, removeNavNotification]);

    async function markAllRead() {
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
                    : t(
                          'component.app_nav_menu.toast.failed_to_mark_notifications_as_seen'
                      )
            );
        }
    }

    return {
        hasNotifications: notifiedKeys.size > 0,
        markAllRead,
        notifiedKeys
    };
}

function useAppNavDashboardActions({ location, navigate, t }: any) {
    const createDashboard = useDashboardStore(
        (state: any) => state.createDashboard
    );
    const deleteDashboard = useDashboardStore(
        (state: any) => state.deleteDashboard
    );
    const setEditingDashboardId = useDashboardStore(
        (state: any) => state.setEditingDashboardId
    );
    const confirm = useModalStore((state: any) => state.confirm);
    const [isCreatingDashboard, setIsCreatingDashboard] = useState(false);

    async function createDashboardFromNav() {
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
                    : t(
                          'component.app_nav_menu.toast.failed_to_create_dashboard'
                      )
            );
        } finally {
            setIsCreatingDashboard(false);
        }
    }

    async function editDashboard(entry: any) {
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

    async function deleteDashboardFromNav(entry: any) {
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
                    : t(
                          'component.app_nav_menu.toast.failed_to_delete_dashboard'
                      )
            );
        }
    }

    return {
        createDashboardFromNav,
        deleteDashboardFromNav,
        editDashboard,
        isCreatingDashboard,
        setEditingDashboardId
    };
}

function useAppNavToolActions({
    navHiddenKeys,
    navLayout,
    saveAndApplyNavLayout,
    t
}: any) {
    async function unpinToolEntry(entry: any) {
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
                    : t(
                          'component.app_nav_menu.toast.failed_to_unpin_tool_from_navigation'
                      )
            );
        }
    }

    return { unpinToolEntry };
}

export function AppNavMenu({ isCollapsed }: any) {
    const navigate = useNavigate();
    const location = useLocation();
    const { t } = useTranslation();
    const sidebarOpen = useShellStore((state: any) => state.sidebarOpen);
    const themeMode = useShellStore((state: any) => state.themeMode);
    const communityThemeEnabled = useCommunityThemeStore(
        (state: any) => state.enabled
    );
    const installedCommunityTheme = useCommunityThemeStore(
        (state: any) => state.installedTheme
    );
    const localCommunityThemePreview = useCommunityThemeStore(
        (state: any) => state.localPreview
    );
    const backgroundImageEnabled = useBackgroundImageStore(
        (state: any) => state.enabled
    );
    const dashboards = useDashboardStore((state: any) => state.dashboards);
    const ensureDashboardsLoaded = useDashboardStore(
        (state: any) => state.ensureLoaded
    );
    const sessionPhase = useSessionStore((state: any) => state.sessionPhase);
    const currentUserId = useRuntimeStore(
        (state: any) => state.auth.currentUserId
    );
    const preferencesHydrated = usePreferencesStore(
        (state: any) => state.preferencesHydrated
    );
    const notificationLayout = usePreferencesStore(
        (state: any) => state.notificationLayout
    );
    const [customNavDialogOpen, setCustomNavDialogOpen] = useState(false);
    const showNewDashboardButton = usePreferencesStore(
        (state: any) => state.showNewDashboardButton
    );
    const {
        defaultNavLayout,
        menuItems,
        navDefinitions,
        navHiddenKeys,
        navLayout,
        saveAndApplyNavLayout
    } = useAppNavModel({
        dashboards,
        notificationLayout,
        preferencesHydrated,
        t
    });
    const activeIndex = resolveActiveIndex(menuItems, location.pathname);
    const { hasNotifications, markAllRead, notifiedKeys } =
        useAppNavNotifications({
            activeIndex,
            currentUserId,
            sessionPhase,
            t
        });
    const {
        createDashboardFromNav,
        deleteDashboardFromNav,
        editDashboard,
        isCreatingDashboard,
        setEditingDashboardId
    } = useAppNavDashboardActions({ location, navigate, t });
    const { unpinToolEntry } = useAppNavToolActions({
        navHiddenKeys,
        navLayout,
        saveAndApplyNavLayout,
        t
    });

    useEffect(() => {
        ensureDashboardsLoaded().catch(() => {});
    }, [ensureDashboardsLoaded]);

    useEffect(() => {
        const handleCustomizeRequested = () => {
            setCustomNavDialogOpen(true);
        };
        window.addEventListener(
            NAV_CUSTOMIZE_REQUESTED_EVENT,
            handleCustomizeRequested
        );
        return () => {
            window.removeEventListener(
                NAV_CUSTOMIZE_REQUESTED_EVENT,
                handleCustomizeRequested
            );
        };
    }, []);

    const shouldShowCreateDashboard = showNewDashboardButton;
    const communityThemeAppearanceControlled = communityThemeControlsAppearance(
        communityThemeEnabled,
        installedCommunityTheme,
        localCommunityThemePreview
    );
    const customThemeAppearanceControlled =
        communityThemeAppearanceControlled || backgroundImageEnabled;

    async function handleSelectEntry(entry: any) {
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

    async function handleCustomNavSave(nextLayout: any, nextHiddenKeys: any) {
        try {
            await saveAndApplyNavLayout(nextLayout, nextHiddenKeys);
            setCustomNavDialogOpen(false);
            toast.success(t('message.update_success'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'component.app_nav_menu.toast.failed_to_save_custom_navigation'
                      )
            );
        }
    }

    async function handleDashboardCreatedFromCustomNav(
        dashboardId: any,
        nextLayout: any,
        nextHiddenKeys: any
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
                    : t(
                          'component.app_nav_menu.toast.failed_to_save_dashboard_navigation'
                      )
            );
        }
    }

    return (
        <>
            <AppNavCreateDashboardHeader
                visible={shouldShowCreateDashboard}
                disabled={isCreatingDashboard}
                onCreateDashboard={createDashboardFromNav}
            />

            <AppNavMenuContent
                menuItems={menuItems}
                isCollapsed={isCollapsed}
                activeIndex={activeIndex}
                pathname={location.pathname}
                notifiedKeys={notifiedKeys}
                hasNotifications={hasNotifications}
                onSelect={handleSelectEntry}
                onMarkAllRead={markAllRead}
                onCreateDashboard={createDashboardFromNav}
                onEditDashboard={editDashboard}
                onDeleteDashboard={deleteDashboardFromNav}
                onUnpinTool={unpinToolEntry}
                onOpenCustomNav={() => setCustomNavDialogOpen(true)}
            />

            <AppNavFooter
                sidebarOpen={sidebarOpen}
                themeMode={themeMode}
                showThemeToggle={!customThemeAppearanceControlled}
                onNavigateSettings={() => navigate(routePathByName.settings)}
                onToggleSidebar={() =>
                    setSidebarCollapsedPreference(sidebarOpen)
                }
                onToggleTheme={() => {
                    if (customThemeAppearanceControlled) {
                        return;
                    }
                    setThemeModePreference(
                        themeMode === 'light' ? 'dark' : 'light'
                    );
                }}
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
            />
        </>
    );
}
