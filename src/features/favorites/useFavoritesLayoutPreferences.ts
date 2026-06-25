import { useEffect, useRef, useState } from 'react';

import { FAVORITES_LAYOUT_CONFIG_KEYS } from '@/repositories/configKeys';
import configRepository from '@/repositories/configRepository';

import type { FavoriteKind } from './favoritesTypes';

const SPLITTER_DEFAULT_SIZE_PX = 260;
const SPLITTER_MIN_SIZE_PX = 0;
const SORT_VALUES_BY_KIND: Record<FavoriteKind, Set<string>> = {
    friend: new Set(['name', 'date']),
    world: new Set(['name', 'date', 'players']),
    avatar: new Set(['name', 'date'])
};
const DEFAULT_SORT_VALUE = 'date';
const CARD_SCALE_SLIDER = { min: 0.6, max: 1, step: 0.01 };
const CARD_SPACING_SLIDER = { min: 0.5, max: 1.5, step: 0.05 };

function clampNumber(value: any, min: any, max: any, fallback: any) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }
    return Math.min(max, Math.max(min, parsed));
}

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

export function useFavoritesLayoutPreferences(kind: FavoriteKind) {
    const [splitterSizePx, setSplitterSizePx] = useState(
        SPLITTER_DEFAULT_SIZE_PX
    );
    const [splitterLayoutVersion, setSplitterLayoutVersion] = useState(0);
    const [cardScale, setCardScale] = useState(1);
    const [cardSpacing, setCardSpacing] = useState(1);
    const [sortValue, setSortValue] = useState(DEFAULT_SORT_VALUE);
    const pendingSplitterSizePxRef = useRef<number | null>(null);
    const sortLoadVersionRef = useRef(0);

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

    useEffect(() => {
        let active = true;
        const scaleKey = FAVORITES_LAYOUT_CONFIG_KEYS.cardScale[kind];
        const spacingKey = FAVORITES_LAYOUT_CONFIG_KEYS.cardSpacing[kind];

        Promise.all([
            configRepository.getString(scaleKey, '1'),
            configRepository.getString(spacingKey, '1')
        ])
            .then(([nextScale, nextSpacing]: any) => {
                if (!active) {
                    return;
                }
                setCardScale(
                    clampNumber(
                        nextScale,
                        CARD_SCALE_SLIDER.min,
                        CARD_SCALE_SLIDER.max,
                        1
                    )
                );
                setCardSpacing(
                    clampNumber(
                        nextSpacing,
                        CARD_SPACING_SLIDER.min,
                        CARD_SPACING_SLIDER.max,
                        1
                    )
                );
            })
            .catch(() => {
                if (!active) {
                    return;
                }
                setCardScale(1);
                setCardSpacing(1);
            });

        return () => {
            active = false;
        };
    }, [kind]);

    useEffect(() => {
        let active = true;
        const loadVersion = sortLoadVersionRef.current;
        const sortKey = FAVORITES_LAYOUT_CONFIG_KEYS.sort[kind];

        setSortValue((current: any) =>
            normalizeFavoriteSortValue(kind, current)
        );

        configRepository
            .getString(sortKey, DEFAULT_SORT_VALUE)
            .then((value: any) => {
                if (active && sortLoadVersionRef.current === loadVersion) {
                    setSortValue(normalizeFavoriteSortValue(kind, value));
                }
            })
            .catch(() => {
                if (active && sortLoadVersionRef.current === loadVersion) {
                    setSortValue(DEFAULT_SORT_VALUE);
                }
            });

        return () => {
            active = false;
        };
    }, [kind]);

    const handleCardScaleChange = (value: any) => {
        const nextValue = clampNumber(
            value,
            CARD_SCALE_SLIDER.min,
            CARD_SCALE_SLIDER.max,
            1
        );
        setCardScale(nextValue);
        configRepository.setString(
            FAVORITES_LAYOUT_CONFIG_KEYS.cardScale[kind],
            String(nextValue)
        );
    };

    const handleCardSpacingChange = (value: any) => {
        const nextValue = clampNumber(
            value,
            CARD_SPACING_SLIDER.min,
            CARD_SPACING_SLIDER.max,
            1
        );
        setCardSpacing(nextValue);
        configRepository.setString(
            FAVORITES_LAYOUT_CONFIG_KEYS.cardSpacing[kind],
            String(nextValue)
        );
    };

    const handleSortValueChange = (value: any) => {
        const nextValue = normalizeFavoriteSortValue(kind, value);
        sortLoadVersionRef.current += 1;
        setSortValue(nextValue);
        configRepository.setString(
            FAVORITES_LAYOUT_CONFIG_KEYS.sort[kind],
            nextValue
        );
    };

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
        cardScale,
        cardSpacing,
        handleCardScaleChange,
        handleCardSpacingChange,
        handleSortValueChange,
        handleSplitterResize,
        persistSplitterLayout,
        sortValue: normalizeFavoriteSortValue(kind, sortValue),
        splitterLayoutVersion,
        splitterSizePx
    };
}
