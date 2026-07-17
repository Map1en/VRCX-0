import { useEffect, useRef, useState } from 'react';

import { FAVORITES_LAYOUT_CONFIG_KEYS } from '@/repositories/configKeys';
import configRepository from '@/repositories/configRepository';

import {
    DEFAULT_FAVORITES_DENSITY_BY_KIND,
    sanitizeFavoritesDensity,
    type FavoritesDensity
} from './favoritesDensity';
import type { FavoriteKind } from './favoritesTypes';

const SPLITTER_DEFAULT_SIZE_PX = 260;
const SPLITTER_MIN_SIZE_PX = 0;
const SORT_VALUES_BY_KIND: Record<FavoriteKind, Set<string>> = {
    friend: new Set(['name', 'date']),
    world: new Set(['name', 'date', 'players']),
    avatar: new Set(['name', 'date'])
};
const DEFAULT_SORT_VALUE = 'date';

function normalizeSplitterSizePx(value: any) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return SPLITTER_DEFAULT_SIZE_PX;
    }
    return Math.max(SPLITTER_MIN_SIZE_PX, Math.round(parsed));
}

function normalizeFavoriteSortValue(kind: FavoriteKind, value: any) {
    const normalizedValue = String(value ?? '').trim();
    const allowedValues =
        SORT_VALUES_BY_KIND[kind] || SORT_VALUES_BY_KIND.friend;
    return allowedValues.has(normalizedValue)
        ? normalizedValue
        : DEFAULT_SORT_VALUE;
}

function usePersistedPreference<T extends string>(
    configKey: string,
    fallback: T,
    sanitize: (value: unknown) => T
): [T, (value: unknown) => void] {
    const [value, setValue] = useState<T>(fallback);
    const loadVersionRef = useRef(0);
    const sanitizeRef = useRef(sanitize);
    sanitizeRef.current = sanitize;
    const fallbackRef = useRef(fallback);
    fallbackRef.current = fallback;

    useEffect(() => {
        let active = true;
        const loadVersion = loadVersionRef.current;

        setValue((current) => sanitizeRef.current(current));

        configRepository
            .getString(configKey, fallbackRef.current)
            .then((stored: any) => {
                if (active && loadVersionRef.current === loadVersion) {
                    setValue(sanitizeRef.current(stored));
                }
            })
            .catch(() => {
                if (active && loadVersionRef.current === loadVersion) {
                    setValue(fallbackRef.current);
                }
            });

        return () => {
            active = false;
        };
    }, [configKey]);

    const handleChange = (next: unknown) => {
        const nextValue = sanitizeRef.current(next);
        loadVersionRef.current += 1;
        setValue(nextValue);
        configRepository.setString(configKey, nextValue);
    };

    return [value, handleChange];
}

export function useFavoritesLayoutPreferences(kind: FavoriteKind) {
    const [splitterSizePx, setSplitterSizePx] = useState(
        SPLITTER_DEFAULT_SIZE_PX
    );
    const [splitterLayoutVersion, setSplitterLayoutVersion] = useState(0);
    const pendingSplitterSizePxRef = useRef<number | null>(null);
    const [density, handleDensityChange] =
        usePersistedPreference<FavoritesDensity>(
            FAVORITES_LAYOUT_CONFIG_KEYS.density[kind],
            DEFAULT_FAVORITES_DENSITY_BY_KIND[kind],
            (value) => sanitizeFavoritesDensity(kind, value)
        );
    const [sortValue, handleSortValueChange] = usePersistedPreference(
        FAVORITES_LAYOUT_CONFIG_KEYS.sort[kind],
        DEFAULT_SORT_VALUE,
        (value) => normalizeFavoriteSortValue(kind, value)
    );

    useEffect(() => {
        let active = true;
        const configKey = FAVORITES_LAYOUT_CONFIG_KEYS.splitter[kind];
        configRepository
            .getString(configKey, '260')
            .then((value: any) => {
                if (!active) {
                    return;
                }
                const parsed = Number(value);
                if (!Number.isFinite(parsed) || parsed < 0) {
                    setSplitterSizePx(SPLITTER_DEFAULT_SIZE_PX);
                    setSplitterLayoutVersion((version: any) => version + 1);
                    return;
                }
                setSplitterSizePx(normalizeSplitterSizePx(parsed));
                setSplitterLayoutVersion((version: any) => version + 1);
            })
            .catch(() => {
                if (active) {
                    setSplitterSizePx(SPLITTER_DEFAULT_SIZE_PX);
                    setSplitterLayoutVersion((version: any) => version + 1);
                }
            });

        return () => {
            active = false;
        };
    }, [kind]);

    function persistSplitterSizePx(nextSizePx: any) {
        const normalizedSizePx = normalizeSplitterSizePx(nextSizePx);
        setSplitterSizePx(normalizedSizePx);
        configRepository.setString(
            FAVORITES_LAYOUT_CONFIG_KEYS.splitter[kind],
            String(normalizedSizePx)
        );
    }

    function handleSplitterResize(panelSize: any) {
        const nextSizePx = Number(panelSize?.inPixels);
        if (!Number.isFinite(nextSizePx) || nextSizePx < 0) {
            return;
        }
        pendingSplitterSizePxRef.current = normalizeSplitterSizePx(nextSizePx);
    }

    function persistSplitterLayout() {
        const pendingSizePx = pendingSplitterSizePxRef.current;
        pendingSplitterSizePxRef.current = null;
        if (Number.isFinite(pendingSizePx)) {
            persistSplitterSizePx(pendingSizePx);
        }
    }

    return {
        density,
        handleDensityChange,
        handleSortValueChange,
        handleSplitterResize,
        persistSplitterLayout,
        sortValue: normalizeFavoriteSortValue(kind, sortValue),
        splitterLayoutVersion,
        splitterSizePx
    };
}
