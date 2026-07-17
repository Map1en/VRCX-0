import {
    MoonIcon,
    PanelLeftIcon,
    SettingsIcon,
    PlusIcon,
    SunIcon
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

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
    onCreateDashboard
}: any) {
    const { t } = useTranslation();

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
                            onCreateDashboard();
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
    onOpenCustomNav
}: any) {
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
        >
            <SidebarContent className="pt-2">
                <SidebarGroup>
                    <SidebarGroupContent>
                        <SidebarMenu>
                            {menuItems.map((item: any) =>
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
    showThemeToggle = true,
    onNavigateSettings,
    onToggleSidebar,
    onToggleTheme
}: any) {
    const { t } = useTranslation();

    return (
        <SidebarFooter className="px-2 py-3">
            <SidebarMenu>
                {showThemeToggle ? (
                    <SidebarMenuItem>
                        <SidebarMenuButton
                            tooltip={t('nav_tooltip.toggle_theme')}
                            onClick={() => {
                                onToggleTheme();
                            }}
                        >
                            {themeMode === 'light' ? <MoonIcon /> : <SunIcon />}
                            <span>{t('nav_tooltip.toggle_theme')}</span>
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                ) : null}

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
                                ? t('nav_tooltip.collapse_nav')
                                : t('nav_tooltip.expand_nav')
                        }
                        onClick={() => {
                            onToggleSidebar();
                        }}
                    >
                        <PanelLeftIcon />
                        <span>
                            {sidebarOpen
                                ? t('nav_tooltip.collapse_nav')
                                : t('nav_tooltip.expand_nav')}
                        </span>
                    </SidebarMenuButton>
                </SidebarMenuItem>
            </SidebarMenu>
        </SidebarFooter>
    );
}

export { AppNavCreateDashboardHeader, AppNavFooter, AppNavMenuContent };
