import { forwardRef, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils.js';
import { configRepository } from '@/repositories/index.js';
import { refreshCurrentUserFriendsAndFavorites } from '@/services/backgroundMaintenanceService.js';
import { useFavoriteStore } from '@/state/favoriteStore.js';
import { useFriendRosterStore } from '@/state/friendRosterStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/shadcn/tabs';

import { FriendsSidebar } from './FriendsSidebar.jsx';
import { GroupsSidebar } from './GroupsSidebar.jsx';
import { SidePanelFavoriteGroupOrderDialog } from './side-panel/SidePanelFavoriteGroupOrderDialog.jsx';
import { SidePanelSettingsPopover } from './side-panel/SidePanelSettingsPopover.jsx';

const defaultPrefs = {
    sidebarGroupByInstance: true,
    isHideFriendsInSameInstance: false,
    isSameInstanceAboveFavorites: false,
    isSidebarDivideByFriendGroup: false,
    sidebarSortMethod1: 'Sort by Status',
    sidebarSortMethod2: 'Sort Alphabetically',
    sidebarSortMethod3: '',
    sidebarFavoriteGroups: [],
    sidebarFavoriteGroupOrder: []
};

function parseConfigArray(value) {
    if (Array.isArray(value)) {
        return value;
    }
    if (typeof value !== 'string' || !value.trim()) {
        return [];
    }
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function normalizeFavoriteGroupsChange(value, allKeys) {
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

function moveArrayItem(values, index, delta) {
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
}) {
    const [settingsPopoverOpen, setSettingsPopoverOpen] = useState(false);
    const [favoriteGroupOrderDialogOpen, setFavoriteGroupOrderDialogOpen] =
        useState(false);
    const [favoriteGroupOrderDraft, setFavoriteGroupOrderDraft] = useState([]);
    const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);

    useEffect(() => {
        if (favoriteGroupOrderDialogOpen) {
            setFavoriteGroupOrderDraft(orderedFavoriteGroupItems);
        }
    }, [favoriteGroupOrderDialogOpen, orderedFavoriteGroupItems]);

    function updateBoolPreference(key, value) {
        setPrefs((current) => ({
            ...current,
            [key]: Boolean(value)
        }));
        void configRepository.setBool(key, Boolean(value));
    }

    function updateStringPreference(key, value) {
        setPrefs((current) => ({
            ...current,
            [key]: value || ''
        }));
        void configRepository.setString(key, value || '');
    }

    function updateArrayPreference(key, value) {
        const nextValue = Array.isArray(value) ? value : [];
        setPrefs((current) => ({
            ...current,
            [key]: nextValue
        }));
        void configRepository.setString(key, JSON.stringify(nextValue));
    }

    function updateFavoriteGroupSelection(nextKeys) {
        updateArrayPreference(
            'sidebarFavoriteGroups',
            normalizeFavoriteGroupsChange(nextKeys, allFavoriteGroupKeys)
        );
    }

    function toggleFavoriteGroup(key, checked) {
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

    function moveFavoriteGroupOrder(index, delta) {
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

export const SidePanel = forwardRef(function SidePanel(
    { className = '', style = undefined },
    ref
) {
    const { t } = useTranslation();
    const friendsById = useFriendRosterStore((state) => state.friendsById);
    const onlineIds = useFriendRosterStore((state) => state.onlineIds);
    const favoriteLoadStatus = useFavoriteStore((state) => state.loadStatus);
    const favoriteFriendGroups = useFavoriteStore(
        (state) => state.favoriteFriendGroups
    );
    const localFriendFavoriteGroups = useFavoriteStore(
        (state) => state.localFriendFavoriteGroups
    );
    const groupInstancesState = useRuntimeStore(
        (state) => state.groupInstances
    );
    const currentEndpoint = useRuntimeStore(
        (state) => state.auth.currentUserEndpoint
    );
    const groupInstances =
        groupInstancesState.endpoint === currentEndpoint
            ? groupInstancesState.instances
            : [];
    const [activeTab, setActiveTab] = useState('friends');
    const [prefs, setPrefs] = useState(defaultPrefs);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const totalFriendCount = Object.keys(friendsById || {}).length;

    useEffect(() => {
        let active = true;
        Promise.all([
            configRepository.getBool('sidebarGroupByInstance', true),
            configRepository.getBool('isHideFriendsInSameInstance', false),
            configRepository.getBool('isSameInstanceAboveFavorites', false),
            configRepository.getBool('isSidebarDivideByFriendGroup', false),
            configRepository.getString('sidebarSortMethod1', 'Sort by Status'),
            configRepository.getString(
                'sidebarSortMethod2',
                'Sort Alphabetically'
            ),
            configRepository.getString('sidebarSortMethod3', ''),
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
                        sidebarGroupByInstance: Boolean(sidebarGroupByInstance),
                        isHideFriendsInSameInstance: Boolean(
                            isHideFriendsInSameInstance
                        ),
                        isSameInstanceAboveFavorites: Boolean(
                            isSameInstanceAboveFavorites
                        ),
                        isSidebarDivideByFriendGroup: Boolean(
                            isSidebarDivideByFriendGroup
                        ),
                        sidebarSortMethod1: sidebarSortMethod1 || '',
                        sidebarSortMethod2: sidebarSortMethod2 || '',
                        sidebarSortMethod3: sidebarSortMethod3 || '',
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
        return () => {
            active = false;
        };
    }, []);

    const tabItems = useMemo(
        () => [
            {
                value: 'friends',
                label: t('component.side_panel.generated_dynamic.value_value_value', { value: t('side_panel.friends'), value2: onlineIds.length, value3: totalFriendCount })
            },
            {
                value: 'groups',
                label: t('component.side_panel.generated_dynamic.value_value', { value: t('side_panel.groups'), value2: groupInstances.length })
            }
        ],
        [groupInstances.length, onlineIds.length, t, totalFriendCount]
    );

    const favoriteGroupItems = useMemo(
        () =>
            [
                ...(favoriteFriendGroups || []).map((group) => ({
                    key: group.key,
                    label: group.displayName || group.name || group.key
                })),
                ...(localFriendFavoriteGroups || []).map((groupName) => ({
                    key: `local:${groupName}`,
                    label: groupName
                }))
            ].filter((group) => group.key),
        [favoriteFriendGroups, localFriendFavoriteGroups]
    );
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
        const itemMap = new Map(
            favoriteGroupItems.map((group) => [group.key, group])
        );
        const ordered = [];
        for (const key of prefs.sidebarFavoriteGroupOrder || []) {
            if (selected.has(key) && itemMap.has(key)) {
                ordered.push(itemMap.get(key));
                selected.delete(key);
            }
        }
        for (const key of resolvedSidebarFavoriteGroups) {
            if (selected.has(key) && itemMap.has(key)) {
                ordered.push(itemMap.get(key));
            }
        }
        return ordered;
    }, [
        favoriteGroupItems,
        prefs.sidebarFavoriteGroupOrder,
        resolvedSidebarFavoriteGroups
    ]);

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
        const auth = useRuntimeStore.getState().auth;
        if (!auth.currentUserId || !auth.currentUserSnapshot) {
            toast.error(t('side_panel.generated.no_authenticated_user_snapshot_is_available'));
            return;
        }
        setIsRefreshing(true);
        try {
            await refreshCurrentUserFriendsAndFavorites();
            toast.success(t('side_panel.generated.friend_and_favorite_snapshots_refreshed'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('component.side_panel.generated_toast.failed_to_refresh_friends')
            );
        } finally {
            setIsRefreshing(false);
        }
    }

    return (
        <aside
            ref={ref}
            className={cn(
                'bg-background flex h-full min-h-0 w-80 shrink-0 flex-col overflow-hidden border-l',
                className
            )}
            style={style}
        >
            <Tabs
                value={activeTab}
                onValueChange={setActiveTab}
                className="flex min-h-0 flex-1 flex-col overflow-hidden px-2 pt-2 pb-2"
            >
                <div className="flex shrink-0 items-center gap-2">
                    <TabsList>
                        {tabItems.map((item) => (
                            <TabsTrigger key={item.value} value={item.value}>
                                {item.label}
                            </TabsTrigger>
                        ))}
                    </TabsList>
                    <SidePanelSettingsPopover
                        open={settingsPopoverOpen}
                        onOpenChange={setSettingsPopoverOpen}
                        isRefreshing={isRefreshing}
                        onRefreshFriends={() => void refreshFriends()}
                        prefs={prefs}
                        onUpdateBoolPreference={updateBoolPreference}
                        onUpdateStringPreference={updateStringPreference}
                        isAdvancedOpen={isAdvancedOpen}
                        onAdvancedOpenChange={setIsAdvancedOpen}
                        favoriteGroupItems={favoriteGroupItems}
                        favoriteLoadStatus={favoriteLoadStatus}
                        selectedFavoriteGroupLabel={selectedFavoriteGroupLabel}
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
                        t={t}
                    />
                </div>
                <TabsContent
                    value="friends"
                    className="mt-2 min-h-0 flex-1 overflow-hidden data-[state=inactive]:hidden"
                >
                    <FriendsSidebar prefs={prefs} />
                </TabsContent>
                <TabsContent
                    value="groups"
                    className="mt-2 min-h-0 flex-1 overflow-hidden data-[state=inactive]:hidden"
                >
                    <GroupsSidebar />
                </TabsContent>
            </Tabs>
            <SidePanelFavoriteGroupOrderDialog
                open={favoriteGroupOrderDialogOpen}
                onOpenChange={setFavoriteGroupOrderDialogOpen}
                favoriteGroupOrderDraft={favoriteGroupOrderDraft}
                onMove={moveFavoriteGroupOrder}
                onReset={resetFavoriteGroupOrder}
                onConfirm={confirmFavoriteGroupOrder}
                t={t}
            />
        </aside>
    );
});
