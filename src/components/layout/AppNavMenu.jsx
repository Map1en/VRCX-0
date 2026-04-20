import {
    ChevronRightIcon,
    HeartIcon,
    LogOutIcon,
    MoonIcon,
    MoreHorizontalIcon,
    PencilIcon,
    PlusIcon,
    SettingsIcon,
    PanelLeftCloseIcon,
    PanelLeftOpenIcon,
    SunIcon,
    Trash2Icon
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { useI18n } from '@/app/hooks/use-i18n.js';
import { openExternalLink } from '@/lib/entityMedia.js';
import { cn } from '@/lib/utils.js';
import { backend } from '@/platform/index.js';
import { logoutFromReactShell } from '@/services/authExecutionService.js';
import {
    setSidebarCollapsedPreference,
    setTableDensityPreference,
    setThemeModePreference
} from '@/services/preferencesService.js';
import { triggerToolByKey } from '@/services/toolActionService.js';
import {
    DASHBOARD_NAV_KEY_PREFIX,
    DEFAULT_DASHBOARD_ICON
} from '@/shared/constants/dashboard.js';
import { links } from '@/shared/constants/link.js';
import {
    DEFAULT_FOLDER_ICON,
    DEFAULT_NAV_ICON_KEY,
    getNavIconComponent
} from '@/shared/constants/navIcons.js';
import { isToolNavKey } from '@/shared/constants/tools.js';
import { useDashboardStore } from '@/state/dashboardStore.js';
import { useModalStore } from '@/state/modalStore.js';
import { usePreferencesStore } from '@/state/preferencesStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { useSessionStore } from '@/state/sessionStore.js';
import { useShellStore } from '@/state/shellStore.js';
import { useVrcNotificationStore } from '@/state/vrcNotificationStore.js';
import { Button } from '@/ui/shadcn/button';
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuGroup,
    ContextMenuItem,
    ContextMenuSeparator,
    ContextMenuTrigger
} from '@/ui/shadcn/context-menu';
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
    SidebarMenuAction,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarMenuSub,
    SidebarMenuSubButton,
    SidebarMenuSubItem
} from '@/ui/shadcn/sidebar';

import { CustomNavDialog } from './CustomNavDialog.jsx';
import {
    getPathForNavEntry,
    loadNavMenuModel,
    NAV_LAYOUT_UPDATED_EVENT,
    routePathByName,
    saveNavMenuModel
} from './navMenuModel.js';

const themeModeOptions = ['system', 'light', 'dark'];
const UPDATE_EXE_CHECK_INTERVAL_MS = 60 * 60 * 1000;
const UPDATE_EXE_CHECK_RETRY_MS = 5 * 60 * 1000;
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

function labelForEntry(entry, t) {
    if (!entry) {
        return '';
    }
    if (entry.titleIsCustom) {
        return (
            entry.title ||
            entry.label ||
            entry.labelKey ||
            entry.key ||
            entry.index ||
            ''
        );
    }
    return t(
        entry.title ||
            entry.label ||
            entry.labelKey ||
            entry.tooltip ||
            entry.key ||
            ''
    );
}

function themeModeLabel(themeMode, t) {
    return t(`view.settings.appearance.appearance.theme_mode_${themeMode}`);
}

function NavIcon({ entry, className = undefined }) {
    const fallback = String(entry?.index || '').startsWith(
        DASHBOARD_NAV_KEY_PREFIX
    )
        ? DEFAULT_DASHBOARD_ICON
        : entry?.children
          ? DEFAULT_FOLDER_ICON
          : DEFAULT_NAV_ICON_KEY;
    const Icon = getNavIconComponent(entry?.icon, fallback);
    return <Icon className={className} />;
}

function NotifiedNavIcon({ entry, isNotified, className = undefined }) {
    return (
        <span className="relative inline-flex size-4 shrink-0 items-center justify-center">
            <NavIcon entry={entry} className={className} />
            {isNotified ? (
                <span
                    className="bg-destructive absolute -top-0.5 -right-0.5 size-1.5 rounded-full"
                    aria-hidden="true"
                />
            ) : null}
        </span>
    );
}

function isEntryActive(entry, pathname) {
    const path = getPathForNavEntry(entry);
    if (!path) {
        return false;
    }
    if (entry?.routeName === 'tools') {
        return pathname === '/tools';
    }
    return pathname === path || pathname.startsWith(`${path}/`);
}

function isDashboardEntry(entry) {
    return String(entry?.index || '').startsWith(DASHBOARD_NAV_KEY_PREFIX);
}

