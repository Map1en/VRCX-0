import {
    MoreHorizontalIcon,
    PencilIcon,
    PinOffIcon,
    Trash2Icon
} from 'lucide-react';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { useVrcNotificationStore } from '@/state/vrcNotificationStore';
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
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';
import { SidebarMenuAction } from '@/ui/shadcn/sidebar';

import type { NavMenuItem } from '../navMenuModel';
import { isDashboardEntry, isToolEntry } from './AppNavMenuUtils';
import type { NavEntryHandler } from './types';

function DashboardEntryAction({
    entry,
    onEditDashboard,
    onDeleteDashboard,
    onUnpinTool,
    compact = false
}: {
    entry: NavMenuItem;
    onEditDashboard: NavEntryHandler;
    onDeleteDashboard: NavEntryHandler;
    onUnpinTool: NavEntryHandler;
    compact?: boolean;
}) {
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
                {isDashboard ? (
                    <>
                        <DropdownMenuGroup>
                            <DropdownMenuItem
                                onClick={() => {
                                    if (entry) {
                                        onEditDashboard(entry);
                                    }
                                }}
                            >
                                <PencilIcon />
                                {t('nav_menu.edit_dashboard')}
                            </DropdownMenuItem>
                        </DropdownMenuGroup>
                        <DropdownMenuSeparator />
                        <DropdownMenuGroup>
                            <DropdownMenuItem
                                variant="destructive"
                                onClick={() => {
                                    if (entry) {
                                        onDeleteDashboard(entry);
                                    }
                                }}
                            >
                                <Trash2Icon />
                                {t('nav_menu.delete_dashboard')}
                            </DropdownMenuItem>
                        </DropdownMenuGroup>
                    </>
                ) : null}
                {isTool ? (
                    <DropdownMenuGroup>
                        <DropdownMenuItem
                            onClick={() => {
                                if (entry) {
                                    onUnpinTool(entry);
                                }
                            }}
                        >
                            <PinOffIcon />
                            {t('nav_menu.custom_nav.unpin_from_nav')}
                        </DropdownMenuItem>
                    </DropdownMenuGroup>
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
    onOpenCustomNav
}: {
    children: ReactElement;
    entry?: NavMenuItem;
    hasNotifications: boolean;
    showCreateDashboard?: boolean;
    onMarkAllRead: () => void | Promise<void>;
    onCreateDashboard?: () => void | Promise<void>;
    onEditDashboard: NavEntryHandler;
    onDeleteDashboard: NavEntryHandler;
    onUnpinTool: NavEntryHandler;
    onOpenCustomNav: () => void;
}) {
    const { t } = useTranslation();
    const isMarkingAllRead = useVrcNotificationStore(
        (state) => state.markAllSeenProgress !== null
    );
    const isDashboard = isDashboardEntry(entry);
    const isTool = isToolEntry(entry);

    return (
        <ContextMenu>
            <ContextMenuTrigger render={children} />
            <ContextMenuContent className="w-56">
                {hasNotifications ? (
                    <ContextMenuGroup>
                        <ContextMenuItem
                            disabled={isMarkingAllRead}
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
                                onCreateDashboard?.();
                            }}
                        >
                            {t('dashboard.new_dashboard')}
                        </ContextMenuItem>
                    </ContextMenuGroup>
                ) : null}
                {isDashboard ? (
                    <>
                        <ContextMenuGroup>
                            <ContextMenuItem
                                onClick={() => {
                                    if (entry) {
                                        onEditDashboard(entry);
                                    }
                                }}
                            >
                                {t('nav_menu.edit_dashboard')}
                            </ContextMenuItem>
                        </ContextMenuGroup>
                        <ContextMenuSeparator />
                        <ContextMenuGroup>
                            <ContextMenuItem
                                variant="destructive"
                                onClick={() => {
                                    if (entry) {
                                        onDeleteDashboard(entry);
                                    }
                                }}
                            >
                                {t('nav_menu.delete_dashboard')}
                            </ContextMenuItem>
                        </ContextMenuGroup>
                    </>
                ) : null}
                {isDashboard ? <ContextMenuSeparator /> : null}
                {isTool ? (
                    <ContextMenuGroup>
                        <ContextMenuItem
                            onClick={() => {
                                if (entry) {
                                    onUnpinTool(entry);
                                }
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
