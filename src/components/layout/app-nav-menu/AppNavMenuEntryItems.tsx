import {
    ChevronRightIcon,
    PencilIcon,
    PinOffIcon,
    Trash2Icon
} from 'lucide-react';
import { memo, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router';

import { ShortcutKey } from '@/components/keyboard/ShortcutHintPanel';
import { cn } from '@/lib/utils';
import { useNavigationCacheStore } from '@/state/navigationCacheStore';
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
    SidebarMenuBadge,
    SidebarMenuItem,
    SidebarMenuSub,
    SidebarMenuSubButton,
    SidebarMenuSubItem
} from '@/ui/shadcn/sidebar';

import { getPathForNavEntry } from '../navMenuModel';
import type { NavMenuItem } from '../navMenuModel';
import {
    DashboardEntryAction,
    NavItemContextMenu
} from './AppNavItemContextMenu';
import { navMenuLucideClassName, NotifiedNavIcon } from './AppNavMenuIcons';
import {
    isDashboardEntry,
    isEntryActive,
    isEntryNotified,
    isNavItemNotified,
    isToolEntry,
    labelForEntry
} from './AppNavMenuUtils';
import type { NavEntryHandler, NavMenuActionHandlers } from './types';

function CollapsedFolderDropdownEntry({
    entry,
    isNotified,
    onSelect,
    onEditDashboard,
    onDeleteDashboard,
    onUnpinTool
}: {
    entry: NavMenuItem;
    isNotified: boolean;
    onSelect: NavEntryHandler;
    onEditDashboard: NavEntryHandler;
    onDeleteDashboard: NavEntryHandler;
    onUnpinTool: NavEntryHandler;
}) {
    const { t } = useTranslation();
    const isDashboard = isDashboardEntry(entry);
    const isTool = isToolEntry(entry);
    if (!isDashboard && !isTool) {
        return (
            <DropdownMenuGroup>
                <DropdownMenuItem
                    onClick={() => {
                        onSelect(entry);
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
                        onClick={() => {
                            onSelect(entry);
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
                    </DropdownMenuGroup>
                ) : null}
                {isTool ? (
                    <DropdownMenuGroup>
                        <DropdownMenuItem
                            onClick={() => {
                                onUnpinTool(entry);
                            }}
                        >
                            <PinOffIcon />
                            {t('nav_menu.custom_nav.unpin_from_nav')}
                        </DropdownMenuItem>
                    </DropdownMenuGroup>
                ) : null}
            </DropdownMenuSubContent>
        </DropdownMenuSub>
    );
}

const NavMenuFolderItem = memo(function NavMenuFolderItem({
    item,
    isCollapsed,
    shortcutHintsVisible,
    shortcutPositionByIndex,
    activeIndex,
    pathname,
    notifiedKeys,
    hasNotifications,
    onSelect,
    onMarkAllRead,
    onEditDashboard,
    onDeleteDashboard,
    onUnpinTool,
    onOpenCustomNav
}: NavMenuActionHandlers & {
    item: NavMenuItem;
    isCollapsed: boolean;
    shortcutHintsVisible: boolean;
    shortcutPositionByIndex: ReadonlyMap<string, number>;
    activeIndex: string;
    pathname: string;
    notifiedKeys: ReadonlySet<string>;
    hasNotifications: boolean;
}) {
    const { t } = useTranslation();
    const children = item.children ?? [];
    const rememberedOpen = useNavigationCacheStore(
        (state) => state.folders[item.index]
    );
    const setFolderOpen = useNavigationCacheStore(
        (state) => state.setFolderOpen
    );
    const label = labelForEntry(item, t);
    const isActive = children.some(
        (entry) => entry.index === activeIndex || isEntryActive(entry, pathname)
    );
    const isNotified = isNavItemNotified(item, notifiedKeys);
    const open = rememberedOpen ?? isActive;
    const wasActive = useRef(isActive);
    const shortcutPositions = children
        .map((entry) => shortcutPositionByIndex.get(entry.index))
        .filter((position): position is number => position !== undefined);
    const firstShortcutPosition = shortcutPositions[0];
    const lastShortcutPosition = shortcutPositions.at(-1);
    const folderShortcutLabel =
        firstShortcutPosition === undefined
            ? ''
            : firstShortcutPosition === lastShortcutPosition
              ? String(firstShortcutPosition)
              : `${firstShortcutPosition}–${lastShortcutPosition}`;

    useEffect(() => {
        if (rememberedOpen === undefined || (isActive && !wasActive.current)) {
            setFolderOpen(item.index, isActive);
        }
        wasActive.current = isActive;
    }, [isActive, item.index, rememberedOpen, setFolderOpen]);

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
            >
                <SidebarMenuItem>
                    <DropdownMenu>
                        <DropdownMenuTrigger
                            render={
                                <SidebarMenuButton
                                    isActive={Boolean(isActive)}
                                    tooltip={label}
                                    className={navMenuLucideClassName}
                                >
                                    <NotifiedNavIcon
                                        entry={item}
                                        isNotified={isNotified}
                                    />
                                    <span>{label}</span>
                                </SidebarMenuButton>
                            }
                        />
                        <DropdownMenuContent
                            side="right"
                            align="start"
                            className="w-56"
                        >
                            {children.map((entry) => (
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
        >
            <SidebarMenuItem>
                <SidebarMenuButton
                    type="button"
                    isActive={Boolean(isActive)}
                    tooltip={label}
                    className={navMenuLucideClassName}
                    onClick={() => setFolderOpen(item.index, !open)}
                >
                    <NotifiedNavIcon entry={item} isNotified={isNotified} />
                    <span>{label}</span>
                    {shortcutHintsVisible && !open && folderShortcutLabel ? (
                        <ShortcutKey
                            keys={folderShortcutLabel}
                            className="ml-auto"
                        />
                    ) : (
                        <ChevronRightIcon
                            className={cn(
                                'ml-auto transition-transform',
                                open && 'rotate-90'
                            )}
                        />
                    )}
                </SidebarMenuButton>
                {open ? (
                    <SidebarMenuSub>
                        {children.map((entry) => {
                            const shortcutPosition =
                                shortcutPositionByIndex.get(entry.index);
                            const showShortcut =
                                shortcutHintsVisible &&
                                shortcutPosition !== undefined;
                            return (
                                <NavItemContextMenu
                                    key={entry.index}
                                    entry={entry}
                                    hasNotifications={hasNotifications}
                                    onMarkAllRead={onMarkAllRead}
                                    onEditDashboard={onEditDashboard}
                                    onDeleteDashboard={onDeleteDashboard}
                                    onUnpinTool={onUnpinTool}
                                    onOpenCustomNav={onOpenCustomNav}
                                >
                                    <SidebarMenuSubItem>
                                        <SidebarMenuSubButton
                                            type="button"
                                            className={cn(
                                                (isDashboardEntry(entry) ||
                                                    isToolEntry(entry)) &&
                                                    'pr-8',
                                                showShortcut && 'pr-8',
                                                navMenuLucideClassName
                                            )}
                                            isActive={
                                                entry.index === activeIndex ||
                                                isEntryActive(entry, pathname)
                                            }
                                            onClick={() => {
                                                onSelect(entry);
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
                                            <span>
                                                {labelForEntry(entry, t)}
                                            </span>
                                        </SidebarMenuSubButton>
                                        {showShortcut ? (
                                            <ShortcutKey
                                                keys={String(shortcutPosition)}
                                                className="absolute top-1 right-1"
                                            />
                                        ) : (
                                            <DashboardEntryAction
                                                entry={entry}
                                                onEditDashboard={
                                                    onEditDashboard
                                                }
                                                onDeleteDashboard={
                                                    onDeleteDashboard
                                                }
                                                onUnpinTool={onUnpinTool}
                                                compact
                                            />
                                        )}
                                    </SidebarMenuSubItem>
                                </NavItemContextMenu>
                            );
                        })}
                    </SidebarMenuSub>
                ) : null}
            </SidebarMenuItem>
        </NavItemContextMenu>
    );
});

const NavMenuEntryItem = memo(function NavMenuEntryItem({
    item,
    shortcutHintsVisible,
    shortcutPositionByIndex,
    isActive,
    notifiedKeys,
    hasNotifications,
    onSelect,
    onMarkAllRead,
    onEditDashboard,
    onDeleteDashboard,
    onUnpinTool,
    onOpenCustomNav
}: NavMenuActionHandlers & {
    item: NavMenuItem;
    shortcutHintsVisible: boolean;
    shortcutPositionByIndex: ReadonlyMap<string, number>;
    isActive: boolean;
    notifiedKeys: ReadonlySet<string>;
    hasNotifications: boolean;
}) {
    const { t } = useTranslation();
    const itemPath = getPathForNavEntry(item);
    const shortcutPosition = shortcutPositionByIndex.get(item.index);
    const showShortcut = shortcutHintsVisible && shortcutPosition !== undefined;

    return (
        <NavItemContextMenu
            entry={item}
            hasNotifications={hasNotifications}
            onMarkAllRead={onMarkAllRead}
            onEditDashboard={onEditDashboard}
            onDeleteDashboard={onDeleteDashboard}
            onUnpinTool={onUnpinTool}
            onOpenCustomNav={onOpenCustomNav}
        >
            <SidebarMenuItem>
                <SidebarMenuButton
                    render={itemPath ? <NavLink to={itemPath} /> : undefined}
                    isActive={isActive}
                    tooltip={labelForEntry(item, t)}
                    className={cn(
                        navMenuLucideClassName,
                        (isDashboardEntry(item) || isToolEntry(item)) && 'pr-8',
                        showShortcut && 'pr-8'
                    )}
                    onClick={
                        itemPath
                            ? undefined
                            : () => {
                                  onSelect(item);
                              }
                    }
                >
                    <NotifiedNavIcon
                        entry={item}
                        isNotified={isNavItemNotified(item, notifiedKeys)}
                    />
                    <span>{labelForEntry(item, t)}</span>
                </SidebarMenuButton>
                {showShortcut ? (
                    <SidebarMenuBadge className="p-0">
                        <ShortcutKey keys={String(shortcutPosition)} />
                    </SidebarMenuBadge>
                ) : (
                    <DashboardEntryAction
                        entry={item}
                        onEditDashboard={onEditDashboard}
                        onDeleteDashboard={onDeleteDashboard}
                        onUnpinTool={onUnpinTool}
                    />
                )}
            </SidebarMenuItem>
        </NavItemContextMenu>
    );
});

export { NavMenuEntryItem, NavMenuFolderItem };
