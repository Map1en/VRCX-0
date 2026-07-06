import { MoreHorizontalIcon, PencilIcon, Trash2Icon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

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

import { isDashboardEntry, isToolEntry } from './AppNavMenuUtils';

function DashboardEntryAction({
    entry,
    onEditDashboard,
    onDeleteDashboard,
    onUnpinTool,
    compact = false
}: any) {
    const { t } = useTranslation();
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
            <DropdownMenuTrigger render={trigger} />
            <DropdownMenuContent side="right" align="start" className="w-48">
                <DropdownMenuGroup>
                    {isDashboard ? (
                        <>
                            <DropdownMenuItem
                                onClick={() => {
                                    onEditDashboard(entry);
                                }}
                            >
                                <PencilIcon />
                                {t('nav_menu.edit_dashboard')}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                                variant="destructive"
                                onClick={() => {
                                    onDeleteDashboard(entry);
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
                            onClick={() => {
                                onUnpinTool(entry);
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
    onOpenCustomNav
}: any) {
    const { t } = useTranslation();
    const isDashboard = isDashboardEntry(entry);
    const isTool = isToolEntry(entry);

    return (
        <ContextMenu>
            <ContextMenuTrigger render={children} />
            <ContextMenuContent className="w-56">
                {hasNotifications ? (
                    <ContextMenuGroup>
                        <ContextMenuItem
                            onClick={() => {
                                onMarkAllRead();
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
                            onClick={() => {
                                onCreateDashboard();
                            }}
                        >
                            {t('dashboard.new_dashboard')}
                        </ContextMenuItem>
                    </ContextMenuGroup>
                ) : null}
                {isDashboard ? (
                    <ContextMenuGroup>
                        <ContextMenuItem
                            onClick={() => {
                                onEditDashboard(entry);
                            }}
                        >
                            {t('nav_menu.edit_dashboard')}
                        </ContextMenuItem>
                        <ContextMenuItem
                            variant="destructive"
                            onClick={() => {
                                onDeleteDashboard(entry);
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
                            onClick={() => {
                                onUnpinTool(entry);
                            }}
                        >
                            {t('nav_menu.custom_nav.unpin_from_nav')}
                        </ContextMenuItem>
                    </ContextMenuGroup>
                ) : null}
                {isTool ? <ContextMenuSeparator /> : null}
                <ContextMenuGroup>
                    <ContextMenuItem onClick={onOpenCustomNav}>
                        {t('nav_menu.custom_nav.header')}
                    </ContextMenuItem>
                </ContextMenuGroup>
            </ContextMenuContent>
        </ContextMenu>
    );
}

export { DashboardEntryAction, NavItemContextMenu };
