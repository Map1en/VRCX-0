import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';

import configRepository from '@/repositories/configRepository';

import type { FavoriteGroupItem } from './side-panel/sidebarTabLayout';
import type {
    SidePanelArrayPreferenceKey,
    SidePanelBooleanPreferenceKey,
    SidePanelPreferences,
    SidePanelSortMethod,
    SidePanelSortPreferenceKey
} from './side-panel/sidePanelTypes';

type SidePanelSetPrefs = Dispatch<SetStateAction<SidePanelPreferences>>;

type SidePanelSettingsStateInput = {
    allFavoriteGroupKeys: string[];
    orderedFavoriteGroupItems: FavoriteGroupItem[];
    prefs: SidePanelPreferences;
    resolvedSidebarFavoriteGroups: string[];
    setPrefs: SidePanelSetPrefs;
};

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

export function useSidePanelSettingsState({
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
