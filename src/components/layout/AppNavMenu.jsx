import { useEffect, useMemo, useRef, useState } from 'react';
import {
    BarChart3Icon,
    BellIcon,
    BookOpenIcon,
    ChevronRightIcon,
    CompassIcon,
    ContactIcon,
    FolderIcon,
    Gamepad2Icon,
    GlobeIcon,
    HeartIcon,
    HelpCircleIcon,
    HistoryIcon,
    ImageIcon,
    LayoutDashboardIcon,
    LogOutIcon,
    MapPinIcon,
    MoonIcon,
    MoreHorizontalIcon,
    PencilIcon,
    PlusIcon,
    RssIcon,
    SearchIcon,
    SettingsIcon,
    ShieldAlertIcon,
    SmileIcon,
    PanelLeftCloseIcon,
    PanelLeftOpenIcon,
    StarIcon,
    SunIcon,
    Trash2Icon,
    UsersIcon,
    WrenchIcon
} from 'lucide-react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { useI18n } from '@/app/hooks/use-i18n.js';
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuSeparator,
    ContextMenuTrigger
} from '@/ui/shadcn/context-menu.jsx';
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu.jsx';
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
} from '@/ui/shadcn/sidebar.jsx';
import { backend } from '@/platform/index.js';
import { logoutFromReactShell } from '@/services/authExecutionService.js';
import { directAccessParse } from '@/services/directAccessService.js';
import { openExternalLink } from '@/lib/entityMedia.js';
import {
    setSidebarCollapsedPreference,
    setTableDensityPreference,
    setThemeModePreference
} from '@/services/preferencesService.js';
import { triggerToolByKey } from '@/services/toolActionService.js';
import { DASHBOARD_NAV_KEY_PREFIX } from '@/shared/constants/dashboard.js';
import { isToolNavKey } from '@/shared/constants/tools.js';
import { links } from '@/shared/constants/link.js';
import { useDashboardStore } from '@/state/dashboardStore.js';
import { useModalStore } from '@/state/modalStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { useSessionStore } from '@/state/sessionStore.js';
import { useShellStore } from '@/state/shellStore.js';
import { usePreferencesStore } from '@/state/preferencesStore.js';
import { useVrcNotificationStore } from '@/state/vrcNotificationStore.js';

import { CustomNavDialog } from './CustomNavDialog.jsx';
import { getPathForNavEntry, loadNavMenuModel, NAV_LAYOUT_UPDATED_EVENT, routePathByName, saveNavMenuModel } from './navMenuModel.js';

const iconByKey = {
    feed: RssIcon,
    'friends-locations': MapPinIcon,
    'game-log': HistoryIcon,
    'player-list': Gamepad2Icon,
    search: SearchIcon,
    'favorite-friends': HeartIcon,
    'favorite-worlds': GlobeIcon,
    'favorite-avatars': SmileIcon,
    'friend-log': ContactIcon,
    'friend-list': BookOpenIcon,
    moderation: ShieldAlertIcon,
    notification: BellIcon,
    'my-avatars': ImageIcon,
    'charts-instance': BarChart3Icon,
    'charts-mutual': UsersIcon,
    tools: WrenchIcon,
    'direct-access': CompassIcon,
    'default-folder-favorites': StarIcon,
    'default-folder-social': UsersIcon,
    'default-folder-charts': BarChart3Icon
};

const toolIconByKey = {
    gallery: ImageIcon,
    'screenshot-metadata': ImageIcon
};
const themeModeOptions = ['system', 'light', 'dark', 'midnight'];
const tableDensityOptions = [
    {
        value: 'standard',
        labelKey: 'view.settings.appearance.appearance.table_density_standard'
    },
    {
        value: 'comfortable',
        labelKey: 'view.settings.appearance.appearance.table_density_comfortable'
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
        return entry.title || entry.label || entry.labelKey || entry.key || entry.index || '';
    }
    return t(entry.title || entry.label || entry.labelKey || entry.tooltip || entry.key || '');
}

