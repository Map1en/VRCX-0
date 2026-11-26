import { useEffect } from 'react';
import { create } from 'zustand';

import {
    STORAGE_KEYS,
    readStoredText,
    writeStoredText
} from '@/lib/browserStorage';

import {
    clampMutualGraphNumber,
    MUTUAL_GRAPH_LAYOUT_DEFAULTS,
    MUTUAL_GRAPH_LAYOUT_LIMITS
} from './mutualFriendsSettings';
import type {
    MutualFriendsLayoutSettingKey,
    MutualFriendsLayoutSettings
} from './mutualFriendsTypes';

interface LayoutSettingConfig {
    storageKey: string;
    decimals?: number;
}

const layoutSettingConfig: Record<
    MutualFriendsLayoutSettingKey,
    LayoutSettingConfig
> = {
    layoutIterations: { storageKey: STORAGE_KEYS.mutualGraphLayoutIterations },
    layoutSpacing: { storageKey: STORAGE_KEYS.mutualGraphLayoutSpacing },
    edgeCurvature: {
        storageKey: STORAGE_KEYS.mutualGraphEdgeCurvature,
        decimals: 2
    },
    communitySeparation: {
        storageKey: STORAGE_KEYS.mutualGraphCommunitySeparation,
        decimals: 1
    }
};

const layoutSettingKeys = [
    'layoutIterations',
    'layoutSpacing',
    'edgeCurvature',
    'communitySeparation'
] satisfies MutualFriendsLayoutSettingKey[];

function normalizeLayoutSetting(
    key: MutualFriendsLayoutSettingKey,
    value: number
) {
    const limits = MUTUAL_GRAPH_LAYOUT_LIMITS[key];
    const nextValue = clampMutualGraphNumber(
        value,
        limits.min,
        limits.max,
        MUTUAL_GRAPH_LAYOUT_DEFAULTS[key]
    );
    const decimals = layoutSettingConfig[key].decimals;
    return Number.isInteger(decimals)
        ? Number(nextValue.toFixed(decimals))
        : nextValue;
}

function readLayoutSetting(key: MutualFriendsLayoutSettingKey): number {
    const stored = readStoredText(layoutSettingConfig[key].storageKey);
    return normalizeLayoutSetting(
        key,
        stored === null ? MUTUAL_GRAPH_LAYOUT_DEFAULTS[key] : Number(stored)
    );
}

function persistLayoutSetting(
    key: MutualFriendsLayoutSettingKey,
    value: number
) {
    writeStoredText(layoutSettingConfig[key].storageKey, String(value));
}

const useLayoutSettingsStore = create<MutualFriendsLayoutSettings>(() => ({
    ...MUTUAL_GRAPH_LAYOUT_DEFAULTS
}));

let hydrated = false;

function hydrateLayoutSettings() {
    if (hydrated) {
        return;
    }
    hydrated = true;
    useLayoutSettingsStore.setState(
        Object.fromEntries(
            layoutSettingKeys.map((key) => [key, readLayoutSetting(key)])
        )
    );
}

function setLayoutSetting(key: MutualFriendsLayoutSettingKey, value: number) {
    const nextValue = normalizeLayoutSetting(key, value);
    useLayoutSettingsStore.setState({ [key]: nextValue });
    persistLayoutSetting(key, nextValue);
}

function resetLayoutSettings() {
    useLayoutSettingsStore.setState({ ...MUTUAL_GRAPH_LAYOUT_DEFAULTS });
    for (const key of layoutSettingKeys) {
        persistLayoutSetting(key, MUTUAL_GRAPH_LAYOUT_DEFAULTS[key]);
    }
}

export function useMutualFriendsLayoutSettings() {
    const layoutSettings = useLayoutSettingsStore();

    useEffect(() => {
        hydrateLayoutSettings();
    }, []);

    return {
        layoutSettings,
        resetLayoutSettings,
        setLayoutSetting
    };
}
