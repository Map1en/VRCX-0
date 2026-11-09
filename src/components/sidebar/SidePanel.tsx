import {
    EyeOffIcon,
    PlusIcon,
    SearchIcon,
    SlidersHorizontalIcon,
    XIcon
} from 'lucide-react';
import { forwardRef, useEffect, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';

import { getNavIconComponent } from '@/components/layout/navIconRegistry';
import { cn } from '@/lib/utils';
import configRepository from '@/repositories/configRepository';
import { refreshFriendAndFavoriteSnapshots } from '@/services/backgroundMaintenanceService';
import { toast } from '@/services/toastService';
import { restoreNormalWindowModeForIntent } from '@/services/windowModeService';
import { SECOND_MS } from '@/shared/constants/time';
import { onPreferenceChanged } from '@/shared/events/preferenceEvents';
import {
    sidebarTabFallbackIcon,
    type SidebarFavoriteCollectionTabLayoutItem,
    type SidebarTabLayout,
    type SidebarWorldRoomsTabLayoutItem
} from '@/shared/utils/sidebarTabLayout';
import { useRuntimeStore } from '@/state/runtimeStore';
import {
    hydrateSidebarTabLayout,
    saveSidebarTabLayout
} from '@/state/sidebarTabStore';
import { HintTooltip } from '@/ui/hint-tooltip';
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
    InputGroup,
    InputGroupAddon,
    InputGroupButton,
    InputGroupInput
} from '@/ui/shadcn/input-group';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/shadcn/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import { FriendsSidebar } from './FriendsSidebar';
import { GroupsSidebar } from './GroupsSidebar';
import { SidePanelCustomTabsDialog } from './side-panel/SidePanelCustomTabsDialog';
import { SidePanelFavoriteGroupOrderDialog } from './side-panel/SidePanelFavoriteGroupOrderDialog';
import { SidePanelSelfHeader } from './side-panel/SidePanelSelfHeader';
import { SidePanelSettingsPopover } from './side-panel/SidePanelSettingsPopover';
import type {
    SidePanelPreferences,
    SidePanelSortMethod
} from './side-panel/sidePanelTypes';
import { useSidePanelActiveTab } from './side-panel/useSidePanelActiveTab';
import { useSidePanelSettingsState } from './useSidePanelSettingsState';
import { useSidePanelTabData } from './useSidePanelTabData';
import { WorldRoomsSidebar } from './world-rooms/WorldRoomsSidebar';
import { WorldRoomsTabRail } from './world-rooms/WorldRoomsTabRail';

const defaultPrefs: SidePanelPreferences = {
    sidebarGroupByInstance: true,
    isHideFriendsInSameInstance: true,
    isSameInstanceAboveFavorites: false,
    isSidebarDivideByFriendGroup: false,
    sidebarSortMethod1: 'Sort by Status',
    sidebarSortMethod2: 'Sort Alphabetically',
    sidebarSortMethod3: '',
    sidebarFavoriteGroups: [],
    sidebarFavoriteGroupOrder: []
};

const FRIEND_REFRESH_COOLDOWN_MS = 30 * SECOND_MS;

type SidePanelProps = {
    className?: string;
    style?: CSSProperties;
    sidebarWindowMode?: boolean;
};

function parseConfigArray(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value.filter(
            (entry): entry is string => typeof entry === 'string'
        );
    }
    if (typeof value !== 'string' || !value.trim()) {
        return [];
    }
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed)
            ? parsed.filter(
                  (entry): entry is string => typeof entry === 'string'
              )
            : [];
    } catch {
        return [];
    }
}

function toSidePanelSortMethod(value: string): SidePanelSortMethod {
    switch (value) {
        case 'Sort Alphabetically':
        case 'Sort Private to Bottom':
        case 'Sort by Status':
        case 'Sort by Last Active':
        case 'Sort by Last Seen':
        case 'Sort by Time in Instance':
        case 'Sort by Location':
        case 'None':
            return value;
        default:
            return '';
    }
}