function themeModeLabel(themeMode, t) {
    return t(`view.settings.appearance.appearance.theme_mode_${themeMode}`);
}

function NavIcon({ entry, className = 'size-4' }) {
    const toolKey = String(entry?.index || entry?.key || '').replace(/^tool-/, '');
    const Icon =
        iconByKey[entry?.index] ||
        iconByKey[entry?.key] ||
        toolIconByKey[toolKey] ||
        (String(entry?.index || '').startsWith(DASHBOARD_NAV_KEY_PREFIX) ? LayoutDashboardIcon : FolderIcon);
    return <Icon className={className} />;
}

function NotifiedNavIcon({ entry, isNotified, className = 'size-4' }) {
    return (
        <span className="relative inline-flex size-4 shrink-0 items-center justify-center">
            <NavIcon entry={entry} className={className} />
            {isNotified ? (
                <span className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-red-500" aria-hidden="true" />
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
    return Boolean(entry?.children?.some((child) => isEntryNotified(child, notifiedKeys)));
}

function removeNavKeyFromLayout(layout, navKey) {
    return (layout || [])
        .map((entry) => {
            if (entry.type === 'item') {
                return entry.key === navKey ? null : entry;
            }
            if (entry.type === 'folder') {
                const nextItems = (entry.items || []).filter((key) => key !== navKey);
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

function DashboardEntryAction({ entry, onEditDashboard, onDeleteDashboard, onUnpinTool, t, compact = false }) {
    const isDashboard = isDashboardEntry(entry);
    const isTool = isToolEntry(entry);
    if (!isDashboard && !isTool) {
        return null;
    }

    const trigger = compact ? (
        <button
            type="button"
            className="absolute top-1 right-1 flex size-5 items-center justify-center rounded-md text-sidebar-foreground opacity-0 hover:bg-sidebar-accent group-hover/menu-sub-item:opacity-100 focus:opacity-100"
            onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
            }}>
            <MoreHorizontalIcon className="size-3.5" />
        </button>
    ) : (
        <SidebarMenuAction
            type="button"
            showOnHover
            onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
            }}>
            <MoreHorizontalIcon className="size-4" />
        </SidebarMenuAction>
    );

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
            <DropdownMenuContent side="right" align="start" className="w-48">
                {isDashboard ? (
                    <>
                        <DropdownMenuItem
                            onSelect={() => {
                                void onEditDashboard(entry);
                            }}>
                            <PencilIcon className="size-4" />
                            {t('nav_menu.edit_dashboard')}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            variant="destructive"
                            onSelect={() => {
                                void onDeleteDashboard(entry);
                            }}>
                            <Trash2Icon className="size-4" />
                            {t('nav_menu.delete_dashboard')}
                        </DropdownMenuItem>
                    </>
                ) : null}
                {isTool ? (
                    <DropdownMenuItem
                        variant="destructive"
                        onSelect={() => {
                            void onUnpinTool(entry);
                        }}>
                        <Trash2Icon className="size-4" />
                        {t('nav_menu.custom_nav.unpin_from_nav')}
                    </DropdownMenuItem>
                ) : null}
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
                    <>
                        <ContextMenuItem
                            onSelect={() => {
                                void onMarkAllRead();
                            }}>
                            {t('nav_menu.mark_all_read')}
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                    </>
                ) : null}
                {showCreateDashboard ? (
                    <ContextMenuItem
                        onSelect={() => {
                            void onCreateDashboard();
                        }}>
                        {t('dashboard.new_dashboard')}
                    </ContextMenuItem>
                ) : null}
                {isDashboard ? (
                    <>
                        <ContextMenuItem
                            onSelect={() => {
                                void onEditDashboard(entry);
                            }}>
                            {t('nav_menu.edit_dashboard')}
                        </ContextMenuItem>
                        <ContextMenuItem
                            variant="destructive"
                            onSelect={() => {
                                void onDeleteDashboard(entry);
                            }}>
                            {t('nav_menu.delete_dashboard')}
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                    </>
                ) : null}
                {isTool ? (
                    <>
                        <ContextMenuItem
                            onSelect={() => {
                                void onUnpinTool(entry);
                            }}>
                            {t('nav_menu.custom_nav.unpin_from_nav')}
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                    </>
                ) : null}
                <ContextMenuItem onSelect={onOpenCustomNav}>
                    {t('nav_menu.custom_nav.header')}
                </ContextMenuItem>
            </ContextMenuContent>
        </ContextMenu>
    );
}

