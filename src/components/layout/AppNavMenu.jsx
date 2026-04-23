import {
    HeartIcon,
    LogOutIcon,
    MoonIcon,
    PlusIcon,
    SettingsIcon,
    PanelLeftCloseIcon,
    PanelLeftOpenIcon,
    SunIcon
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { useI18n } from '@/app/hooks/use-i18n.js';
import { openExternalLink } from '@/lib/entityMedia.js';
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
import { links } from '@/shared/constants/link.js';
import { formatReleaseDisplayVersion } from '@/shared/utils/releaseVersion.js';
import { useDashboardStore } from '@/state/dashboardStore.js';
import { useModalStore } from '@/state/modalStore.js';
import { usePreferencesStore } from '@/state/preferencesStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { useSessionStore } from '@/state/sessionStore.js';
import { useShellStore } from '@/state/shellStore.js';
import { useVrcNotificationStore } from '@/state/vrcNotificationStore.js';
import { Button } from '@/ui/shadcn/button';
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';
import {
    SidebarContent,
    SidebarFooter,
    SidebarGroup,
    SidebarGroupContent,
    SidebarHeader,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem
} from '@/ui/shadcn/sidebar';

import { CustomNavDialog } from './CustomNavDialog.jsx';
import {
    isDashboardEntry,
    isEntryActive,
    isToolEntry,
    NavItemContextMenu,
    NavMenuEntryItem,
    NavMenuFolderItem,
    removeNavKeyFromLayout,
    themeModeLabel
} from './AppNavMenuParts.jsx';
import {
    getPathForNavEntry,
    loadNavMenuModel,
    NAV_LAYOUT_UPDATED_EVENT,
    routePathByName,
    saveNavMenuModel
} from './navMenuModel.js';
import { appI18n } from '@/services/i18nService.js';

const themeModeOptions = ['system', 'light', 'dark'];
const tableDensityOptions = [
    {
        value: 'standard',
        labelKey: 'view.settings.appearance.appearance.table_density_standard'
    },
    {
        value: 'compact',
        labelKey: 'view.settings.appearance.appearance.table_density_compact'
    }
];
const vrcxLogo = new URL('../../../images/VRCX-0.png', import.meta.url).href;

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
    const { t } = useI18n();
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
    const notifiedKeys = useMemo(() => {
        const keys = new Set(notifiedMenus);
        if (vrcUnseenNotificationCount > 0) {
            keys.add('notification');
        }
        return keys;
    }, [notifiedMenus, vrcUnseenNotificationCount]);
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
                    : appI18n.t('component.app_nav_menu.generated_toast.failed_to_create_dashboard')
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
                    : appI18n.t('component.app_nav_menu.generated_toast.failed_to_mark_notifications_as_seen')
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
                    : appI18n.t('component.app_nav_menu.generated_toast.failed_to_delete_dashboard')
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
                    : appI18n.t('component.app_nav_menu.generated_toast.failed_to_save_custom_navigation')
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
                    : appI18n.t('component.app_nav_menu.generated_toast.failed_to_save_dashboard_navigation')
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
                    : appI18n.t('component.app_nav_menu.generated_toast.failed_to_unpin_tool_from_navigation')
            );
        }
    }

    return (
        <>
            {shouldShowCreateDashboard ? (
                <SidebarHeader className="px-2 py-2">
                    <SidebarMenu>
                        <SidebarMenuItem>
                            <SidebarMenuButton
                                type="button"
                                tooltip={t('dashboard.new_dashboard')}
                                disabled={isCreatingDashboard}
                                className="border-primary/40 text-primary hover:bg-primary/10 border border-dashed"
                                onClick={() => {
                                    void handleCreateDashboard();
                                }}
                            >
                                <PlusIcon />
                                <span>{t('dashboard.new_dashboard')}</span>
                            </SidebarMenuButton>
                        </SidebarMenuItem>
                    </SidebarMenu>
                </SidebarHeader>
            ) : null}

            <NavItemContextMenu
                hasNotifications={hasNotifications}
                showCreateDashboard
                onMarkAllRead={handleMarkAllNotificationsRead}
                onCreateDashboard={handleCreateDashboard}
                onEditDashboard={handleEditDashboard}
                onDeleteDashboard={handleDeleteDashboard}
                onUnpinTool={handleUnpinToolEntry}
                onOpenCustomNav={() => setCustomNavDialogOpen(true)}
                t={t}
            >
                <SidebarContent className="pt-2">
                    <SidebarGroup>
                        <SidebarGroupContent>
                            <SidebarMenu>
                                {menuItems.map((item) =>
                                    item.children?.length ? (
                                        <NavMenuFolderItem
                                            key={item.index}
                                            item={item}
                                            isCollapsed={isCollapsed}
                                            activeIndex={activeIndex}
                                            pathname={location.pathname}
                                            notifiedKeys={notifiedKeys}
                                            hasNotifications={hasNotifications}
                                            onSelect={handleSelectEntry}
                                            onMarkAllRead={
                                                handleMarkAllNotificationsRead
                                            }
                                            onEditDashboard={
                                                handleEditDashboard
                                            }
                                            onDeleteDashboard={
                                                handleDeleteDashboard
                                            }
                                            onUnpinTool={handleUnpinToolEntry}
                                            onOpenCustomNav={() =>
                                                setCustomNavDialogOpen(true)
                                            }
                                            t={t}
                                        />
                                    ) : (
                                        <NavMenuEntryItem
                                            key={item.index}
                                            item={item}
                                            activeIndex={activeIndex}
                                            notifiedKeys={notifiedKeys}
                                            hasNotifications={hasNotifications}
                                            onSelect={handleSelectEntry}
                                            onMarkAllRead={
                                                handleMarkAllNotificationsRead
                                            }
                                            onEditDashboard={
                                                handleEditDashboard
                                            }
                                            onDeleteDashboard={
                                                handleDeleteDashboard
                                            }
                                            onUnpinTool={handleUnpinToolEntry}
                                            onOpenCustomNav={() =>
                                                setCustomNavDialogOpen(true)
                                            }
                                            t={t}
                                        />
                                    )
                                )}
                            </SidebarMenu>
                        </SidebarGroupContent>
                    </SidebarGroup>
                </SidebarContent>
            </NavItemContextMenu>

            <SidebarFooter className="px-2 py-3">
                <SidebarMenu>
                    <SidebarMenuItem>
                        <SidebarMenuButton
                            tooltip={t('nav_tooltip.toggle_theme')}
                            onClick={() => {
                                void setThemeModePreference(
                                    themeMode === 'light' ? 'dark' : 'light'
                                );
                            }}
                        >
                            {themeMode === 'light' ? <MoonIcon /> : <SunIcon />}
                            <span>{t('nav_tooltip.toggle_theme')}</span>
                        </SidebarMenuButton>
                    </SidebarMenuItem>

                    <SidebarMenuItem>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <SidebarMenuButton
                                    tooltip={t('nav_tooltip.manage')}
                                >
                                    <span className="relative inline-flex size-4 items-center justify-center">
                                        <SettingsIcon />
                                    </span>
                                    <span>{t('nav_tooltip.manage')}</span>
                                </SidebarMenuButton>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent
                                side="right"
                                align="start"
                                className="w-56"
                            >
                                <div className="flex items-center gap-2 px-2 py-1.5">
                                    <img
                                        className="size-6 cursor-pointer"
                                        src={vrcxLogo}
                                        alt={t('view.settings.advanced.advanced.vrcx_settings.header')}
                                        onClick={() =>
                                            void openExternalLink(links.github)
                                        }
                                    />
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        className="h-auto min-w-0 flex-col items-start gap-0 p-0 text-left font-normal"
                                        onClick={() =>
                                            void openExternalLink(links.github)
                                        }
                                    >
                                        <span className="flex items-center gap-1 truncate text-sm font-medium">
                                            {t('view.settings.advanced.advanced.vrcx_settings.header')}
                                            <HeartIcon
                                                data-icon="inline-end"
                                                className="text-primary fill-current stroke-none"
                                            />
                                        </span>
                                        <span className="text-muted-foreground text-xs">
                                            {appVersion}
                                        </span>
                                    </Button>
                                </div>
                                <DropdownMenuSeparator />
                                <DropdownMenuGroup>
                                    <DropdownMenuItem
                                        onSelect={() =>
                                            navigate(routePathByName.settings)
                                        }
                                    >
                                        {t('nav_tooltip.settings')}
                                    </DropdownMenuItem>
                                </DropdownMenuGroup>
                                <DropdownMenuSub>
                                    <DropdownMenuSubTrigger>
                                        {t(
                                            'view.settings.appearance.appearance.theme_mode'
                                        )}
                                    </DropdownMenuSubTrigger>
                                    <DropdownMenuSubContent
                                        side="right"
                                        align="start"
                                        className="w-48"
                                    >
                                        <DropdownMenuGroup>
                                            {themeModeOptions.map((mode) => (
                                                <DropdownMenuCheckboxItem
                                                    key={mode}
                                                    checked={themeMode === mode}
                                                    onSelect={() => {
                                                        void setThemeModePreference(
                                                            mode
                                                        );
                                                    }}
                                                >
                                                    {themeModeLabel(mode, t)}
                                                </DropdownMenuCheckboxItem>
                                            ))}
                                        </DropdownMenuGroup>
                                    </DropdownMenuSubContent>
                                </DropdownMenuSub>
                                <DropdownMenuSub>
                                    <DropdownMenuSubTrigger>
                                        {t(
                                            'view.settings.appearance.appearance.table_density'
                                        )}
                                    </DropdownMenuSubTrigger>
                                    <DropdownMenuSubContent
                                        side="right"
                                        align="start"
                                        className="w-48"
                                    >
                                        <DropdownMenuGroup>
                                            {tableDensityOptions.map(
                                                (option) => (
                                                    <DropdownMenuCheckboxItem
                                                        key={option.value}
                                                        checked={
                                                            tableDensity ===
                                                            option.value
                                                        }
                                                        onSelect={() => {
                                                            void setTableDensityPreference(
                                                                option.value
                                                            );
                                                        }}
                                                    >
                                                        {t(option.labelKey)}
                                                    </DropdownMenuCheckboxItem>
                                                )
                                            )}
                                        </DropdownMenuGroup>
                                    </DropdownMenuSubContent>
                                </DropdownMenuSub>
                                <DropdownMenuGroup>
                                    <DropdownMenuItem
                                        onSelect={() =>
                                            setCustomNavDialogOpen(true)
                                        }
                                    >
                                        {t('nav_menu.custom_nav.header')}
                                    </DropdownMenuItem>
                                </DropdownMenuGroup>
                                <DropdownMenuSeparator />
                                <DropdownMenuGroup>
                                    <DropdownMenuItem
                                        variant="destructive"
                                        disabled={!isLoggedIn}
                                        onSelect={() => {
                                            void logoutFromReactShell()
                                                .then((didLogout) => {
                                                    if (didLogout) {
                                                        navigate('/login', {
                                                            replace: true
                                                        });
                                                    }
                                                })
                                                .catch((error) => {
                                                    toast.error(
                                                        error instanceof Error
                                                            ? error.message
                                                            : appI18n.t('component.app_nav_menu.generated_toast.failed_to_sign_out_of_vrcx_0')
                                                    );
                                                });
                                        }}
                                    >
                                        <LogOutIcon />
                                        {t('dialog.user.actions.logout')}
                                    </DropdownMenuItem>
                                </DropdownMenuGroup>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </SidebarMenuItem>

                    <SidebarMenuItem>
                        <SidebarMenuButton
                            type="button"
                            tooltip={
                                sidebarOpen
                                    ? t('nav_tooltip.collapse_menu')
                                    : t('nav_tooltip.expand_menu')
                            }
                            onClick={() => {
                                void setSidebarCollapsedPreference(sidebarOpen);
                            }}
                        >
                            {sidebarOpen ? (
                                <PanelLeftCloseIcon />
                            ) : (
                                <PanelLeftOpenIcon />
                            )}
                            <span>
                                {sidebarOpen
                                    ? t('nav_tooltip.collapse_menu')
                                    : t('nav_tooltip.expand_menu')}
                            </span>
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                </SidebarMenu>
            </SidebarFooter>
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