function isToolEntry(entry) {
    return isToolNavKey(entry?.index || entry?.key);
}

function isEntryNotified(entry, notifiedKeys) {
    if (!entry || !notifiedKeys?.size) {
        return false;
    }
    const targets = [entry.index, entry.key, entry.routeName].filter(Boolean);
    if (entry.path) {
        const lastSegment = String(entry.path).split('/').filter(Boolean).pop();
        if (lastSegment) {
            targets.push(lastSegment);
        }
    }
    return targets.some((key) => notifiedKeys.has(key));
}

function isNavItemNotified(entry, notifiedKeys) {
    if (isEntryNotified(entry, notifiedKeys)) {
        return true;
    }
    return Boolean(
        entry?.children?.some((child) => isEntryNotified(child, notifiedKeys))
    );
}

function getFolderItemKey(item) {
    return typeof item === 'string' ? item : item?.key;
}

function removeNavKeyFromLayout(layout, navKey) {
    return (layout || [])
        .map((entry) => {
            if (entry.type === 'item') {
                return entry.key === navKey ? null : entry;
            }
            if (entry.type === 'folder') {
                const nextItems = (entry.items || []).filter(
                    (item) => getFolderItemKey(item) !== navKey
                );
                return nextItems.length
                    ? {
                          ...entry,
                          items: nextItems
                      }
                    : null;
            }
            return entry;
        })
        .filter(Boolean);
}

function DashboardEntryAction({
    entry,
    onEditDashboard,
    onDeleteDashboard,
    onUnpinTool,
    t,
    compact = false
}) {
    const isDashboard = isDashboardEntry(entry);
    const isTool = isToolEntry(entry);
    if (!isDashboard && !isTool) {
        return null;
    }

    const trigger = compact ? (
        <Button
            type="button"
            variant="ghost"
            size="icon"
            className="text-sidebar-foreground hover:bg-sidebar-accent absolute top-1 right-1 flex size-5 items-center justify-center rounded-md opacity-0 group-hover/menu-sub-item:opacity-100 focus:opacity-100"
            onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
            }}
        >
            <MoreHorizontalIcon data-icon="inline-start" />
        </Button>
    ) : (
        <SidebarMenuAction
            type="button"
            showOnHover
            onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
            }}
        >
            <MoreHorizontalIcon />
        </SidebarMenuAction>
    );

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
            <DropdownMenuContent side="right" align="start" className="w-48">
                <DropdownMenuGroup>
                    {isDashboard ? (
                        <>
                            <DropdownMenuItem
                                onSelect={() => {
                                    void onEditDashboard(entry);
                                }}
                            >
                                <PencilIcon />
                                {t('nav_menu.edit_dashboard')}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                                variant="destructive"
                                onSelect={() => {
                                    void onDeleteDashboard(entry);
                                }}
                            >
                                <Trash2Icon />
                                {t('nav_menu.delete_dashboard')}
                            </DropdownMenuItem>
                        </>
                    ) : null}
                    {isTool ? (
                        <DropdownMenuItem
                            variant="destructive"
                            onSelect={() => {
                                void onUnpinTool(entry);
                            }}
                        >
                            <Trash2Icon />
                            {t('nav_menu.custom_nav.unpin_from_nav')}
                        </DropdownMenuItem>
                    ) : null}
                </DropdownMenuGroup>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

function NavItemContextMenu({
    children,
    entry,
    hasNotifications,
    showCreateDashboard = false,
    onMarkAllRead,
    onCreateDashboard,
    onEditDashboard,
    onDeleteDashboard,
    onUnpinTool,
    onOpenCustomNav,
    t
}) {
    const isDashboard = isDashboardEntry(entry);
    const isTool = isToolEntry(entry);

    return (
        <ContextMenu>
            <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
            <ContextMenuContent className="w-56">
                {hasNotifications ? (
                    <ContextMenuGroup>
                        <ContextMenuItem
                            onSelect={() => {
                                void onMarkAllRead();
                            }}
                        >
                            {t('nav_menu.mark_all_read')}
                        </ContextMenuItem>
                    </ContextMenuGroup>
                ) : null}
                {hasNotifications ? <ContextMenuSeparator /> : null}
                {showCreateDashboard ? (
                    <ContextMenuGroup>
                        <ContextMenuItem
                            onSelect={() => {
                                void onCreateDashboard();
                            }}
                        >
                            {t('dashboard.new_dashboard')}
                        </ContextMenuItem>
                    </ContextMenuGroup>
                ) : null}
                {isDashboard ? (
                    <ContextMenuGroup>
                        <ContextMenuItem
                            onSelect={() => {
                                void onEditDashboard(entry);
                            }}
                        >
                            {t('nav_menu.edit_dashboard')}
                        </ContextMenuItem>
                        <ContextMenuItem
                            variant="destructive"
                            onSelect={() => {
                                void onDeleteDashboard(entry);
                            }}
                        >
                            {t('nav_menu.delete_dashboard')}
                        </ContextMenuItem>
                    </ContextMenuGroup>
                ) : null}
                {isDashboard ? <ContextMenuSeparator /> : null}
                {isTool ? (
                    <ContextMenuGroup>
                        <ContextMenuItem
                            onSelect={() => {
                                void onUnpinTool(entry);
                            }}
                        >
                            {t('nav_menu.custom_nav.unpin_from_nav')}
                        </ContextMenuItem>
                    </ContextMenuGroup>
                ) : null}
                {isTool ? <ContextMenuSeparator /> : null}
                <ContextMenuGroup>
                    <ContextMenuItem onSelect={onOpenCustomNav}>
                        {t('nav_menu.custom_nav.header')}
                    </ContextMenuItem>
                </ContextMenuGroup>
            </ContextMenuContent>
        </ContextMenu>
    );
}

