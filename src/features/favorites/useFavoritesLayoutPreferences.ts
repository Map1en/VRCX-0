import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import type { FavoriteKind } from '@/domain/favorites/types';
import {
    STORAGE_KEYS,
    readStoredText,
    writeStoredText
} from '@/lib/browserStorage';
import { FAVORITES_LAYOUT_CONFIG_KEYS } from '@/repositories/configKeys';
import configRepository from '@/repositories/configRepository';

import {
    DEFAULT_FAVORITES_DENSITY_BY_KIND,
    sanitizeFavoritesDensity,
    type FavoritesDensity
} from './favoritesDensity';
import {
    normalizeFavoriteSortValue,
    type FavoriteSortValue
} from './favoritesItems';

const SPLITTER_DEFAULT_SIZE_PX = 260;
const SPLITTER_MIN_SIZE_PX = 0;
const DEFAULT_SORT_VALUE: FavoriteSortValue = 'date';

type SplitterPanelSize = {
    inPixels?: unknown;
};

function normalizeSplitterSizePx(value: unknown): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return SPLITTER_DEFAULT_SIZE_PX;
    }
    return Math.max(SPLITTER_MIN_SIZE_PX, Math.round(parsed));
}

function usePersistedPreference<T extends string>(
    configKey: string,
    fallback: T,
    sanitize: (value: unknown) => T
): [T, (value: T) => void] {
    const [value, setValue] = useState<T>(fallback);
    const loadVersionRef = useRef(0);
    const sanitizeRef = useRef(sanitize);
    const fallbackRef = useRef(fallback);
    useLayoutEffect(() => {
        sanitizeRef.current = sanitize;
        fallbackRef.current = fallback;
    });

    useEffect(() => {
        let active = true;
        const loadVersion = loadVersionRef.current;

        setValue((current) => sanitizeRef.current(current));

        configRepository
            .getString(configKey, fallbackRef.current)
            .then((stored) => {
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

    const handleChange = (next: T) => {
        const nextValue = sanitizeRef.current(next);
        loadVersionRef.current += 1;
        setValue(nextValue);
        configRepository.setString(configKey, nextValue);
    };

    return [value, handleChange];
}

const FAVORITES_DENSITY_STORAGE_KEYS: Readonly<Record<FavoriteKind, string>> =
    Object.freeze({
        friend: STORAGE_KEYS.favoritesFriendDensity,
        world: STORAGE_KEYS.favoritesWorldDensity,
        avatar: STORAGE_KEYS.favoritesAvatarDensity
    });

const FAVORITES_SPLITTER_STORAGE_KEYS: Readonly<Record<FavoriteKind, string>> =
    Object.freeze({
        friend: STORAGE_KEYS.favoritesFriendSplitter,
        world: STORAGE_KEYS.favoritesWorldSplitter,
        avatar: STORAGE_KEYS.favoritesAvatarSplitter
    });

function readFavoritesDensity(kind: FavoriteKind): FavoritesDensity {
    return sanitizeFavoritesDensity(
        kind,
        readStoredText(FAVORITES_DENSITY_STORAGE_KEYS[kind]) ??
            DEFAULT_FAVORITES_DENSITY_BY_KIND[kind]
    );
}

function readFavoritesSplitterSizePx(kind: FavoriteKind): number {
    const stored = readStoredText(FAVORITES_SPLITTER_STORAGE_KEYS[kind]);
    if (stored === null) {
        return SPLITTER_DEFAULT_SIZE_PX;
    }
    const parsed = Number(stored);
    if (!Number.isFinite(parsed) || parsed < 0) {
        return SPLITTER_DEFAULT_SIZE_PX;
    }
    return normalizeSplitterSizePx(parsed);
}

export function useFavoritesLayoutPreferences(kind: FavoriteKind) {
    const [densityByKind, setDensityByKind] = useState<
        Partial<Record<FavoriteKind, FavoritesDensity>>
    >({});
    const [splitterSizeByKind, setSplitterSizeByKind] = useState<
        Partial<Record<FavoriteKind, number>>
    >({});
    const pendingSplitterSizePxRef = useRef<number | null>(null);
    const density = densityByKind[kind] ?? readFavoritesDensity(kind);
    const splitterSizePx =
        splitterSizeByKind[kind] ?? readFavoritesSplitterSizePx(kind);
    const [sortValue, handleSortValueChange] = usePersistedPreference(
        FAVORITES_LAYOUT_CONFIG_KEYS.sort[kind],
        DEFAULT_SORT_VALUE,
        (value) => normalizeFavoriteSortValue(kind, value)
    );

    function handleDensityChange(next: FavoritesDensity): void {
        const nextDensity = sanitizeFavoritesDensity(kind, next);
        setDensityByKind((current) => ({ ...current, [kind]: nextDensity }));
        writeStoredText(FAVORITES_DENSITY_STORAGE_KEYS[kind], nextDensity);
    }

    function persistSplitterSizePx(nextSizePx: number): void {
        const normalizedSizePx = normalizeSplitterSizePx(nextSizePx);
        setSplitterSizeByKind((current) => ({
            ...current,
            [kind]: normalizedSizePx
        }));
        writeStoredText(
            FAVORITES_SPLITTER_STORAGE_KEYS[kind],
            String(normalizedSizePx)
        );
    }

    function handleSplitterResize(panelSize: SplitterPanelSize): void {
        const nextSizePx = Number(panelSize?.inPixels);
        if (!Number.isFinite(nextSizePx) || nextSizePx < 0) {
            return;
        }
        pendingSplitterSizePxRef.current = normalizeSplitterSizePx(nextSizePx);
    }

    function persistSplitterLayout() {
        const pendingSizePx = pendingSplitterSizePxRef.current;
        pendingSplitterSizePxRef.current = null;
        if (pendingSizePx !== null) {
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
        splitterSizePx
    };
}
