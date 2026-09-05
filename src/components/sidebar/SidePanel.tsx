import { EyeOffIcon, PlusIcon, SlidersHorizontalIcon } from 'lucide-react';
import { forwardRef, useEffect, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { getNavIconComponent } from '@/components/layout/navIconRegistry';
import { cn } from '@/lib/utils';
import configRepository from '@/repositories/configRepository';
import { refreshFriendAndFavoriteSnapshots } from '@/services/backgroundMaintenanceService';
import { restoreNormalWindowModeForIntent } from '@/services/windowModeService';
import { SECOND_MS } from '@/shared/constants/time';
import { useRuntimeStore } from '@/state/runtimeStore';
import { Button } from '@/ui/shadcn/button';
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuGroup,
    ContextMenuItem,
    ContextMenuSeparator,
    ContextMenuTrigger
} from '@/ui/shadcn/context-menu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/shadcn/tabs';

import { FriendsSidebar } from './FriendsSidebar';
import { GroupsSidebar } from './GroupsSidebar';
import {
    DEFAULT_SIDEBAR_TAB_LAYOUT,
    normalizeSidebarTabLayout,
    serializeSidebarTabLayout,
    sidebarTabFallbackIcon,
    type SidebarFavoriteCollectionTabLayoutItem,
    type SidebarTabLayout
} from './side-panel/sidebarTabLayout';
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

