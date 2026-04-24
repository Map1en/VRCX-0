import { MoreHorizontalIcon, PencilIcon, Trash2Icon } from 'lucide-react';

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
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';
import { SidebarMenuAction } from '@/ui/shadcn/sidebar';

import { isDashboardEntry, isToolEntry } from './AppNavMenuUtils.js';

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

export { DashboardEntryAction, NavItemContextMenu };