function CollapsedFolderDropdownEntry({
    entry,
    isNotified,
    onSelect,
    onEditDashboard,
    onDeleteDashboard,
    onUnpinTool,
    t
}) {
    const isDashboard = isDashboardEntry(entry);
    const isTool = isToolEntry(entry);
    if (!isDashboard && !isTool) {
        return (
            <DropdownMenuGroup>
                <DropdownMenuItem
                    onSelect={() => {
                        void onSelect(entry);
                    }}
                >
                    <NotifiedNavIcon entry={entry} isNotified={isNotified} />
                    <span>{labelForEntry(entry, t)}</span>
                </DropdownMenuItem>
            </DropdownMenuGroup>
        );
    }

    return (
        <DropdownMenuSub>
            <DropdownMenuSubTrigger>
                <NotifiedNavIcon entry={entry} isNotified={isNotified} />
                <span>{labelForEntry(entry, t)}</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent side="right" align="start" className="w-48">
                <DropdownMenuGroup>
                    <DropdownMenuItem
                        onSelect={() => {
                            void onSelect(entry);
                        }}
                    >
                        <NotifiedNavIcon
                            entry={entry}
                            isNotified={isNotified}
                        />
                        <span>{labelForEntry(entry, t)}</span>
                    </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                {isDashboard ? (
                    <DropdownMenuGroup>
                        <DropdownMenuItem
                            onSelect={() => {
                                void onEditDashboard(entry);
                            }}
                        >
                            <PencilIcon />
                            {t('nav_menu.edit_dashboard')}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            variant="destructive"
                            onSelect={() => {
                                void onDeleteDashboard(entry);
                            }}
                        >
                            <Trash2Icon />
                            {t('nav_menu.delete_dashboard')}
                        </DropdownMenuItem>
                    </DropdownMenuGroup>
                ) : null}
                {isTool ? (
                    <DropdownMenuGroup>
                        <DropdownMenuItem
                            variant="destructive"
                            onSelect={() => {
                                void onUnpinTool(entry);
                            }}
                        >
                            <Trash2Icon />
                            {t('nav_menu.custom_nav.unpin_from_nav')}
                        </DropdownMenuItem>
                    </DropdownMenuGroup>
                ) : null}
            </DropdownMenuSubContent>
        </DropdownMenuSub>
    );
}

