import {
    ChevronRightIcon,
    MoreHorizontalIcon,
    PencilIcon,
    Trash2Icon
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';

import { cn } from '@/lib/utils.js';
import {
    DASHBOARD_NAV_KEY_PREFIX,
    DEFAULT_DASHBOARD_ICON
} from '@/shared/constants/dashboard.js';
import {
    DEFAULT_FOLDER_ICON,
    DEFAULT_NAV_ICON_KEY,
    getNavIconComponent
} from '@/shared/constants/navIcons.js';
import { isToolNavKey } from '@/shared/constants/tools.js';
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
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';
import {
    SidebarMenuAction,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarMenuSub,
    SidebarMenuSubButton,
    SidebarMenuSubItem
} from '@/ui/shadcn/sidebar';

import { getPathForNavEntry } from './navMenuModel.js';

export function labelForEntry(entry, t) {
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

export function themeModeLabel(themeMode, t) {
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

export function isEntryActive(entry, pathname) {
    const path = getPathForNavEntry(entry);
    if (!path) {
        return false;
    }
    if (entry?.routeName === 'tools') {
        return pathname === '/tools';
    }
    return pathname === path || pathname.startsWith(`${path}/`);
}

export function isDashboardEntry(entry) {
    return String(entry?.index || '').startsWith(DASHBOARD_NAV_KEY_PREFIX);
}

export function isToolEntry(entry) {
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

export function removeNavKeyFromLayout(layout, navKey) {
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

export function NavItemContextMenu({
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

export function NavMenuFolderItem({
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

export function NavMenuEntryItem({
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
