import type { TFunction } from 'i18next';
import { EyeOffIcon, SlidersHorizontalIcon } from 'lucide-react';
import {
    forwardRef,
    useEffect,
    useMemo,
    useState,
    type CSSProperties,
    type Dispatch,
    type SetStateAction
} from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { getNavIconComponent } from '@/components/layout/navIconRegistry';
import { buildFavoriteCollectionFriendIdSet } from '@/components/sidebar/friends-sidebar/favoriteCollectionSidebarRows';
import { cn } from '@/lib/utils';
import configRepository from '@/repositories/configRepository';
import { refreshFriendAndFavoriteSnapshots } from '@/services/backgroundMaintenanceService';
import { SECOND_MS } from '@/shared/constants/time';
import { useFavoriteStore } from '@/state/favoriteStore';
import { useFriendRosterStore } from '@/state/friendRosterStore';
import { useRuntimeStore } from '@/state/runtimeStore';
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
    getVisibleFavoriteCollectionSourceGroupKeys,
    getVisibleSidebarTabs,
    normalizeSidebarTabDisplayMode,
    normalizeSidebarTabLayout,
    serializeSidebarTabLayout,
    sidebarTabFallbackIcon,
    type FavoriteGroupItem,
    type SidebarFavoriteCollectionTabLayoutItem,
    type SidebarTabDisplayMode,
    type SidebarTabLayout
} from './side-panel/sidebarTabLayout';
import { SidePanelCustomTabsDialog } from './side-panel/SidePanelCustomTabsDialog';
import { SidePanelFavoriteGroupOrderDialog } from './side-panel/SidePanelFavoriteGroupOrderDialog';
import { SidePanelSettingsPopover } from './side-panel/SidePanelSettingsPopover';
import type {
    SidePanelArrayPreferenceKey,
    SidePanelBooleanPreferenceKey,
    SidePanelPreferences,
    SidePanelSortMethod,
    SidePanelSortPreferenceKey,
    SidePanelTabItem
} from './side-panel/sidePanelTypes';

const defaultPrefs: SidePanelPreferences = {
    sidebarGroupByInstance: true,
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

type SidePanelSetPrefs = Dispatch<SetStateAction<SidePanelPreferences>>;

type SidePanelSettingsStateInput = {
    allFavoriteGroupKeys: string[];
    orderedFavoriteGroupItems: FavoriteGroupItem[];
    prefs: SidePanelPreferences;
    resolvedSidebarFavoriteGroups: string[];
    setPrefs: SidePanelSetPrefs;
};

type SidePanelTabDataInput = {
    activeTab: string;
    prefs: SidePanelPreferences;
    setActiveTab: Dispatch<SetStateAction<string>>;
    t: TFunction;
};

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

function normalizeFavoriteGroupsChange(
    value: string[],
    allKeys: string[]
): string[] {
    if (!Array.isArray(value) || !value.length) {
        return [];
    }
    if (
        value.length >= allKeys.length &&
        allKeys.every((key) => value.includes(key))
    ) {
        return [];
    }
    return value;
}

function moveArrayItem<T>(values: T[], index: number, delta: number): T[] {
    const targetIndex = index + delta;
    if (targetIndex < 0 || targetIndex >= values.length) {
        return values;
    }
    const next = [...values];
    const [item] = next.splice(index, 1);
    next.splice(targetIndex, 0, item);
    return next;
}

function useSidePanelSettingsState({
    allFavoriteGroupKeys,
    orderedFavoriteGroupItems,
    prefs,
    resolvedSidebarFavoriteGroups,
    setPrefs
}: SidePanelSettingsStateInput) {
    const [settingsPopoverOpen, setSettingsPopoverOpen] = useState(false);
    const [favoriteGroupOrderDialogOpen, setFavoriteGroupOrderDialogOpen] =
        useState(false);
    const [favoriteGroupOrderDraft, setFavoriteGroupOrderDraft] = useState<
        FavoriteGroupItem[]
    >([]);
    const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);

    useEffect(() => {
        if (favoriteGroupOrderDialogOpen) {
            setFavoriteGroupOrderDraft(orderedFavoriteGroupItems);
        }
    }, [favoriteGroupOrderDialogOpen, orderedFavoriteGroupItems]);

    function updateBoolPreference(
        key: SidePanelBooleanPreferenceKey,
        value: boolean
    ) {
        setPrefs((current) => ({
            ...current,
            [key]: Boolean(value)
        }));
        configRepository.setBool(key, Boolean(value));
    }

    function updateStringPreference(
        key: SidePanelSortPreferenceKey,
        value: SidePanelSortMethod
    ) {
        setPrefs((current) => ({
            ...current,
            [key]: value || ''
        }));
        configRepository.setString(key, value || '');
    }

    function updateArrayPreference(
        key: SidePanelArrayPreferenceKey,
        value: string[]
    ) {
        const nextValue = Array.isArray(value) ? value : [];
        setPrefs((current) => ({
            ...current,
            [key]: nextValue
        }));
        configRepository.setString(key, JSON.stringify(nextValue));
    }

    function updateFavoriteGroupSelection(nextKeys: string[]) {
        updateArrayPreference(
            'sidebarFavoriteGroups',
            normalizeFavoriteGroupsChange(nextKeys, allFavoriteGroupKeys)
        );
    }

    function toggleFavoriteGroup(key: string, checked: boolean) {
        const selected = new Set(resolvedSidebarFavoriteGroups);
        if (checked) {
            selected.add(key);
        } else {
            selected.delete(key);
        }
        updateFavoriteGroupSelection(
            [...selected].filter((value) =>
                allFavoriteGroupKeys.includes(value)
            )
        );
    }

    function confirmFavoriteGroupOrder() {
        const nextOrder = favoriteGroupOrderDraft.map((group) => group.key);
        for (const key of prefs.sidebarFavoriteGroupOrder || []) {
            if (!nextOrder.includes(key)) {
                nextOrder.push(key);
            }
        }
        updateArrayPreference('sidebarFavoriteGroupOrder', nextOrder);
        setFavoriteGroupOrderDialogOpen(false);
    }

    function resetFavoriteGroupOrder() {
        updateArrayPreference('sidebarFavoriteGroupOrder', []);
        setFavoriteGroupOrderDraft(orderedFavoriteGroupItems);
    }

    function moveFavoriteGroupOrder(index: number, delta: number) {
        setFavoriteGroupOrderDraft((current) =>
            moveArrayItem(current, index, delta)
        );
    }

    return {
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
    };
}

