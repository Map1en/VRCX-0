import { PanelLeftIcon, SettingsIcon, PlusIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { ShortcutKey } from '@/components/keyboard/ShortcutHintPanel';
import {
    SidebarContent,
    SidebarFooter,
    SidebarGroup,
    SidebarGroupContent,
    SidebarHeader,
    SidebarMenu,
    SidebarMenuBadge,
    SidebarMenuButton,
    SidebarMenuItem
} from '@/ui/shadcn/sidebar';

import type { NavMenuActionHandlers } from './app-nav-menu/types';
import {
    NavItemContextMenu,
    NavMenuEntryItem,
    NavMenuFolderItem
} from './AppNavMenuParts';
import type { NavMenuItem } from './navMenuModel';

function AppNavCreateDashboardHeader({
    visible,
    disabled,
    onCreateDashboard
}: {
    visible: boolean;
    disabled: boolean;
    onCreateDashboard: () => void | Promise<void>;
}) {
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
                        className="text-sidebar-foreground/65 border border-dashed"
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
    shortcutHintsVisible,
    shortcutPositionByIndex,
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
}: NavMenuActionHandlers & {
    menuItems: NavMenuItem[];
    isCollapsed: boolean;
    shortcutHintsVisible: boolean;
    shortcutPositionByIndex: ReadonlyMap<string, number>;
    activeIndex: string;
    pathname: string;
    notifiedKeys: ReadonlySet<string>;
    hasNotifications: boolean;
    onCreateDashboard: () => void | Promise<void>;
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
        >
            <SidebarContent className="text-sidebar-foreground/65 pt-2">
                <SidebarGroup>
                    <SidebarGroupContent>
                        <SidebarMenu>
                            {menuItems.map((item) =>
                                item.children?.length ? (
                                    <NavMenuFolderItem
                                        key={item.index}
                                        item={item}
                                        isCollapsed={isCollapsed}
                                        shortcutHintsVisible={
                                            shortcutHintsVisible
                                        }
                                        shortcutPositionByIndex={
                                            shortcutPositionByIndex
                                        }
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
                                        shortcutHintsVisible={
                                            shortcutHintsVisible
                                        }
                                        shortcutPositionByIndex={
                                            shortcutPositionByIndex
                                        }
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
    settingsActive,
    shortcutHintsVisible,
    onNavigateSettings,
    onToggleSidebar
}: {
    sidebarOpen: boolean;
    settingsActive: boolean;
    shortcutHintsVisible: boolean;
    onNavigateSettings: () => void;
    onToggleSidebar: () => void;
}) {
    const { t } = useTranslation();

    return (
        <SidebarFooter className="text-sidebar-foreground/65 px-2 py-3">
            <SidebarMenu>
                <SidebarMenuItem>
                    <SidebarMenuButton
                        type="button"
                        isActive={settingsActive}
                        tooltip={t('nav_tooltip.settings')}
                        className={shortcutHintsVisible ? 'pr-8' : undefined}
                        onClick={onNavigateSettings}
                    >
                        <span className="relative inline-flex size-4 items-center justify-center">
                            <SettingsIcon />
                        </span>
                        <span>{t('nav_tooltip.settings')}</span>
                    </SidebarMenuButton>
                    {shortcutHintsVisible ? (
                        <SidebarMenuBadge className="p-0">
                            <ShortcutKey keys="," />
                        </SidebarMenuBadge>
                    ) : null}
                </SidebarMenuItem>

                <SidebarMenuItem>
                    <SidebarMenuButton
                        type="button"
                        tooltip={
                            sidebarOpen
                                ? t('nav_tooltip.collapse_nav')
                                : t('nav_tooltip.expand_nav')
                        }
                        className={shortcutHintsVisible ? 'pr-8' : undefined}
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
                    {shortcutHintsVisible ? (
                        <SidebarMenuBadge className="p-0">
                            <ShortcutKey keys="B" />
                        </SidebarMenuBadge>
                    ) : null}
                </SidebarMenuItem>
            </SidebarMenu>
        </SidebarFooter>
    );
}

export { AppNavCreateDashboardHeader, AppNavFooter, AppNavMenuContent };