function NavMenuFolderItem({
    item,
    isCollapsed,
    activeIndex,
    pathname,
    notifiedKeys,
    hasNotifications,
    onSelect,
    onMarkAllRead,
    onEditDashboard,
    onDeleteDashboard,
    onUnpinTool,
    onOpenCustomNav,
    t
}) {
    const [open, setOpen] = useState(() =>
        item.children?.some((entry) => isEntryActive(entry, pathname))
    );
    const label = labelForEntry(item, t);
    const isActive = item.children?.some(
        (entry) => entry.index === activeIndex || isEntryActive(entry, pathname)
    );
    const isNotified = isNavItemNotified(item, notifiedKeys);

    useEffect(() => {
        if (isActive) {
            setOpen(true);
        }
    }, [isActive]);

    if (isCollapsed) {
        return (
            <NavItemContextMenu
                entry={item}
                hasNotifications={hasNotifications}
                onMarkAllRead={onMarkAllRead}
                onEditDashboard={onEditDashboard}
                onDeleteDashboard={onDeleteDashboard}
                onUnpinTool={onUnpinTool}
                onOpenCustomNav={onOpenCustomNav}
                t={t}
            >
                <SidebarMenuItem>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <SidebarMenuButton
                                isActive={Boolean(isActive)}
                                tooltip={label}
                            >
                                <NotifiedNavIcon
                                    entry={item}
                                    isNotified={isNotified}
                                />
                                <span>{label}</span>
                            </SidebarMenuButton>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                            side="right"
                            align="start"
                            className="w-56"
                        >
                            {item.children.map((entry) => (
                                <CollapsedFolderDropdownEntry
                                    key={entry.index}
                                    entry={entry}
                                    isNotified={isEntryNotified(
                                        entry,
                                        notifiedKeys
                                    )}
                                    onSelect={onSelect}
                                    onEditDashboard={onEditDashboard}
                                    onDeleteDashboard={onDeleteDashboard}
                                    onUnpinTool={onUnpinTool}
                                    t={t}
                                />
                            ))}
                        </DropdownMenuContent>
                    </DropdownMenu>
                </SidebarMenuItem>
            </NavItemContextMenu>
        );
    }

    return (
        <NavItemContextMenu
            entry={item}
            hasNotifications={hasNotifications}
            onMarkAllRead={onMarkAllRead}
            onEditDashboard={onEditDashboard}
            onDeleteDashboard={onDeleteDashboard}
            onUnpinTool={onUnpinTool}
            onOpenCustomNav={onOpenCustomNav}
            t={t}
        >
            <SidebarMenuItem>
                <SidebarMenuButton
                    type="button"
                    isActive={Boolean(isActive)}
                    tooltip={label}
                    onClick={() => setOpen((current) => !current)}
                >
                    <NotifiedNavIcon entry={item} isNotified={isNotified} />
                    <span>{label}</span>
                    <ChevronRightIcon
                        className={cn(
                            'ml-auto transition-transform',
                            open && 'rotate-90'
                        )}
                    />
                </SidebarMenuButton>
                {open ? (
                    <SidebarMenuSub>
                        {item.children.map((entry) => (
                            <NavItemContextMenu
                                key={entry.index}
                                entry={entry}
                                hasNotifications={hasNotifications}
                                onMarkAllRead={onMarkAllRead}
                                onEditDashboard={onEditDashboard}
                                onDeleteDashboard={onDeleteDashboard}
                                onUnpinTool={onUnpinTool}
                                onOpenCustomNav={onOpenCustomNav}
                                t={t}
                            >
                                <SidebarMenuSubItem>
                                    <SidebarMenuSubButton
                                        type="button"
                                        className={
                                            isDashboardEntry(entry) ||
                                            isToolEntry(entry)
                                                ? 'pr-8'
                                                : undefined
                                        }
                                        isActive={
                                            entry.index === activeIndex ||
                                            isEntryActive(entry, pathname)
                                        }
                                        onClick={() => {
                                            void onSelect(entry);
                                        }}
                                    >
                                        <NotifiedNavIcon
                                            entry={entry}
                                            isNotified={isEntryNotified(
                                                entry,
                                                notifiedKeys
                                            )}
                                            className="size-4"
                                        />
                                        <span>{labelForEntry(entry, t)}</span>
                                    </SidebarMenuSubButton>
                                    <DashboardEntryAction
                                        entry={entry}
                                        onEditDashboard={onEditDashboard}
                                        onDeleteDashboard={onDeleteDashboard}
                                        onUnpinTool={onUnpinTool}
                                        t={t}
                                        compact
                                    />
                                </SidebarMenuSubItem>
                            </NavItemContextMenu>
                        ))}
                    </SidebarMenuSub>
                ) : null}
            </SidebarMenuItem>
        </NavItemContextMenu>
    );
}

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
    const [hasPendingUpdate, setHasPendingUpdate] = useState(false);
    const appVersion = typeof VERSION === 'string' && VERSION ? VERSION : '-';
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
        let active = true;
        let checking = false;
        let lastPendingUpdateCheckAt = 0;
        let lastPendingUpdateFailureAt = 0;
        const refreshPendingUpdate = ({ force = false } = {}) => {
            const now = Date.now();
            if (
                checking ||
                (!force &&
                    (now - lastPendingUpdateCheckAt <
                        UPDATE_EXE_CHECK_INTERVAL_MS ||
                        now - lastPendingUpdateFailureAt <
                            UPDATE_EXE_CHECK_RETRY_MS))
            ) {
                return;
            }

            checking = true;
            backend.app
                .CheckForUpdateExe()
                .then((value) => {
                    lastPendingUpdateCheckAt = Date.now();
                    lastPendingUpdateFailureAt = 0;
                    if (active) {
                        setHasPendingUpdate(Boolean(value));
                    }
                })
                .catch(() => {
                    lastPendingUpdateFailureAt = Date.now();
                })
                .finally(() => {
                    checking = false;
                });
        };
        refreshPendingUpdate({ force: true });
        const intervalId = window.setInterval(
            refreshPendingUpdate,
            UPDATE_EXE_CHECK_INTERVAL_MS
        );
        window.addEventListener('focus', refreshPendingUpdate);
        return () => {
            active = false;
            window.clearInterval(intervalId);
            window.removeEventListener('focus', refreshPendingUpdate);
        };
    }, []);

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
                    : 'Failed to create dashboard.'
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
                    : 'Failed to mark notifications as seen.'
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
                    : 'Failed to delete dashboard.'
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
                    : 'Failed to save custom navigation.'
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
                    : 'Failed to save dashboard navigation.'
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
                    : 'Failed to unpin tool from navigation.'
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
                                        <NavItemContextMenu
                                            key={item.index}
                                            entry={item}
                                            hasNotifications={hasNotifications}
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
                                        >
                                            <SidebarMenuItem>
                                                <SidebarMenuButton
                                                    asChild={Boolean(
                                                        getPathForNavEntry(item)
                                                    )}
                                                    isActive={
                                                        item.index ===
                                                        activeIndex
                                                    }
                                                    tooltip={labelForEntry(
                                                        item,
                                                        t
                                                    )}
                                                    className={
                                                        isDashboardEntry(
                                                            item
                                                        ) || isToolEntry(item)
                                                            ? 'pr-8'
                                                            : undefined
                                                    }
                                                    onClick={
                                                        getPathForNavEntry(item)
                                                            ? undefined
                                                            : () => {
                                                                  void handleSelectEntry(
                                                                      item
                                                                  );
                                                              }
                                                    }
                                                >
                                                    {getPathForNavEntry(
                                                        item
                                                    ) ? (
                                                        <NavLink
                                                            to={getPathForNavEntry(
                                                                item
                                                            )}
                                                        >
                                                            <NotifiedNavIcon
                                                                entry={item}
                                                                isNotified={isNavItemNotified(
                                                                    item,
                                                                    notifiedKeys
                                                                )}
                                                            />
                                                            <span>
                                                                {labelForEntry(
                                                                    item,
                                                                    t
                                                                )}
                                                            </span>
                                                        </NavLink>
                                                    ) : (
                                                        <>
                                                            <NotifiedNavIcon
                                                                entry={item}
                                                                isNotified={isNavItemNotified(
                                                                    item,
                                                                    notifiedKeys
                                                                )}
                                                            />
                                                            <span>
                                                                {labelForEntry(
                                                                    item,
                                                                    t
                                                                )}
                                                            </span>
                                                        </>
                                                    )}
                                                </SidebarMenuButton>
                                                <DashboardEntryAction
                                                    entry={item}
                                                    onEditDashboard={
                                                        handleEditDashboard
                                                    }
                                                    onDeleteDashboard={
                                                        handleDeleteDashboard
                                                    }
                                                    onUnpinTool={
                                                        handleUnpinToolEntry
                                                    }
                                                    t={t}
                                                />
                                            </SidebarMenuItem>
                                        </NavItemContextMenu>
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
                                        {hasPendingUpdate ? (
                                            <span className="bg-destructive absolute -top-0.5 -right-0.5 size-1.5 rounded-full" />
                                        ) : null}
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
                                        alt="VRCX-0"
                                        onClick={() =>
                                            void openExternalLink(links.github)
                                        }
                                    />
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        className="h-auto min-w-0 flex-col items-start gap-0 p-0 text-left font-normal hover:bg-transparent"
                                        onClick={() =>
                                            void openExternalLink(links.github)
                                        }
                                    >
                                        <span className="flex items-center gap-1 truncate text-sm font-medium">
                                            VRCX-0
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
                                {hasPendingUpdate ? (
                                    <DropdownMenuGroup>
                                        <DropdownMenuItem
                                            onSelect={() =>
                                                useRuntimeStore
                                                    .getState()
                                                    .setSystemHostOpen(
                                                        'updaterOpen',
                                                        true
                                                    )
                                            }
                                        >
                                            {t('nav_menu.update_available')}
                                        </DropdownMenuItem>
                                    </DropdownMenuGroup>
                                ) : null}
                                {hasPendingUpdate ? (
                                    <DropdownMenuSeparator />
                                ) : null}
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
                                                            : 'Failed to sign out of VRCX.'
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
