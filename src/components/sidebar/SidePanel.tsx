import { EyeOffIcon, PlusIcon, SlidersHorizontalIcon } from 'lucide-react';
import { forwardRef, useEffect, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { getNavIconComponent } from '@/components/layout/navIconRegistry';
import { cn } from '@/lib/utils';
import configRepository from '@/repositories/configRepository';
import { refreshFriendAndFavoriteSnapshots } from '@/services/backgroundMaintenanceService';
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
    normalizeSidebarTabDisplayMode,
    normalizeSidebarTabLayout,
    serializeSidebarTabLayout,
    sidebarTabFallbackIcon,
    type SidebarFavoriteCollectionTabLayoutItem,
    type SidebarTabDisplayMode,
    type SidebarTabLayout
} from './side-panel/sidebarTabLayout';
import { SidePanelCustomTabsDialog } from './side-panel/SidePanelCustomTabsDialog';
import { SidePanelFavoriteGroupOrderDialog } from './side-panel/SidePanelFavoriteGroupOrderDialog';
import { SidePanelSettingsPopover } from './side-panel/SidePanelSettingsPopover';
import type {
    SidePanelPreferences,
    SidePanelSortMethod
} from './side-panel/sidePanelTypes';
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
    sidebarTabLayout: DEFAULT_SIDEBAR_TAB_LAYOUT,
    sidebarTabDisplayMode: 'auto'
};

const FRIEND_REFRESH_COOLDOWN_MS = 30 * SECOND_MS;

type SidePanelProps = {
    className?: string;
    style?: CSSProperties;
};

function parseConfigArray(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value as string[];
    }
    if (typeof value !== 'string' || !value.trim()) {
        return [];
    }
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? (parsed as string[]) : [];
    } catch {
        return [];
    }
}

function toSidePanelSortMethod(value: string): SidePanelSortMethod {
    return value as SidePanelSortMethod;
}

export const SidePanel = forwardRef<HTMLElement, SidePanelProps>(
    function SidePanel({ className = '', style = undefined }, ref) {
        const { t } = useTranslation();
        const [activeTab, setActiveTab] = useState('friends');
        const [prefs, setPrefs] = useState(defaultPrefs);
        const [isRefreshing, setIsRefreshing] = useState(false);
        const [friendRefreshCooldownUntil, setFriendRefreshCooldownUntil] =
            useState(0);
        const [customTabsDialogOpen, setCustomTabsDialogOpen] = useState(false);
        const [customTabsAutoAdd, setCustomTabsAutoAdd] = useState(false);

        function openCustomTabsDialog(autoAdd = false) {
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
                configRepository.getString('sidebarTabLayout', '[]'),
                configRepository.getString('sidebarTabDisplayMode', 'auto')
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
                        sidebarTabLayout,
                        sidebarTabDisplayMode
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
                                normalizeSidebarTabLayout(sidebarTabLayout),
                            sidebarTabDisplayMode:
                                normalizeSidebarTabDisplayMode(
                                    sidebarTabDisplayMode
                                )
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
            showTabText,
            tabDisplayMode,
            tabItems,
            tabLayout,
            visibleFavoriteCollectionSourceGroupKeys,
            visibleTabLayout
        } = useSidePanelTabData({ activeTab, prefs, setActiveTab, t });

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

        function saveCustomTabs(
            nextLayout: SidebarTabLayout,
            nextDisplayMode: SidebarTabDisplayMode
        ) {
            const normalizedLayout = normalizeSidebarTabLayout(nextLayout);
            const normalizedDisplayMode =
                normalizeSidebarTabDisplayMode(nextDisplayMode);
            setPrefs((current) => ({
                ...current,
                sidebarTabLayout: normalizedLayout,
                sidebarTabDisplayMode: normalizedDisplayMode
            }));
            configRepository.setString(
                'sidebarTabLayout',
                serializeSidebarTabLayout(normalizedLayout)
            );
            configRepository.setString(
                'sidebarTabDisplayMode',
                normalizedDisplayMode
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
            saveCustomTabs(nextLayout, tabDisplayMode);
        }

        return (
            <aside
                ref={ref}
                data-vrcx-0-surface="side-panel"
                className={cn(
                    'vrcx-0-side-panel flex h-full min-h-0 w-80 shrink-0 flex-col overflow-hidden border-l',
                    className
                )}
                style={style}
            >
                <Tabs
                    value={activeTab}
                    onValueChange={setActiveTab}
                    className="flex min-h-0 flex-1 flex-col overflow-hidden px-2 pt-4.5 pb-2"
                >
                    <div className="flex min-w-0 shrink-0 items-center gap-2">
                        <div className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
                            <TabsList className="min-w-max justify-start">
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
                                                            activeTab ===
                                                            item.value
                                                                ? ''
                                                                : undefined
                                                        }
                                                        className={cn(
                                                            'min-w-0 flex-none',
                                                            showTabText
                                                                ? 'max-w-40'
                                                                : 'w-8 px-1'
                                                        )}
                                                    >
                                                        <Icon data-icon="inline-start" />
                                                        <span
                                                            className={cn(
                                                                showTabText
                                                                    ? 'min-w-0 truncate'
                                                                    : 'sr-only'
                                                            )}
                                                        >
                                                            {item.label}
                                                        </span>
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
                        </div>
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
                            <PlusIcon data-icon="inline-start" />
                        </Button>
                        <SidePanelSettingsPopover
                            open={settingsPopoverOpen}
                            onOpenChange={setSettingsPopoverOpen}
                            isRefreshing={isRefreshing}
                            onRefreshFriends={() => {
                                refreshFriends();
                            }}
                            prefs={prefs}
                            onUpdateBoolPreference={updateBoolPreference}
                            onUpdateStringPreference={updateStringPreference}
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
                            onOpenFavoriteGroupOrderDialog={() =>
                                setFavoriteGroupOrderDialogOpen(true)
                            }
                            onOpenCustomTabsDialog={() =>
                                openCustomTabsDialog()
                            }
                        />
                    </div>
                    <TabsContent
                        value="friends"
                        className="mt-1 min-h-0 flex-1 overflow-hidden data-hidden:hidden"
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
                            className="mt-1 min-h-0 flex-1 overflow-hidden data-hidden:hidden"
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
                                className="mt-1 min-h-0 flex-1 overflow-hidden data-hidden:hidden"
                            >
                                <FriendsSidebar
                                    prefs={prefs}
                                    favoriteCollectionTab={item}
                                />
                            </TabsContent>
                        ))}
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
                    displayMode={tabDisplayMode}
                    favoriteGroupItems={favoriteGroupItems}
                    autoCreateCollection={customTabsAutoAdd}
                    onSave={saveCustomTabs}
                />
            </aside>
        );
    }
);