function CollapsedFolderDropdownEntry({ entry, isNotified, onSelect, onEditDashboard, onDeleteDashboard, onUnpinTool, t }) {
    const isDashboard = isDashboardEntry(entry);
    const isTool = isToolEntry(entry);
    if (!isDashboard && !isTool) {
        return (
            <DropdownMenuItem
                onSelect={() => {
                    void onSelect(entry);
                }}>
                <NotifiedNavIcon entry={entry} isNotified={isNotified} />
                <span>{labelForEntry(entry, t)}</span>
            </DropdownMenuItem>
        );
    }

    return (
        <DropdownMenuSub>
            <DropdownMenuSubTrigger>
                <NotifiedNavIcon entry={entry} isNotified={isNotified} />
                <span>{labelForEntry(entry, t)}</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent side="right" align="start" className="w-48">
                <DropdownMenuItem
                    onSelect={() => {
                        void onSelect(entry);
                    }}>
                    <NotifiedNavIcon entry={entry} isNotified={isNotified} />
                    <span>{labelForEntry(entry, t)}</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {isDashboard ? (
                    <>
                        <DropdownMenuItem
                            onSelect={() => {
                                void onEditDashboard(entry);
                            }}>
                            <PencilIcon className="size-4" />
                            {t('nav_menu.edit_dashboard')}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            variant="destructive"
                            onSelect={() => {
                                void onDeleteDashboard(entry);
                            }}>
                            <Trash2Icon className="size-4" />
                            {t('nav_menu.delete_dashboard')}
                        </DropdownMenuItem>
                    </>
                ) : null}
                {isTool ? (
                    <DropdownMenuItem
                        variant="destructive"
                        onSelect={() => {
                            void onUnpinTool(entry);
                        }}>
                        <Trash2Icon className="size-4" />
                        {t('nav_menu.custom_nav.unpin_from_nav')}
                    </DropdownMenuItem>
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
    const [open, setOpen] = useState(() => item.children?.some((entry) => isEntryActive(entry, pathname)));
    const label = labelForEntry(item, t);
    const isActive = item.children?.some((entry) => entry.index === activeIndex || isEntryActive(entry, pathname));
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
                t={t}>
                <SidebarMenuItem>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <SidebarMenuButton isActive={Boolean(isActive)} tooltip={label}>
                                <NotifiedNavIcon entry={item} isNotified={isNotified} />
                                <span>{label}</span>
                            </SidebarMenuButton>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent side="right" align="start" className="w-56">
                            {item.children.map((entry) => (
                                <CollapsedFolderDropdownEntry
                                    key={entry.index}
                                    entry={entry}
                                    isNotified={isEntryNotified(entry, notifiedKeys)}
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
            t={t}>
            <SidebarMenuItem>
                <SidebarMenuButton
                    type="button"
                    isActive={Boolean(isActive)}
                    tooltip={label}
                    onClick={() => setOpen((current) => !current)}>
                    <NotifiedNavIcon entry={item} isNotified={isNotified} />
                    <span>{label}</span>
                    <ChevronRightIcon className={`ml-auto size-4 transition-transform ${open ? 'rotate-90' : ''}`} />
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
                                t={t}>
                                <SidebarMenuSubItem>
                                    <SidebarMenuSubButton
                                        type="button"
                                        className={isDashboardEntry(entry) || isToolEntry(entry) ? 'pr-8' : undefined}
                                        isActive={entry.index === activeIndex || isEntryActive(entry, pathname)}
                                        onClick={() => {
                                            void onSelect(entry);
                                        }}>
                                        <NotifiedNavIcon entry={entry} isNotified={isEntryNotified(entry, notifiedKeys)} />
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
            const activeChild = item.children.find((entry) => isEntryActive(entry, pathname));
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
    const ensureDashboardsLoaded = useDashboardStore((state) => state.ensureLoaded);
    const createDashboard = useDashboardStore((state) => state.createDashboard);
    const deleteDashboard = useDashboardStore((state) => state.deleteDashboard);
    const setEditingDashboardId = useDashboardStore((state) => state.setEditingDashboardId);
    const prompt = useModalStore((state) => state.prompt);
    const confirm = useModalStore((state) => state.confirm);
    const isLoggedIn = useSessionStore((state) => state.isLoggedIn);
    const sessionPhase = useSessionStore((state) => state.sessionPhase);
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const currentEndpoint = useRuntimeStore((state) => state.auth.currentUserEndpoint);
    const vrcUnseenNotificationCount = useVrcNotificationStore((state) => state.unseenCount);
    const markAllVrcNotificationsSeen = useVrcNotificationStore((state) => state.markAllSeen);
    const loadVrcNotifications = useVrcNotificationStore((state) => state.loadForCurrentUser);
    const [menuItems, setMenuItems] = useState([]);
    const [navLayout, setNavLayout] = useState([]);
    const [navHiddenKeys, setNavHiddenKeys] = useState([]);
    const [navDefinitions, setNavDefinitions] = useState([]);
    const [defaultNavLayout, setDefaultNavLayout] = useState([]);
    const preferencesHydrated = usePreferencesStore((state) => state.preferencesHydrated);
    const notificationLayout = usePreferencesStore((state) => state.notificationLayout);
    const [customNavDialogOpen, setCustomNavDialogOpen] = useState(false);
    const showNewDashboardButton = usePreferencesStore((state) => state.showNewDashboardButton);
    const [isCreatingDashboard, setIsCreatingDashboard] = useState(false);
    const [hasPendingUpdate, setHasPendingUpdate] = useState(false);
    const directAccessBusyRef = useRef(false);
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
        const refreshPendingUpdate = () => {
            backend.app
                .CheckForUpdateExe()
                .then((value) => {
                    if (active) {
                        setHasPendingUpdate(Boolean(value));
                    }
                })
                .catch(() => {});
        };
        refreshPendingUpdate();
        const intervalId = window.setInterval(refreshPendingUpdate, 60_000);
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
            const model = await loadNavMenuModel({ dashboards: useDashboardStore.getState().dashboards, notificationLayout, t });
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
        window.addEventListener(NAV_LAYOUT_UPDATED_EVENT, handleNavLayoutUpdated);
        return () => {
            active = false;
            window.removeEventListener(NAV_LAYOUT_UPDATED_EVENT, handleNavLayoutUpdated);
        };
    }, [dashboards, notificationLayout, preferencesHydrated, t]);

    const activeIndex = resolveActiveIndex(menuItems, location.pathname);
    const shouldShowCreateDashboard = showNewDashboardButton || (dashboardsLoaded && dashboards.length === 0);

    useEffect(() => {
        if (!activeIndex) {
            return;
        }
        removeNavNotification(activeIndex);
    }, [activeIndex, removeNavNotification]);

    async function handleCreateDashboard() {
        setIsCreatingDashboard(true);
        try {
            const dashboard = await createDashboard(t('dashboard.default_name'));
            setEditingDashboardId(dashboard.id);
            navigate(`/dashboard/${dashboard.id}`);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to create dashboard.');
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
            toast.error(error instanceof Error ? error.message : 'Failed to mark notifications as seen.');
        }
    }

    async function handleDirectAccessPrompt(inputValue = '') {
        const result = await prompt({
            title: t('prompt.direct_access_omni.header'),
            description: 'Open a VRChat user, avatar, world, group, launch URL, short link, or group shortcode.',
            confirmText: 'Open',
            cancelText: 'Cancel',
            inputValue,
            pattern: /\S+/
        });

        if (!result.ok) {
            return;
        }

        try {
            if (await directAccessParse(result.value, currentEndpoint)) {
                toast.success('Opened direct access target.');
                return;
            }
            toast.error('Could not parse that VRChat ID or URL.');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Direct access failed.');
        }
    }

    async function handleDirectAccessFromClipboard() {
        if (directAccessBusyRef.current) {
            return;
        }

        directAccessBusyRef.current = true;
        try {
            const clipboardText = await backend.app.GetClipboard().catch(() => '');
            const input = typeof clipboardText === 'string' ? clipboardText.trim() : '';
            if (input) {
                try {
                    if (await directAccessParse(input, currentEndpoint)) {
                        toast.success('Opened from clipboard.');
                        return;
                    }
                } catch (error) {
                    toast.error(error instanceof Error ? error.message : 'Direct access failed.');
                    return;
                }
            }
            await handleDirectAccessPrompt(input);
        } finally {
            directAccessBusyRef.current = false;
        }
    }

    async function handleSelectEntry(entry) {
        if (!entry) {
            return;
        }
        if (entry.action === 'direct-access') {
            await handleDirectAccessFromClipboard();
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
        const dashboardId = String(entry.index || '').replace(DASHBOARD_NAV_KEY_PREFIX, '');
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
        const dashboardId = String(entry.index || '').replace(DASHBOARD_NAV_KEY_PREFIX, '');
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
            toast.error(error instanceof Error ? error.message : 'Failed to delete dashboard.');
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
            toast.error(error instanceof Error ? error.message : 'Failed to save custom navigation.');
        }
    }

    async function handleDashboardCreatedFromCustomNav(dashboardId, nextLayout, nextHiddenKeys) {
        try {
            await saveAndApplyNavLayout(nextLayout, nextHiddenKeys);
            setCustomNavDialogOpen(false);
            setEditingDashboardId(dashboardId);
            navigate(`/dashboard/${dashboardId}`);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to save dashboard navigation.');
        }
    }

    async function handleUnpinToolEntry(entry) {
        if (!isToolEntry(entry)) {
            return;
        }
        try {
            const navKey = entry.index || entry.key;
            await saveAndApplyNavLayout(removeNavKeyFromLayout(navLayout, navKey), navHiddenKeys);
            toast.success(t('nav_menu.custom_nav.unpinned'));
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to unpin tool from navigation.');
        }
    }

    useEffect(() => {
        const handleKeyDown = (event) => {
            if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'd') {
                return;
            }
            event.preventDefault();
            void handleDirectAccessFromClipboard();
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [prompt]);

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
                                className="border border-dashed border-primary/40 text-primary hover:bg-primary/10"
                                onClick={() => {
                                    void handleCreateDashboard();
                                }}>
                                <PlusIcon className="size-4" />
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
                t={t}>
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
                                            onMarkAllRead={handleMarkAllNotificationsRead}
                                            onEditDashboard={handleEditDashboard}
                                            onDeleteDashboard={handleDeleteDashboard}
                                            onUnpinTool={handleUnpinToolEntry}
                                            onOpenCustomNav={() => setCustomNavDialogOpen(true)}
                                            t={t}
                                        />
                                    ) : (
                                        <NavItemContextMenu
                                            key={item.index}
                                            entry={item}
                                            hasNotifications={hasNotifications}
                                            onMarkAllRead={handleMarkAllNotificationsRead}
                                            onEditDashboard={handleEditDashboard}
                                            onDeleteDashboard={handleDeleteDashboard}
                                            onUnpinTool={handleUnpinToolEntry}
                                            onOpenCustomNav={() => setCustomNavDialogOpen(true)}
                                            t={t}>
                                            <SidebarMenuItem>
                                                <SidebarMenuButton
                                                    asChild={Boolean(getPathForNavEntry(item))}
                                                    isActive={item.index === activeIndex}
                                                    tooltip={labelForEntry(item, t)}
                                                    className={
                                                        isDashboardEntry(item) || isToolEntry(item) ? 'pr-8' : undefined
                                                    }
                                                    onClick={
                                                        getPathForNavEntry(item)
                                                            ? undefined
                                                            : () => {
                                                                  void handleSelectEntry(item);
                                                              }
                                                    }>
                                                    {getPathForNavEntry(item) ? (
                                                        <NavLink to={getPathForNavEntry(item)}>
                                                            <NotifiedNavIcon
                                                                entry={item}
                                                                isNotified={isNavItemNotified(item, notifiedKeys)}
                                                            />
                                                            <span>{labelForEntry(item, t)}</span>
                                                            {item.action === 'direct-access' && !isCollapsed ? (
                                                                <span className="ml-auto text-[10px] text-muted-foreground">
                                                                    Ctrl D
                                                                </span>
                                                            ) : null}
                                                        </NavLink>
                                                    ) : (
                                                        <>
                                                            <NotifiedNavIcon
                                                                entry={item}
                                                                isNotified={isNavItemNotified(item, notifiedKeys)}
                                                            />
                                                            <span>{labelForEntry(item, t)}</span>
                                                            {item.action === 'direct-access' && !isCollapsed ? (
                                                                <span className="ml-auto text-[10px] text-muted-foreground">
                                                                    Ctrl D
                                                                </span>
                                                            ) : null}
                                                        </>
                                                    )}
                                                </SidebarMenuButton>
                                                <DashboardEntryAction
                                                    entry={item}
                                                    onEditDashboard={handleEditDashboard}
                                                    onDeleteDashboard={handleDeleteDashboard}
                                                    onUnpinTool={handleUnpinToolEntry}
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
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <SidebarMenuButton tooltip={t('nav_tooltip.help_support')}>
                                    <HelpCircleIcon className="size-4" />
                                    <span>{t('nav_tooltip.help_support')}</span>
                                </SidebarMenuButton>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent side="right" align="start" className="w-56">
                                <DropdownMenuLabel>{t('nav_menu.resources')}</DropdownMenuLabel>
                                <DropdownMenuItem onClick={() => void openExternalLink(links.wiki)}>
                                    {t('nav_menu.wiki')}
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuLabel>{t('nav_menu.get_help')}</DropdownMenuLabel>
                                <DropdownMenuItem onClick={() => void openExternalLink(links.github)}>
                                    {t('nav_menu.github')}
                                </DropdownMenuItem>
                                {links.discord ? (
                                    <DropdownMenuItem onClick={() => void openExternalLink(links.discord)}>
                                        {t('nav_menu.discord')}
                                    </DropdownMenuItem>
                                ) : null}
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </SidebarMenuItem>

                    <SidebarMenuItem>
                        <SidebarMenuButton
                            tooltip={t('nav_tooltip.toggle_theme')}
                            onClick={() => {
                                void setThemeModePreference(themeMode === 'light' ? 'dark' : 'light');
                            }}>
                            {themeMode === 'light' ? <MoonIcon className="size-4" /> : <SunIcon className="size-4" />}
                            <span>{t('nav_tooltip.toggle_theme')}</span>
                        </SidebarMenuButton>
                    </SidebarMenuItem>

                    <SidebarMenuItem>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <SidebarMenuButton tooltip={t('nav_tooltip.manage')}>
                                    <span className="relative inline-flex size-4 items-center justify-center">
                                        <SettingsIcon className="size-4" />
                                        {hasPendingUpdate ? (
                                            <span className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-red-500" />
                                        ) : null}
                                    </span>
                                    <span>{t('nav_tooltip.manage')}</span>
                                </SidebarMenuButton>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent side="right" align="start" className="w-56">
                                <div className="flex items-center gap-2 px-2 py-1.5">
                                    <img
                                        className="size-6 cursor-pointer"
                                        src={vrcxLogo}
                                        alt="VRCX-0"
                                        onClick={() => void openExternalLink(links.github)}
                                    />
                                    <button
                                        type="button"
                                        className="flex min-w-0 flex-col text-left"
                                        onClick={() => void openExternalLink(links.github)}>
                                        <span className="flex items-center gap-1 truncate text-sm font-medium">
                                            VRCX-0
                                            <HeartIcon className="size-3 fill-current stroke-none text-primary" />
                                        </span>
                                        <span className="text-xs text-muted-foreground">{appVersion}</span>
                                    </button>
                                </div>
                                <DropdownMenuSeparator />
                                {hasPendingUpdate ? (
                                    <>
                                        <DropdownMenuItem
                                            onClick={() => useRuntimeStore.getState().setSystemHostOpen('updaterOpen', true)}>
                                            {t('nav_menu.update_available')}
                                        </DropdownMenuItem>
                                        <DropdownMenuSeparator />
                                    </>
                                ) : null}
                                <DropdownMenuItem onClick={() => navigate(routePathByName.settings)}>
                                    {t('nav_tooltip.settings')}
                                </DropdownMenuItem>
                                <DropdownMenuSub>
                                    <DropdownMenuSubTrigger>
                                        {t('view.settings.appearance.appearance.theme_mode')}
                                    </DropdownMenuSubTrigger>
                                    <DropdownMenuSubContent side="right" align="start" className="w-48">
                                        {themeModeOptions.map((mode) => (
                                            <DropdownMenuCheckboxItem
                                                key={mode}
                                                checked={themeMode === mode}
                                                onSelect={() => {
                                                    void setThemeModePreference(mode);
                                                }}>
                                                {themeModeLabel(mode, t)}
                                            </DropdownMenuCheckboxItem>
                                        ))}
                                    </DropdownMenuSubContent>
                                </DropdownMenuSub>
                                <DropdownMenuSub>
                                    <DropdownMenuSubTrigger>
                                        {t('view.settings.appearance.appearance.table_density')}
                                    </DropdownMenuSubTrigger>
                                    <DropdownMenuSubContent side="right" align="start" className="w-48">
                                        {tableDensityOptions.map((option) => (
                                            <DropdownMenuCheckboxItem
                                                key={option.value}
                                                checked={tableDensity === option.value}
                                                onSelect={() => {
                                                    void setTableDensityPreference(option.value);
                                                }}>
                                                {t(option.labelKey)}
                                            </DropdownMenuCheckboxItem>
                                        ))}
                                    </DropdownMenuSubContent>
                                </DropdownMenuSub>
                                <DropdownMenuItem onClick={() => setCustomNavDialogOpen(true)}>
                                    {t('nav_menu.custom_nav.header')}
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                    variant="destructive"
                                    disabled={!isLoggedIn}
                                    onClick={() => {
                                        void logoutFromReactShell()
                                            .then((didLogout) => {
                                                if (didLogout) {
                                                    navigate('/login', { replace: true });
                                                }
                                            })
                                            .catch((error) => {
                                                toast.error(
                                                    error instanceof Error ? error.message : 'Failed to sign out of VRCX.'
                                                );
                                            });
                                    }}>
                                    <LogOutIcon className="size-4" />
                                    {t('dialog.user.actions.logout')}
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </SidebarMenuItem>

                    <SidebarMenuItem>
                        <SidebarMenuButton
                            type="button"
                            tooltip={sidebarOpen ? t('nav_tooltip.collapse_menu') : t('nav_tooltip.expand_menu')}
                            onClick={() => {
                                void setSidebarCollapsedPreference(sidebarOpen);
                            }}>
                            {sidebarOpen ? <PanelLeftCloseIcon className="size-4" /> : <PanelLeftOpenIcon className="size-4" />}
                            <span>{sidebarOpen ? t('nav_tooltip.collapse_menu') : t('nav_tooltip.expand_menu')}</span>
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
