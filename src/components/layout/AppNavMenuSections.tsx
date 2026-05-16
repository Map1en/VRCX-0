// @ts-nocheck
import {
    MoonIcon,
    PanelLeftIcon,
    SettingsIcon,
    PlusIcon,
    SunIcon
} from 'lucide-react';

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

import {
    NavItemContextMenu,
    NavMenuEntryItem,
    NavMenuFolderItem
} from './AppNavMenuParts';

function AppNavCreateDashboardHeader({
    visible,
    disabled,
    onCreateDashboard,
    t
}) {
    if (!visible) {
        return null;
    }

    return (
        <SidebarHeader className="px-2 py-2">
            <SidebarMenu>
                <SidebarMenuItem>
                    <SidebarMenuButton
                        type="button"
                        tooltip={t('dashboard.new_dashboard')}
                        disabled={disabled}
                        className="border-primary/40 text-primary hover:bg-primary/10 border border-dashed"
                        onClick={() => {
                            void onCreateDashboard();
                        }}
                    >
                        <PlusIcon />
                        <span>{t('dashboard.new_dashboard')}</span>
                    </SidebarMenuButton>
                </SidebarMenuItem>
            </SidebarMenu>
        </SidebarHeader>
    );
}

function AppNavMenuContent({
    menuItems,
    isCollapsed,
    activeIndex,
    pathname,
    notifiedKeys,
    hasNotifications,
    onSelect,
    onMarkAllRead,
    onCreateDashboard,
    onEditDashboard,
    onDeleteDashboard,
    onUnpinTool,
    onOpenCustomNav,
    t
}) {
    return (
        <NavItemContextMenu
            hasNotifications={hasNotifications}
            showCreateDashboard
            onMarkAllRead={onMarkAllRead}
            onCreateDashboard={onCreateDashboard}
            onEditDashboard={onEditDashboard}
            onDeleteDashboard={onDeleteDashboard}
            onUnpinTool={onUnpinTool}
            onOpenCustomNav={onOpenCustomNav}
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
                                        pathname={pathname}
                                        notifiedKeys={notifiedKeys}
                                        hasNotifications={hasNotifications}
                                        onSelect={onSelect}
                                        onMarkAllRead={onMarkAllRead}
                                        onEditDashboard={onEditDashboard}
                                        onDeleteDashboard={onDeleteDashboard}
                                        onUnpinTool={onUnpinTool}
                                        onOpenCustomNav={onOpenCustomNav}
                                        t={t}
                                    />
                                ) : (
                                    <NavMenuEntryItem
                                        key={item.index}
                                        item={item}
                                        activeIndex={activeIndex}
                                        notifiedKeys={notifiedKeys}
                                        hasNotifications={hasNotifications}
                                        onSelect={onSelect}
                                        onMarkAllRead={onMarkAllRead}
                                        onEditDashboard={onEditDashboard}
                                        onDeleteDashboard={onDeleteDashboard}
                                        onUnpinTool={onUnpinTool}
                                        onOpenCustomNav={onOpenCustomNav}
                                        t={t}
                                    />
                                )
                            )}
                        </SidebarMenu>
                    </SidebarGroupContent>
                </SidebarGroup>
            </SidebarContent>
        </NavItemContextMenu>
    );
}

function AppNavFooter({
    sidebarOpen,
    themeMode,
    onNavigateSettings,
    onToggleSidebar,
    onToggleTheme,
    t
}) {
    return (
        <SidebarFooter className="px-2 py-3">
            <SidebarMenu>
                <SidebarMenuItem>
                    <SidebarMenuButton
                        tooltip={t('nav_tooltip.toggle_theme')}
                        onClick={() => {
                            void onToggleTheme();
                        }}
                    >
                        {themeMode === 'light' ? <MoonIcon /> : <SunIcon />}
                        <span>{t('nav_tooltip.toggle_theme')}</span>
                    </SidebarMenuButton>
                </SidebarMenuItem>

                <SidebarMenuItem>
                    <SidebarMenuButton
                        type="button"
                        tooltip={t('nav_tooltip.settings')}
                        onClick={onNavigateSettings}
                    >
                        <span className="relative inline-flex size-4 items-center justify-center">
                            <SettingsIcon />
                        </span>
                        <span>{t('nav_tooltip.settings')}</span>
                    </SidebarMenuButton>
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
                            void onToggleSidebar();
                        }}
                    >
                        <PanelLeftIcon />
                        <span>
                            {sidebarOpen
                                ? t('nav_tooltip.collapse_menu')
                                : t('nav_tooltip.expand_menu')}
                        </span>
                    </SidebarMenuButton>
                </SidebarMenuItem>
            </SidebarMenu>
        </SidebarFooter>
    );
}

export { AppNavCreateDashboardHeader, AppNavFooter, AppNavMenuContent };
