import {
    HeartIcon,
    LogOutIcon,
    MoonIcon,
    PanelLeftCloseIcon,
    PanelLeftOpenIcon,
    PlusIcon,
    SettingsIcon,
    SunIcon
} from 'lucide-react';

import { openExternalLink } from '@/lib/entityMedia.js';
import { links } from '@/shared/constants/link.js';
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

import {
    NavItemContextMenu,
    NavMenuEntryItem,
    NavMenuFolderItem,
    themeModeLabel
} from './AppNavMenuParts.jsx';

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
    appVersion,
    isLoggedIn,
    sidebarOpen,
    tableDensity,
    themeMode,
    onLogout,
    onNavigateSettings,
    onOpenCustomNav,
    onSetTableDensity,
    onSetThemeMode,
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
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <SidebarMenuButton tooltip={t('nav_tooltip.manage')}>
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
                                <DropdownMenuItem onSelect={onNavigateSettings}>
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
                                                    void onSetThemeMode(mode);
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
                                        {tableDensityOptions.map((option) => (
                                            <DropdownMenuCheckboxItem
                                                key={option.value}
                                                checked={
                                                    tableDensity === option.value
                                                }
                                                onSelect={() => {
                                                    void onSetTableDensity(
                                                        option.value
                                                    );
                                                }}
                                            >
                                                {t(option.labelKey)}
                                            </DropdownMenuCheckboxItem>
                                        ))}
                                    </DropdownMenuGroup>
                                </DropdownMenuSubContent>
                            </DropdownMenuSub>
                            <DropdownMenuGroup>
                                <DropdownMenuItem onSelect={onOpenCustomNav}>
                                    {t('nav_menu.custom_nav.header')}
                                </DropdownMenuItem>
                            </DropdownMenuGroup>
                            <DropdownMenuSeparator />
                            <DropdownMenuGroup>
                                <DropdownMenuItem
                                    variant="destructive"
                                    disabled={!isLoggedIn}
                                    onSelect={() => {
                                        void onLogout();
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
                            void onToggleSidebar();
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
    );
}

export { AppNavCreateDashboardHeader, AppNavFooter, AppNavMenuContent };