export const SidePanel = forwardRef<HTMLElement, SidePanelProps>(
    function SidePanel(
        { className = '', style = undefined, sidebarWindowMode = false },
        ref
    ) {
        const { t } = useTranslation();
        const { activeTab, setActiveTab } = useSidePanelActiveTab();
        const [prefs, setPrefs] = useState(defaultPrefs);
        const [isRefreshing, setIsRefreshing] = useState(false);
        const [friendRefreshCooldownUntil, setFriendRefreshCooldownUntil] =
            useState(0);
        const [customTabsDialogOpen, setCustomTabsDialogOpen] = useState(false);
        const [filter, setFilter] = useState({ tab: activeTab, query: '' });
        const filterQuery = filter.tab === activeTab ? filter.query : '';

        function setFilterQuery(query: string) {
            setFilter({ tab: activeTab, query });
        }

        function openCustomTabsDialog() {
            restoreNormalWindowModeForIntent();
            setCustomTabsDialogOpen(true);
        }

        useEffect(() => {
            let active = true;
            Promise.all([
                configRepository.getBool(
                    'sidebarGroupByInstance',
                    defaultPrefs.sidebarGroupByInstance
                ),
                configRepository.getBool(
                    'isHideFriendsInSameInstance',
                    defaultPrefs.isHideFriendsInSameInstance
                ),
                configRepository.getBool(
                    'isSameInstanceAboveFavorites',
                    defaultPrefs.isSameInstanceAboveFavorites
                ),
                configRepository.getBool(
                    'isSidebarDivideByFriendGroup',
                    defaultPrefs.isSidebarDivideByFriendGroup
                ),
                configRepository.getString(
                    'sidebarSortMethod1',
                    defaultPrefs.sidebarSortMethod1
                ),
                configRepository.getString(
                    'sidebarSortMethod2',
                    defaultPrefs.sidebarSortMethod2
                ),
                configRepository.getString(
                    'sidebarSortMethod3',
                    defaultPrefs.sidebarSortMethod3
                ),
                configRepository.getString('sidebarFavoriteGroups', '[]'),
                configRepository.getString('sidebarFavoriteGroupOrder', '[]')
            ])
                .then(
                    ([
                        sidebarGroupByInstance,
                        isHideFriendsInSameInstance,
                        isSameInstanceAboveFavorites,
                        isSidebarDivideByFriendGroup,
                        sidebarSortMethod1,
                        sidebarSortMethod2,
                        sidebarSortMethod3,
                        sidebarFavoriteGroups,
                        sidebarFavoriteGroupOrder
                    ]) => {
                        if (!active) {
                            return;
                        }
                        setPrefs({
                            sidebarGroupByInstance: Boolean(
                                sidebarGroupByInstance
                            ),
                            isHideFriendsInSameInstance: Boolean(
                                isHideFriendsInSameInstance
                            ),
                            isSameInstanceAboveFavorites: Boolean(
                                isSameInstanceAboveFavorites
                            ),
                            isSidebarDivideByFriendGroup: Boolean(
                                isSidebarDivideByFriendGroup
                            ),
                            sidebarSortMethod1: toSidePanelSortMethod(
                                sidebarSortMethod1 || ''
                            ),
                            sidebarSortMethod2: toSidePanelSortMethod(
                                sidebarSortMethod2 || ''
                            ),
                            sidebarSortMethod3: toSidePanelSortMethod(
                                sidebarSortMethod3 || ''
                            ),
                            sidebarFavoriteGroups: parseConfigArray(
                                sidebarFavoriteGroups
                            ),
                            sidebarFavoriteGroupOrder: parseConfigArray(
                                sidebarFavoriteGroupOrder
                            )
                        });
                    }
                )
                .catch(() => {});
            hydrateSidebarTabLayout().catch(() => {});
            return () => {
                active = false;
            };
        }, []);

        useEffect(() => {
            const unsubscribeGroups = onPreferenceChanged(
                'sidebarFavoriteGroups',
                (value) =>
                    setPrefs((current) => ({
                        ...current,
                        sidebarFavoriteGroups: parseConfigArray(value)
                    }))
            );
            const unsubscribeOrder = onPreferenceChanged(
                'sidebarFavoriteGroupOrder',
                (value) =>
                    setPrefs((current) => ({
                        ...current,
                        sidebarFavoriteGroupOrder: parseConfigArray(value)
                    }))
            );
            return () => {
                unsubscribeGroups();
                unsubscribeOrder();
            };
        }, []);

        const {
            allFavoriteGroupKeys,
            favoriteGroupItems,
            favoriteLoadStatus,
            groupsTabVisible,
            orderedFavoriteGroupItems,
            resolvedSidebarFavoriteGroups,
            selectedFavoriteGroupLabel,
            tabItems,
            tabLayout,
            visibleTabLayout
        } = useSidePanelTabData({ activeTab, prefs, setActiveTab });
        const worldRoomsTabs = visibleTabLayout.filter(
            (item): item is SidebarWorldRoomsTabLayoutItem =>
                item.type === 'worldRooms'
        );
        const filterPlaceholder =
            activeTab === 'groups'
                ? t('side_panel.filter_groups')
                : worldRoomsTabs.some((item) => item.id === activeTab)
                  ? t('side_panel.filter_instances')
                  : t('side_panel.filter_friends');

        const {
            favoriteGroupOrderDialogOpen,
            favoriteGroupOrderDraft,
            isAdvancedOpen,
            moveFavoriteGroupOrder,
            resetFavoriteGroupOrder,
            confirmFavoriteGroupOrder,
            settingsPopoverOpen,
            setFavoriteGroupOrderDialogOpen,
            setIsAdvancedOpen,
            setSettingsPopoverOpen,
            toggleFavoriteGroup,
            updateBoolPreference,
            updateStringPreference
        } = useSidePanelSettingsState({
            allFavoriteGroupKeys,
            orderedFavoriteGroupItems,
            prefs,
            resolvedSidebarFavoriteGroups,
            setPrefs
        });

        async function refreshFriends() {
            if (isRefreshing) {
                return;
            }
            const cooldownRemainingMs = friendRefreshCooldownUntil - Date.now();
            if (cooldownRemainingMs > 0) {
                toast.add({
                    type: 'info',
                    title: t('side_panel.refresh_available_in_seconds', {
                        count: Math.max(
                            1,
                            Math.ceil(cooldownRemainingMs / SECOND_MS)
                        )
                    })
                });
                return;
            }
            const auth = useRuntimeStore.getState().auth;
            if (!auth.currentUserId || !auth.currentUserSnapshot) {
                toast.add({
                    type: 'error',
                    title: t(
                        'side_panel.empty.no_authenticated_user_snapshot_is_available'
                    )
                });
                return;
            }
            setIsRefreshing(true);
            try {
                await refreshFriendAndFavoriteSnapshots();
                setFriendRefreshCooldownUntil(
                    Date.now() + FRIEND_REFRESH_COOLDOWN_MS
                );
                toast.add({
                    type: 'success',
                    title: t(
                        'side_panel.success.friend_and_favorite_snapshots_refreshed'
                    )
                });
            } catch (error) {
                toast.add({
                    type: 'error',
                    title:
                        error instanceof Error
                            ? error.message
                            : t(
                                  'component.side_panel.toast.failed_to_refresh_friends'
                              )
                });
            } finally {
                setIsRefreshing(false);
            }
        }

        function saveCustomTabs(nextLayout: SidebarTabLayout) {
            void saveSidebarTabLayout(nextLayout);
        }

        function setTabVisibilityFromMenu(tabId: string, visible: boolean) {
            const nextLayout = tabLayout.map((item) => {
                if (item.type === 'system' && item.systemTab === 'friends') {
                    return { ...item, visible: true };
                }
                if (item.id !== tabId) {
                    return item;
                }
                if (item.type === 'system' && item.systemTab === 'groups') {
                    return { ...item, visible: Boolean(visible) };
                }
                if (item.type !== 'system') {
                    return { ...item, visible: Boolean(visible) };
                }
                return item;
            });
            saveCustomTabs(nextLayout);
        }

        return (
            <aside
                ref={ref}
                data-vrcx-0-surface="side-panel"
                data-window-sidebar-mode={
                    sidebarWindowMode ? 'true' : undefined
                }
                className={cn(
                    'vrcx-0-side-panel flex min-h-0 w-80 shrink-0 flex-col overflow-hidden',
                    className
                )}
                style={style}
            >
                <SidePanelSelfHeader />
                <Tabs
                    orientation="vertical"
                    value={activeTab}
                    onValueChange={setActiveTab}
                    className="flex min-h-0 min-w-0 flex-1 gap-0 overflow-hidden"
                >
                    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden pb-2 pl-2">
                        <div className="shrink-0 pt-1 pr-1.5 pb-2 pl-0.5">
                            <InputGroup
                                className={cn(
                                    'border-border-subtle h-7 rounded-md',
                                    'bg-surface-interactive dark:bg-surface-interactive',
                                    'hover:bg-surface-interactive-hover dark:hover:bg-surface-interactive-hover'
                                )}
                            >
                                <InputGroupInput
                                    value={filterQuery}
                                    placeholder={filterPlaceholder}
                                    aria-label={filterPlaceholder}
                                    className="h-7 pl-2.5 text-xs md:text-xs"
                                    onChange={(event) =>
                                        setFilterQuery(event.target.value)
                                    }
                                    onKeyDown={(event) => {
                                        if (event.key === 'Escape') {
                                            setFilterQuery('');
                                        }
                                    }}
                                />
                                <InputGroupAddon align="inline-end">
                                    {filterQuery ? (
                                        <InputGroupButton
                                            size="icon-xs"
                                            aria-label={t(
                                                'empty_state.clear_search'
                                            )}
                                            onClick={() => setFilterQuery('')}
                                        >
                                            <XIcon />
                                        </InputGroupButton>
                                    ) : (
                                        <SearchIcon className="size-3.5" />
                                    )}
                                </InputGroupAddon>
                            </InputGroup>
                        </div>
                        <TabsContent
                            value="friends"
                            className="min-h-0 flex-1 overflow-hidden data-hidden:hidden"
                        >
                            <FriendsSidebar
                                prefs={prefs}
                                filterQuery={filterQuery}
                            />
                        </TabsContent>
                        {groupsTabVisible ? (
                            <TabsContent
                                value="groups"
                                className="min-h-0 flex-1 overflow-hidden data-hidden:hidden"
                            >
                                <GroupsSidebar filterQuery={filterQuery} />
                            </TabsContent>
                        ) : null}
                        {visibleTabLayout
                            .filter(
                                (
                                    item
                                ): item is SidebarFavoriteCollectionTabLayoutItem =>
                                    item.type === 'favoriteCollection'
                            )
                            .map((item) => (
                                <TabsContent
                                    key={item.id}
                                    value={item.id}
                                    className="min-h-0 flex-1 overflow-hidden data-hidden:hidden"
                                >
                                    <FriendsSidebar
                                        prefs={prefs}
                                        favoriteCollectionTab={item}
                                        filterQuery={filterQuery}
                                    />
                                </TabsContent>
                            ))}
                        {worldRoomsTabs.map((item) => (
                            <TabsContent
                                key={item.id}
                                value={item.id}
                                className="min-h-0 flex-1 overflow-hidden data-hidden:hidden"
                            >
                                <WorldRoomsSidebar
                                    tab={item}
                                    filterQuery={filterQuery}
                                />
                            </TabsContent>
                        ))}
                    </div>
                    <div className="vrcx-0-side-panel-rail flex w-9 shrink-0 flex-col items-center gap-0.5 py-1.5">
                        <TabsList
                            variant="underline"
                            className="w-full flex-col gap-0.5 p-0 [&>[data-slot=tab-indicator]]:hidden"
                        >
                            {tabItems.map((item) => {
                                const Icon =
                                    item.layoutItem.type === 'worldRooms'
                                        ? null
                                        : getNavIconComponent(
                                              item.icon,
                                              sidebarTabFallbackIcon(
                                                  item.layoutItem
                                              )
                                          );
                                const canHideTab =
                                    item.layoutItem.type !== 'system' ||
                                    item.layoutItem.systemTab === 'groups';
                                const hideLabel =
                                    item.layoutItem.type === 'system' &&
                                    item.layoutItem.systemTab === 'groups'
                                        ? t(
                                              'side_panel.settings.custom_tabs.hide_groups'
                                          )
                                        : t(
                                              'side_panel.settings.custom_tabs.hide_tab'
                                          );
                                return (
                                    <ContextMenu key={item.value}>
                                        <Tooltip>
                                            <TooltipTrigger
                                                render={
                                                    <ContextMenuTrigger
                                                        render={
                                                            <TabsTrigger
                                                                value={
                                                                    item.value
                                                                }
                                                                data-active={
                                                                    activeTab ===
                                                                    item.value
                                                                        ? ''
                                                                        : undefined
                                                                }
                                                                className="data-active:bg-secondary h-auto w-full flex-col justify-center gap-0.5 px-0 py-1.5 sm:h-auto"
                                                            />
                                                        }
                                                    />
                                                }
                                            >
                                                {Icon ? (
                                                    <Icon
                                                        className="size-4.5"
                                                        data-icon="icon"
                                                    />
                                                ) : null}
                                                <span className="sr-only">
                                                    {item.label}
                                                </span>
                                                {item.layoutItem.type ===
                                                'worldRooms' ? (
                                                    <WorldRoomsTabRail
                                                        worldId={
                                                            item.layoutItem
                                                                .worldId
                                                        }
                                                    />
                                                ) : item.railCountLabel ? (
                                                    <span className="text-[10px] leading-none tabular-nums">
                                                        {item.railCountLabel}
                                                    </span>
                                                ) : null}
                                            </TooltipTrigger>
                                            <TooltipContent>
                                                {item.title}
                                            </TooltipContent>
                                        </Tooltip>
                                        <ContextMenuContent className="w-44">
                                            {canHideTab ? (
                                                <>
                                                    <ContextMenuGroup>
                                                        <ContextMenuItem
                                                            onClick={() =>
                                                                setTabVisibilityFromMenu(
                                                                    item
                                                                        .layoutItem
                                                                        .id,
                                                                    false
                                                                )
                                                            }
                                                        >
                                                            <EyeOffIcon />
                                                            {hideLabel}
                                                        </ContextMenuItem>
                                                    </ContextMenuGroup>
                                                    <ContextMenuSeparator />
                                                </>
                                            ) : null}
                                            <ContextMenuGroup>
                                                <ContextMenuItem
                                                    onClick={() =>
                                                        openCustomTabsDialog()
                                                    }
                                                >
                                                    <SlidersHorizontalIcon />
                                                    {t(
                                                        'side_panel.settings.custom_tabs.configure'
                                                    )}
                                                </ContextMenuItem>
                                            </ContextMenuGroup>
                                        </ContextMenuContent>
                                    </ContextMenu>
                                );
                            })}
                        </TabsList>
                        <HintTooltip
                            label={t(
                                'side_panel.settings.custom_tabs.configure'
                            )}
                        >
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="text-muted-foreground shrink-0"
                                onClick={openCustomTabsDialog}
                            >
                                <PlusIcon data-icon="icon" />
                            </Button>
                        </HintTooltip>
                        <div className="mt-auto shrink-0">
                            <SidePanelSettingsPopover
                                open={settingsPopoverOpen}
                                onOpenChange={setSettingsPopoverOpen}
                                isRefreshing={isRefreshing}
                                onRefreshFriends={() => {
                                    refreshFriends();
                                }}
                                prefs={prefs}
                                onUpdateBoolPreference={updateBoolPreference}
                                onUpdateStringPreference={
                                    updateStringPreference
                                }
                                isAdvancedOpen={isAdvancedOpen}
                                onAdvancedOpenChange={setIsAdvancedOpen}
                                favoriteGroupItems={favoriteGroupItems}
                                favoriteLoadStatus={favoriteLoadStatus}
                                selectedFavoriteGroupLabel={
                                    selectedFavoriteGroupLabel
                                }
                                resolvedSidebarFavoriteGroups={
                                    resolvedSidebarFavoriteGroups
                                }
                                onToggleFavoriteGroup={toggleFavoriteGroup}
                                orderedFavoriteGroupItemsLength={
                                    orderedFavoriteGroupItems.length
                                }
                                onOpenFavoriteGroupOrderDialog={() => {
                                    restoreNormalWindowModeForIntent();
                                    setFavoriteGroupOrderDialogOpen(true);
                                }}
                                onOpenCustomTabsDialog={() =>
                                    openCustomTabsDialog()
                                }
                            />
                        </div>
                    </div>
                </Tabs>
                <SidePanelFavoriteGroupOrderDialog
                    open={favoriteGroupOrderDialogOpen}
                    onOpenChange={setFavoriteGroupOrderDialogOpen}
                    favoriteGroupOrderDraft={favoriteGroupOrderDraft}
                    onMove={moveFavoriteGroupOrder}
                    onReset={resetFavoriteGroupOrder}
                    onConfirm={confirmFavoriteGroupOrder}
                />
                <SidePanelCustomTabsDialog
                    open={customTabsDialogOpen}
                    onOpenChange={setCustomTabsDialogOpen}
                    layout={tabLayout}
                    favoriteGroupItems={favoriteGroupItems}
                    onSave={saveCustomTabs}
                />
            </aside>
        );
    }
);