const defaultPrefs: SidePanelPreferences = {
    sidebarGroupByInstance: true,
    isShowCurrentUserInSameInstance: true,
    isHideFriendsInSameInstance: false,
    isSameInstanceAboveFavorites: false,
    isSidebarDivideByFriendGroup: false,
    sidebarSortMethod1: 'Sort by Status',
    sidebarSortMethod2: 'Sort Alphabetically',
    sidebarSortMethod3: '',
    sidebarFavoriteGroups: [],
    sidebarFavoriteGroupOrder: [],
    sidebarTabLayout: DEFAULT_SIDEBAR_TAB_LAYOUT
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
        const [customTabsAutoAdd, setCustomTabsAutoAdd] = useState(false);

        function openCustomTabsDialog(autoAdd = false) {
            restoreNormalWindowModeForIntent();
            setCustomTabsAutoAdd(autoAdd);
            setCustomTabsDialogOpen(true);
        }

        useEffect(() => {
            let active = true;
            Promise.all([
                configRepository.getBool('sidebarGroupByInstance', true),
                configRepository.getBool(
                    'isShowCurrentUserInSameInstance',
                    true
                ),
                configRepository.getBool('isHideFriendsInSameInstance', false),
                configRepository.getBool('isSameInstanceAboveFavorites', false),
                configRepository.getBool('isSidebarDivideByFriendGroup', false),
                configRepository.getString(
                    'sidebarSortMethod1',
                    'Sort by Status'
                ),
                configRepository.getString(
                    'sidebarSortMethod2',
                    'Sort Alphabetically'
                ),
                configRepository.getString('sidebarSortMethod3', ''),
                configRepository.getString('sidebarFavoriteGroups', '[]'),
                configRepository.getString('sidebarFavoriteGroupOrder', '[]'),
                configRepository.getString('sidebarTabLayout', '[]')
            ])
                .then(
                    ([
                        sidebarGroupByInstance,
                        isShowCurrentUserInSameInstance,
                        isHideFriendsInSameInstance,
                        isSameInstanceAboveFavorites,
                        isSidebarDivideByFriendGroup,
                        sidebarSortMethod1,
                        sidebarSortMethod2,
                        sidebarSortMethod3,
                        sidebarFavoriteGroups,
                        sidebarFavoriteGroupOrder,
                        sidebarTabLayout
                    ]) => {
                        if (!active) {
                            return;
                        }
                        setPrefs({
                            sidebarGroupByInstance: Boolean(
                                sidebarGroupByInstance
                            ),
                            isShowCurrentUserInSameInstance: Boolean(
                                isShowCurrentUserInSameInstance
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
                            ),
                            sidebarTabLayout:
                                normalizeSidebarTabLayout(sidebarTabLayout)
                        });
                    }
                )
                .catch(() => {});
            return () => {
                active = false;
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
            visibleFavoriteCollectionSourceGroupKeys,
            visibleTabLayout
        } = useSidePanelTabData({ activeTab, prefs, setActiveTab });

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
                toast.info(
                    t('side_panel.refresh_available_in_seconds', {
                        count: Math.max(
                            1,
                            Math.ceil(cooldownRemainingMs / SECOND_MS)
                        )
                    })
                );
                return;
            }
            const auth = useRuntimeStore.getState().auth;
            if (!auth.currentUserId || !auth.currentUserSnapshot) {
                toast.error(
                    t(
                        'side_panel.empty.no_authenticated_user_snapshot_is_available'
                    )
                );
                return;
            }
            setIsRefreshing(true);
            try {
                await refreshFriendAndFavoriteSnapshots();
                setFriendRefreshCooldownUntil(
                    Date.now() + FRIEND_REFRESH_COOLDOWN_MS
                );
                toast.success(
                    t(
                        'side_panel.success.friend_and_favorite_snapshots_refreshed'
                    )
                );
            } catch (error) {
                toast.error(
                    error instanceof Error
                        ? error.message
                        : t(
                              'component.side_panel.toast.failed_to_refresh_friends'
                          )
                );
            } finally {
                setIsRefreshing(false);
            }
        }

        function saveCustomTabs(nextLayout: SidebarTabLayout) {
            const normalizedLayout = normalizeSidebarTabLayout(nextLayout);
            setPrefs((current) => ({
                ...current,
                sidebarTabLayout: normalizedLayout
            }));
            configRepository.setString(
                'sidebarTabLayout',
                serializeSidebarTabLayout(normalizedLayout)
            );
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
                if (item.type === 'favoriteCollection') {
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
                        <TabsContent
                            value="friends"
                            className="min-h-0 flex-1 overflow-hidden data-hidden:hidden"
                        >
                            <FriendsSidebar
                                prefs={prefs}
                                excludedFavoriteGroupKeys={
                                    visibleFavoriteCollectionSourceGroupKeys
                                }
                            />
                        </TabsContent>
                        {groupsTabVisible ? (
                            <TabsContent
                                value="groups"
                                className="min-h-0 flex-1 overflow-hidden data-hidden:hidden"
                            >
                                <GroupsSidebar />
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
                                const Icon = getNavIconComponent(
                                    item.icon,
                                    sidebarTabFallbackIcon(item.layoutItem)
                                );
                                const canHideTab =
                                    item.layoutItem.type ===
                                        'favoriteCollection' ||
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
                                        <ContextMenuTrigger
                                            render={
                                                <TabsTrigger
                                                    value={item.value}
                                                    title={item.title}
                                                    data-active={
                                                        activeTab === item.value
                                                            ? ''
                                                            : undefined
                                                    }
                                                    className="h-auto w-full flex-col justify-center gap-0.5 px-0 py-1.5 data-active:bg-(--vrcx-0-toolbar-item-selected-surface)"
                                                >
                                                    <Icon data-icon="icon" />
                                                    <span className="sr-only">
                                                        {item.label}
                                                    </span>
                                                    {item.railCountLabel ? (
                                                        <span className="text-[10px] leading-none tabular-nums">
                                                            {
                                                                item.railCountLabel
                                                            }
                                                        </span>
                                                    ) : null}
                                                </TabsTrigger>
                                            }
                                        />
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
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="shrink-0"
                            title={t(
                                'side_panel.settings.custom_tabs.add_favorite_tab'
                            )}
                            aria-label={t(
                                'side_panel.settings.custom_tabs.add_favorite_tab'
                            )}
                            onClick={() => openCustomTabsDialog(true)}
                        >
                            <PlusIcon data-icon="icon" />
                        </Button>
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
                    onOpenChange={(open) => {
                        setCustomTabsDialogOpen(open);
                        if (!open) {
                            setCustomTabsAutoAdd(false);
                        }
                    }}
                    layout={tabLayout}
                    favoriteGroupItems={favoriteGroupItems}
                    autoCreateCollection={customTabsAutoAdd}
                    onSave={saveCustomTabs}
                />
            </aside>
        );
    }
);
