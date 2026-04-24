import { ChevronRightIcon, PencilIcon, Trash2Icon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';

import { cn } from '@/lib/utils.js';
import {
    DropdownMenu,
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
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarMenuSub,
    SidebarMenuSubButton,
    SidebarMenuSubItem
} from '@/ui/shadcn/sidebar';

import { DashboardEntryAction, NavItemContextMenu } from './AppNavItemContextMenu.jsx';
import { NotifiedNavIcon } from './AppNavMenuIcons.jsx';
import {
    isDashboardEntry,
    isEntryActive,
    isEntryNotified,
    isNavItemNotified,
    isToolEntry,
    labelForEntry
} from './AppNavMenuUtils.js';
import { getPathForNavEntry } from '../navMenuModel.js';

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

function NavMenuEntryItem({
    item,
    activeIndex,
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
    const itemPath = getPathForNavEntry(item);

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
                    asChild={Boolean(itemPath)}
                    isActive={item.index === activeIndex}
                    tooltip={labelForEntry(item, t)}
                    className={
                        isDashboardEntry(item) || isToolEntry(item)
                            ? 'pr-8'
                            : undefined
                    }
                    onClick={
                        itemPath
                            ? undefined
                            : () => {
                                  void onSelect(item);
                              }
                    }
                >
                    {itemPath ? (
                        <NavLink to={itemPath}>
                            <NotifiedNavIcon
                                entry={item}
                                isNotified={isNavItemNotified(
                                    item,
                                    notifiedKeys
                                )}
                            />
                            <span>{labelForEntry(item, t)}</span>
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
                            <span>{labelForEntry(item, t)}</span>
                        </>
                    )}
                </SidebarMenuButton>
                <DashboardEntryAction
                    entry={item}
                    onEditDashboard={onEditDashboard}
                    onDeleteDashboard={onDeleteDashboard}
                    onUnpinTool={onUnpinTool}
                    t={t}
                />
            </SidebarMenuItem>
        </NavItemContextMenu>
    );
}

export { NavMenuEntryItem, NavMenuFolderItem };
