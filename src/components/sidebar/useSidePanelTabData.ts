import type { TFunction } from 'i18next';
import { useEffect, useMemo, type Dispatch, type SetStateAction } from 'react';

import { buildFavoriteCollectionFriendIdSet } from '@/components/sidebar/friends-sidebar/favoriteCollectionSidebarRows';
import { useFavoriteStore } from '@/state/favoriteStore';
import { useFriendRosterStore } from '@/state/friendRosterStore';
import { useRuntimeStore } from '@/state/runtimeStore';

import {
    getVisibleFavoriteCollectionSourceGroupKeys,
    getVisibleSidebarTabs,
    normalizeSidebarTabDisplayMode,
    normalizeSidebarTabLayout,
    type FavoriteGroupItem
} from './side-panel/sidebarTabLayout';
import type {
    SidePanelPreferences,
    SidePanelTabItem
} from './side-panel/sidePanelTypes';

type SidePanelTabDataInput = {
    activeTab: string;
    prefs: SidePanelPreferences;
    setActiveTab: Dispatch<SetStateAction<string>>;
    t: TFunction;
};

export function useSidePanelTabData({
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