function useSidePanelTabData({
    activeTab,
    prefs,
    setActiveTab,
    t
}: SidePanelTabDataInput) {
    const friendsById = useFriendRosterStore((state) => state.friendsById);
    const onlineIds = useFriendRosterStore((state) => state.onlineIds);
    const favoriteLoadStatus = useFavoriteStore((state) => state.loadStatus);
    const favoriteFriendGroups = useFavoriteStore(
        (state) => state.favoriteFriendGroups
    );
    const localFriendFavoriteGroups = useFavoriteStore(
        (state) => state.localFriendFavoriteGroups
    );
    const groupedFavoriteFriendIdsByGroupKey = useFavoriteStore(
        (state) => state.groupedFavoriteFriendIdsByGroupKey
    );
    const localFriendFavorites = useFavoriteStore(
        (state) => state.localFriendFavorites
    );
    const groupInstancesState = useRuntimeStore(
        (state) => state.groupInstances
    );
    const currentEndpoint = useRuntimeStore(
        (state) => state.auth.currentUserEndpoint
    );
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const groupInstances =
        groupInstancesState.userId === currentUserId &&
        groupInstancesState.endpoint === currentEndpoint
            ? groupInstancesState.instances
            : [];
    const totalFriendCount = Object.keys(friendsById || {}).length;

    const favoriteGroupItems = useMemo<FavoriteGroupItem[]>(
        () =>
            [
                ...(favoriteFriendGroups || []).map((group) => ({
                    key: group.key || '',
                    label: group.displayName || group.name || group.key || '',
                    source: 'remote' as const
                })),
                ...(localFriendFavoriteGroups || []).map((groupName) => ({
                    key: `local:${groupName}`,
                    label: groupName,
                    source: 'local' as const
                }))
            ].filter((group) => group.key),
        [favoriteFriendGroups, localFriendFavoriteGroups]
    );
    const tabLayout = useMemo(
        () => normalizeSidebarTabLayout(prefs.sidebarTabLayout),
        [prefs.sidebarTabLayout]
    );
    const visibleTabLayout = useMemo(
        () => getVisibleSidebarTabs(tabLayout),
        [tabLayout]
    );
    const visibleFavoriteCollectionSourceGroupKeys = useMemo(
        () => getVisibleFavoriteCollectionSourceGroupKeys(tabLayout),
        [tabLayout]
    );
    const customTabCountById = useMemo(() => {
        const counts = new Map<string, number>();
        for (const item of visibleTabLayout) {
            if (item.type !== 'favoriteCollection') {
                continue;
            }
            const ids = buildFavoriteCollectionFriendIdSet({
                sourceGroupKeys: item.sourceGroupKeys,
                groupedFavoriteFriendIdsByGroupKey,
                localFriendFavorites
            });
            let count = 0;
            for (const id of ids) {
                if (friendsById?.[id]) {
                    count += 1;
                }
            }
            counts.set(item.id, count);
        }
        return counts;
    }, [
        friendsById,
        groupedFavoriteFriendIdsByGroupKey,
        localFriendFavorites,
        visibleTabLayout
    ]);
    const tabItems = useMemo<SidePanelTabItem[]>(
        () =>
            visibleTabLayout.map((item) => {
                if (item.type === 'favoriteCollection') {
                    const count = customTabCountById.get(item.id) || 0;
                    const label = `${item.name} (${count})`;
                    return {
                        value: item.id,
                        label,
                        title: label,
                        icon: item.icon,
                        layoutItem: item
                    };
                }
                if (item.systemTab === 'groups') {
                    const label = t(
                        'component.side_panel.dynamic.value_value',
                        {
                            value: t('side_panel.groups'),
                            value2: groupInstances.length
                        }
                    );
                    return {
                        value: 'groups',
                        label,
                        title: label,
                        icon: item.icon,
                        layoutItem: item
                    };
                }
                const label = t(
                    'component.side_panel.dynamic.value_value_value',
                    {
                        value: t('side_panel.friends'),
                        value2: onlineIds.length,
                        value3: totalFriendCount
                    }
                );
                return {
                    value: 'friends',
                    label,
                    title: label,
                    icon: item.icon,
                    layoutItem: item
                };
            }),
        [
            customTabCountById,
            groupInstances.length,
            onlineIds.length,
            t,
            totalFriendCount,
            visibleTabLayout
        ]
    );
    const tabDisplayMode = normalizeSidebarTabDisplayMode(
        prefs.sidebarTabDisplayMode
    );
    const showTabText =
        tabDisplayMode === 'iconText' ||
        (tabDisplayMode === 'auto' && tabItems.length <= 2);
    const groupsTabVisible = visibleTabLayout.some(
        (item) => item.type === 'system' && item.systemTab === 'groups'
    );

    useEffect(() => {
        if (
            tabItems.length &&
            !tabItems.some((item) => item.value === activeTab)
        ) {
            setActiveTab(tabItems[0].value);
        }
    }, [activeTab, setActiveTab, tabItems]);

    const allFavoriteGroupKeys = useMemo(
        () => favoriteGroupItems.map((group) => group.key),
        [favoriteGroupItems]
    );
    const resolvedSidebarFavoriteGroups = useMemo(() => {
        const configured = Array.isArray(prefs.sidebarFavoriteGroups)
            ? prefs.sidebarFavoriteGroups.filter(Boolean)
            : [];
        if (!configured.length) {
            return allFavoriteGroupKeys;
        }
        return configured.filter((key) => allFavoriteGroupKeys.includes(key));
    }, [allFavoriteGroupKeys, prefs.sidebarFavoriteGroups]);
    const selectedFavoriteGroupLabel = useMemo(() => {
        const firstKey = resolvedSidebarFavoriteGroups[0];
        const firstGroup = favoriteGroupItems.find(
            (group) => group.key === firstKey
        );
        if (!firstGroup) {
            return '';
        }
        return resolvedSidebarFavoriteGroups.length > 1
            ? `${firstGroup.label} +${resolvedSidebarFavoriteGroups.length - 1}`
            : firstGroup.label;
    }, [favoriteGroupItems, resolvedSidebarFavoriteGroups]);
    const orderedFavoriteGroupItems = useMemo(() => {
        const selected = new Set(resolvedSidebarFavoriteGroups);
        const itemMap = new Map<string, FavoriteGroupItem>(
            favoriteGroupItems.map((group) => [group.key, group])
        );
        const ordered: FavoriteGroupItem[] = [];
        for (const key of prefs.sidebarFavoriteGroupOrder || []) {
            const item = itemMap.get(key);
            if (selected.has(key) && item) {
                ordered.push(item);
                selected.delete(key);
            }
        }
        for (const key of resolvedSidebarFavoriteGroups) {
            const item = itemMap.get(key);
            if (selected.has(key) && item) {
                ordered.push(item);
            }
        }
        return ordered;
    }, [
        favoriteGroupItems,
        prefs.sidebarFavoriteGroupOrder,
        resolvedSidebarFavoriteGroups
    ]);

    return {
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
    };
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

        useEffect(() => {
            let active = true;
            Promise.all([
                configRepository.getBool('sidebarGroupByInstance', true),
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
                                                            setCustomTabsDialogOpen(
                                                                true
                                                            )
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
                                setCustomTabsDialogOpen(true)
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
                    onOpenChange={setCustomTabsDialogOpen}
                    layout={tabLayout}
                    displayMode={tabDisplayMode}
                    favoriteGroupItems={favoriteGroupItems}
                    onSave={saveCustomTabs}
                />
            </aside>
        );
    }
);
