import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { buildFavoriteCollectionFriendIdSet } from '@/components/sidebar/friends-sidebar/favoriteCollectionSidebarRows';
import { resolveSelectedFavoriteGroupKeys } from '@/domain/favorites/favoriteGroupSelection';
import {
    getVisibleSidebarTabs,
    type FavoriteGroupItem
} from '@/shared/utils/sidebarTabLayout';
import { useFavoriteStore } from '@/state/favoriteStore';
import { useFriendRosterStore } from '@/state/friendRosterStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useSidebarTabStore } from '@/state/sidebarTabStore';

import type {
    SidePanelPreferences,
    SidePanelTabItem
} from './side-panel/sidePanelTypes';

type SidePanelTabDataInput = {
    activeTab: string;
    prefs: SidePanelPreferences;
    setActiveTab: (activeTab: string) => void;
};

export function useSidePanelTabData({
    activeTab,
    prefs,
    setActiveTab
}: SidePanelTabDataInput) {
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
                ...(localFriendFavoriteGroups || []).map((group) => ({
                    key: `local:${group.id}`,
                    label: group.name,
                    source: 'local' as const
                }))
            ].filter((group) => group.key),
        [favoriteFriendGroups, localFriendFavoriteGroups]
    );
    const tabLayout = useSidebarTabStore((state) => state.tabLayout);
    const visibleTabLayout = useMemo(
        () => getVisibleSidebarTabs(tabLayout),
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
                    const countLabel = String(count);
                    const title = `${item.name} ${countLabel}`;
                    return {
                        value: item.id,
                        label: item.name,
                        railCountLabel: countLabel,
                        title,
                        icon: item.icon,
                        layoutItem: item
                    };
                }
                if (item.type === 'worldRooms') {
                    return {
                        value: item.id,
                        label: item.name,
                        railCountLabel: '',
                        title: item.name,
                        icon: '',
                        layoutItem: item
                    };
                }
                if (item.systemTab === 'groups') {
                    const label = t('side_panel.groups');
                    const countLabel = String(groupInstances.length);
                    const title = `${label} ${countLabel}`;
                    return {
                        value: 'groups',
                        label,
                        railCountLabel: countLabel,
                        title,
                        icon: item.icon,
                        layoutItem: item
                    };
                }
                const label = t('side_panel.friends');
                const countLabel = `${onlineIds.length}/${totalFriendCount}`;
                const title = `${label} ${countLabel}`;
                return {
                    value: 'friends',
                    label,
                    railCountLabel: String(onlineIds.length),
                    title,
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
    const resolvedSidebarFavoriteGroups = useMemo(
        () =>
            resolveSelectedFavoriteGroupKeys(
                prefs.sidebarFavoriteGroups,
                allFavoriteGroupKeys
            ),
        [allFavoriteGroupKeys, prefs.sidebarFavoriteGroups]
    );
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
        tabItems,
        tabLayout,
        visibleTabLayout
    };
}
